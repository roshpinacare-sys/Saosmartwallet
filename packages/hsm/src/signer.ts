/**
 * Saosmartwallet — packages/hsm: the HSM signer SEAM (owner directive §3)
 * ========================================================================
 * The seam every signing caller in the wallet programs against, so the
 * concrete signing backend (local software reference or vault-backed remote
 * HSM) is swappable without touching call sites.
 *
 *   HsmSigner            — the contract (sign / publicKey / listKeys)
 *   LocalSoftwareHsm     — reference implementation: keys held in a Map,
 *                          deterministic sha256-secp256k1 ECDSA (RFC6979
 *                          nonces via @noble/curves — the same audited
 *                          primitive packages/crypto uses). THROWAWAY keys
 *                          only: this class is for tests and local tooling,
 *                          never for custody of production keys.
 *   VaultBackedSigner    — adapter that posts {keyRef, digestHex} to
 *                          HSM_ENDPOINT /sign with a Bearer token from
 *                          HSM_TOKEN. Fail-closed: missing env, unknown key,
 *                          non-2xx, or malformed response all throw.
 *
 * Fail-closed law: every error path throws (HsmSignerError with a stable
 * code). No error message ever carries key material or the bearer token.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Every seam digest is a 32-byte hash (sha256 output size). */
export const HSM_DIGEST_BYTES = 32;

export type HsmSignerErrorCode =
  | "HSM_E_BAD_DIGEST"
  | "HSM_E_BAD_KEYREF"
  | "HSM_E_BAD_KEY"
  | "HSM_E_UNKNOWN_KEY"
  | "HSM_E_NOT_CONFIGURED"
  | "HSM_E_REMOTE"
  | "HSM_E_REMOTE_BAD_RESPONSE";

/** Stable-code error — callers branch on `code`, never on message text. */
export class HsmSignerError extends Error {
  constructor(
    public readonly code: HsmSignerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HsmSignerError";
  }
}

/**
 * The production signing seam. `digest` is a 32-byte hash (e.g. sha256 of
 * the payload); implementations sign the digest as-is (no re-hashing).
 */
export interface HsmSigner {
  sign(digest: Uint8Array, keyRef: string): Promise<Uint8Array>;
  publicKey(keyRef: string): Promise<Uint8Array>;
  listKeys(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Shared validation (fail-closed, identical law for every backend)
// ---------------------------------------------------------------------------

function assertDigest(digest: Uint8Array): void {
  if (!(digest instanceof Uint8Array) || digest.length !== HSM_DIGEST_BYTES) {
    throw new HsmSignerError("HSM_E_BAD_DIGEST", `digest must be exactly ${HSM_DIGEST_BYTES} bytes`);
  }
}

function assertKeyRef(keyRef: string): void {
  if (typeof keyRef !== "string" || keyRef.length === 0 || keyRef.length > 128) {
    throw new HsmSignerError("HSM_E_BAD_KEYREF", "keyRef must be a non-empty string of at most 128 chars");
  }
}

// ---------------------------------------------------------------------------
// Hex plumbing (pure, dependency-free)
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new HsmSignerError("HSM_E_REMOTE_BAD_RESPONSE", "expected an even-length hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// LocalSoftwareHsm — reference implementation (THROWAWAY in-test keys only)
// ---------------------------------------------------------------------------

/**
 * Reference HsmSigner. Keys live in an in-memory Map; signatures are
 * deterministic (RFC6979 nonce, canonical low-s) so the same (key, digest)
 * pair always yields the same 64-byte r||s signature.
 *
 * INTENDED USE: tests and local tooling with throwaway keys. Production key
 * custody stays in the sealed keyring (packages/hsm-runtime) or the owner
 * vault — never in this Map.
 */
export class LocalSoftwareHsm implements HsmSigner {
  private readonly keys = new Map<string, Uint8Array>();

  /** Imports a raw 32-byte secp256k1 private scalar under keyRef. */
  importKey(keyRef: string, privateKeyBytes: Uint8Array): void {
    assertKeyRef(keyRef);
    if (!(privateKeyBytes instanceof Uint8Array) || privateKeyBytes.length !== HSM_DIGEST_BYTES) {
      throw new HsmSignerError("HSM_E_BAD_KEY", "private key must be exactly 32 bytes");
    }
    const copy = new Uint8Array(privateKeyBytes);
    try {
      secp256k1.getPublicKey(copy, true); // validates the scalar (nonzero, in range)
    } catch {
      throw new HsmSignerError("HSM_E_BAD_KEY", "private key is not a valid secp256k1 scalar");
    }
    this.keys.set(keyRef, copy);
  }

  /** Derives the key deterministically: priv = sha256(utf8(seed)). */
  importSeed(keyRef: string, seed: string): void {
    if (typeof seed !== "string" || seed.length === 0) {
      throw new HsmSignerError("HSM_E_BAD_KEY", "seed must be a non-empty string");
    }
    this.importKey(keyRef, sha256(new TextEncoder().encode(seed)));
  }

  async sign(digest: Uint8Array, keyRef: string): Promise<Uint8Array> {
    assertDigest(digest);
    assertKeyRef(keyRef);
    const priv = this.keys.get(keyRef);
    if (!priv) throw new HsmSignerError("HSM_E_UNKNOWN_KEY", "no key registered under this keyRef");
    // prehash:false — the input IS the digest; RFC6979 nonce → deterministic.
    // noble v2 returns the 64-byte r||s compact bytes directly.
    return new Uint8Array(secp256k1.sign(digest, priv, { prehash: false }));
  }

  async publicKey(keyRef: string): Promise<Uint8Array> {
    assertKeyRef(keyRef);
    const priv = this.keys.get(keyRef);
    if (!priv) throw new HsmSignerError("HSM_E_UNKNOWN_KEY", "no key registered under this keyRef");
    return new Uint8Array(secp256k1.getPublicKey(priv, true));
  }

  async listKeys(): Promise<string[]> {
    return [...this.keys.keys()].sort();
  }
}

// ---------------------------------------------------------------------------
// VaultBackedSigner — remote HSM adapter (Bearer + env, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Talks to a remote HSM/vault signing endpoint:
 *
 *   POST {base}/sign   body {keyRef, digestHex}   Authorization: Bearer <token>
 *   GET  {base}/keys   Authorization: Bearer <token>
 *
 * The bearer token comes from HSM_TOKEN and the base URL from HSM_ENDPOINT
 * (or explicit options, e.g. tests). Missing or empty either → the
 * constructor throws (fail-closed, before any request can be made).
 * Uses the global fetch — no SDK dependency, no ambient credentials beyond
 * the two env names.
 */
export class VaultBackedSigner implements HsmSigner {
  private readonly base: string;
  private readonly token: string;

  constructor(opts?: { baseUrl?: string; token?: string }) {
    const base = (opts?.baseUrl ?? process.env.HSM_ENDPOINT ?? "").trim();
    const token = (opts?.token ?? process.env.HSM_TOKEN ?? "").trim();
    if (!base) throw new HsmSignerError("HSM_E_NOT_CONFIGURED", "HSM_ENDPOINT is not set — refusing to construct a remote signer");
    if (!token) throw new HsmSignerError("HSM_E_NOT_CONFIGURED", "HSM_TOKEN is not set — refusing to construct a remote signer");
    if (!/^https?:\/\//.test(base)) {
      throw new HsmSignerError("HSM_E_NOT_CONFIGURED", "HSM_ENDPOINT must be an http(s) URL");
    }
    this.base = base.replace(/\/+$/, "");
    this.token = token;
  }

  private headers(): HeadersInit {
    return { authorization: `Bearer ${this.token}`, "content-type": "application/json" };
  }

  private async fetchJson(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, init);
    } catch (err) {
      throw new HsmSignerError("HSM_E_REMOTE", `HSM ${path} transport failed: ${(err as Error)?.name ?? "error"}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new HsmSignerError("HSM_E_REMOTE_BAD_RESPONSE", `HSM ${path} returned HTTP ${res.status} with a non-JSON body`);
    }
    if (!res.ok) {
      const code = (body as { error?: unknown })?.error;
      if (code === "HSM_E_UNKNOWN_KEY") {
        throw new HsmSignerError("HSM_E_UNKNOWN_KEY", `remote HSM has no key for this keyRef (HTTP ${res.status})`);
      }
      throw new HsmSignerError("HSM_E_REMOTE", `HSM ${path} returned HTTP ${res.status}`);
    }
    return body;
  }

  async sign(digest: Uint8Array, keyRef: string): Promise<Uint8Array> {
    assertDigest(digest);
    assertKeyRef(keyRef);
    const body = (await this.fetchJson("/sign", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ keyRef, digestHex: bytesToHex(digest) }),
    })) as { ok?: unknown; signatureHex?: unknown; signature?: unknown };
    // Accepts the seam response ({signatureHex}) and the deployed hsm-runtime
    // field name ({signature}) — both are hex strings per the wire contract.
    const sigHex = body?.signatureHex ?? body?.signature;
    if (typeof sigHex !== "string") {
      throw new HsmSignerError("HSM_E_REMOTE_BAD_RESPONSE", "HSM /sign response carries no signature hex");
    }
    return hexToBytes(sigHex);
  }

  async publicKey(keyRef: string): Promise<Uint8Array> {
    assertKeyRef(keyRef);
    const body = (await this.fetchJson("/keys", { method: "GET", headers: this.headers() })) as {
      keys?: Array<{ id?: unknown; keyRef?: unknown; publicKey?: unknown }>;
    };
    const keys = Array.isArray(body?.keys) ? body.keys : [];
    for (const k of keys) {
      const id = typeof k?.id === "string" ? k.id : typeof k?.keyRef === "string" ? k.keyRef : undefined;
      if (id === keyRef) {
        if (typeof k.publicKey !== "string") {
          throw new HsmSignerError("HSM_E_REMOTE_BAD_RESPONSE", "HSM /keys entry carries no publicKey hex");
        }
        return hexToBytes(k.publicKey);
      }
    }
    throw new HsmSignerError("HSM_E_UNKNOWN_KEY", "remote HSM key list has no entry for this keyRef");
  }

  async listKeys(): Promise<string[]> {
    const body = (await this.fetchJson("/keys", { method: "GET", headers: this.headers() })) as {
      keys?: Array<{ id?: unknown; keyRef?: unknown }>;
    };
    const keys = Array.isArray(body?.keys) ? body.keys : [];
    const ids: string[] = [];
    for (const k of keys) {
      const id = typeof k?.id === "string" ? k.id : typeof k?.keyRef === "string" ? k.keyRef : undefined;
      if (typeof id === "string") ids.push(id);
    }
    return ids.sort();
  }
}
