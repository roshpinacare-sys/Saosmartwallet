/**
 * packages/hsm-runtime — the signing engine
 * ==========================================
 * PRODUCTION signing over the packages/vault AES-256-GCM store. The laws:
 *
 *   • Key material exists ONLY inside the vault session. Every signature
 *     flows through vault.withKey (scoped unseal → use → zero-fill); this
 *     module never receives, stores, or logs a seed/WIF.
 *   • Steem-family wire truth comes from packages/chains (M0/M1 oracle-proven
 *     serializer): digest = sha256(chain_id ‖ serialized_tx); signature =
 *     65-byte secp256k1 compact [31+recid, r, s] (packages/crypto, RFC6979);
 *     wire = digest ‖ varint(count) ‖ sigs. Steem chain id = 32 zero bytes
 *     (chain-proven constant); blurt = EXPLICIT 64-hex id, refused if absent.
 *   • Role policy is fail-closed: funds-class ops REQUIRE an active/owner
 *     role; key-rotation (account_update) REQUIRES owner; posting-class ops
 *     accept posting/active/owner; a key without role meta signs NOTHING.
 *   • Transaction sanity: non-empty ops, expiration within [now, now+3600s]
 *     — the chain's own window, enforced before any signing work.
 *   • Every act yields a receipt with wire digests. Nothing here broadcasts:
 *     there is no broadcast path, structurally.
 */

import type { Vault } from "../../vault/src/vault";
import { VaultError } from "../../vault/src/errors";
import { openVault } from "../../vault/src/index";
import { PrivateKey, recoverFromCompact } from "../../crypto/src/index";
import {
  appendSignatures,
  transactionDigest,
  transactionId,
  STEEM_CHAIN_ID,
  type SteemTransaction,
} from "../../chains/steem/src/transaction";
import { BLURT_OP_IDS, OP_IDS, type OpIdTable, type SteemOperationName } from "../../chains/steem/src/operations";
import { blurtChainIdFromHex } from "../../chains/blurt/src/adapter";

import { HsmError } from "./errors";
import type { HsmConfig } from "./config";
import { finalizeReceipt, sha256Hex, type ReceiptBody, type SignReceipt } from "./receipt";
import type { KeyMetaLike } from "./health";

/** Maximum message size for the ed25519 bytes route (bounded inputs). */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** The chain's own transaction-expiration window, in seconds. */
export const MAX_EXPIRATION_WINDOW_SECONDS = 3600;

/** Ops that move/commit funds or mutate account state — active/owner authority. */
const FUNDS_OPS = new Set<SteemOperationName>(["transfer", "limit_order_create", "limit_order_cancel", "convert"]);
/** Key rotation — owner authority ONLY (can replace every key on the account). */
const OWNER_OPS = new Set<SteemOperationName>(["account_update"]);
/** Posting-class ops — the soldier/agent daily hands. */
const POSTING_OPS = new Set<SteemOperationName>(["vote", "comment", "custom_json", "claim_reward_balance"]);

type Role = "posting" | "active" | "owner";

export function roleOf(meta: Record<string, unknown> | null): Role | null {
  const r = meta?.role;
  if (typeof r !== "string") return null;
  return r === "posting" || r === "active" || r === "owner" ? r : null;
}

function accountOf(meta: Record<string, unknown> | null): string | undefined {
  const a = meta?.account;
  return typeof a === "string" && a.length > 0 ? a : undefined;
}

function assertRoleSufficient(role: Role | null, ops: SteemOperationName[]): void {
  if (role === null) {
    throw new HsmError(
      "HSM_E_ROLE_POLICY",
      "key carries no role metadata — refusing to sign anything (fail-closed; re-seal with meta.role)",
    );
  }
  for (const name of ops) {
    if (OWNER_OPS.has(name) && role !== "owner") {
      throw new HsmError("HSM_E_ROLE_POLICY", `operation "${name}" requires owner authority, key role is "${role}"`);
    }
    if (FUNDS_OPS.has(name) && role === "posting") {
      throw new HsmError("HSM_E_ROLE_POLICY", `operation "${name}" moves funds and cannot be signed with a posting key (role "${role}")`);
    }
  }
}

function opIdsFor(chain: "steem" | "blurt"): OpIdTable {
  // blurt maps custom_json to wire tag 0x0c — BLURT_OP_IDS lives in
  // packages/chains/steem/src/operations.ts (r20 node-proven table).
  return chain === "blurt" ? BLURT_OP_IDS : OP_IDS;
}

function chainIdFor(chain: "steem" | "blurt", blurtChainIdHex: string | null): Uint8Array {
  if (chain === "steem") return STEEM_CHAIN_ID;
  if (typeof blurtChainIdHex !== "string") {
    throw new HsmError(
      "HSM_E_CHAIN_ID",
      "blurt chain id required: set HSM_BLURT_CHAIN_ID (64 hex) — the runtime never guesses a chain id (fail-closed)",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(blurtChainIdHex)) {
    throw new HsmError("HSM_E_CHAIN_ID", `blurt chain id must be exactly 64 hex chars, got ${blurtChainIdHex.length} chars`);
  }
  return blurtChainIdFromHex(blurtChainIdHex);
}

function assertSaneTransaction(tx: SteemTransaction, now: number): void {
  if (!tx || typeof tx !== "object") {
    throw new HsmError("HSM_E_BAD_INPUT", "tx must be an object");
  }
  if (!Number.isInteger(tx.refBlockNum) || tx.refBlockNum < 0 || tx.refBlockNum > 0xffff) {
    throw new HsmError("HSM_E_BAD_INPUT", "tx.refBlockNum must be a uint16");
  }
  if (!Number.isInteger(tx.refBlockPrefix) || tx.refBlockPrefix < 0 || tx.refBlockPrefix > 0xffffffff) {
    throw new HsmError("HSM_E_BAD_INPUT", "tx.refBlockPrefix must be a uint32");
  }
  if (!Number.isInteger(tx.expiration)) {
    throw new HsmError("HSM_E_BAD_INPUT", "tx.expiration must be unix seconds (integer)");
  }
  const nowSec = Math.floor(now / 1000);
  if (tx.expiration < nowSec) {
    throw new HsmError("HSM_E_BAD_INPUT", `tx.expiration ${tx.expiration} is already past (now ${nowSec}) — refusing a stale transaction`);
  }
  if (tx.expiration > nowSec + MAX_EXPIRATION_WINDOW_SECONDS) {
    throw new HsmError(
      "HSM_E_BAD_INPUT",
      `tx.expiration ${tx.expiration} exceeds the chain window (now+${MAX_EXPIRATION_WINDOW_SECONDS}s) — refusing`,
    );
  }
  if (!Array.isArray(tx.operations) || tx.operations.length === 0) {
    throw new HsmError("HSM_E_BAD_INPUT", "tx.operations must be a non-empty array");
  }
  for (const op of tx.operations) {
    if (!POSTING_OPS.has(op.name) && !FUNDS_OPS.has(op.name) && !OWNER_OPS.has(op.name)) {
      throw new HsmError("HSM_E_BAD_INPUT", `operation "${String(op.name)}" is not in the supported signing set`);
    }
  }
}

export interface SignSteemInput {
  chain: "steem" | "blurt";
  tx: SteemTransaction;
  keyId: string;
  blurtChainIdHex?: string | null;
  now: number;
}

export interface SignBytesInput {
  keyId: string;
  message: Buffer;
  now: number;
}

export interface OpenSignerOptions {
  vaultDir: string | null;
}

/**
 * The signing engine over one opened vault session. Construct ONLY via
 * HsmSigner.open() — it maps vault failures to honest HSM_E_VAULT_SEALED.
 */
export class HsmSigner {
  private constructor(private readonly vault: Vault) {}

  static async open(options: OpenSignerOptions): Promise<HsmSigner> {
    if (typeof options.vaultDir !== "string" || options.vaultDir.length === 0) {
      throw new HsmError(
        "HSM_E_VAULT_SEALED",
        "HSM_VAULT_DIR is unset — there is no vault to load keys from (fail-closed)",
      );
    }
    try {
      const vault = await openVault({ dir: options.vaultDir });
      return new HsmSigner(vault);
    } catch (e) {
      const code = e instanceof VaultError ? e.code : "VAULT_E_STORE_CORRUPT";
      throw new HsmError("HSM_E_VAULT_SEALED", `vault refused to open (code ${code})`);
    }
  }

  /** Metadata only — ids/types/meta/createdAt. Never envelopes, never material. */
  metadata(): KeyMetaLike[] {
    return this.vault.listKeys();
  }

  hasSigningKeys(): boolean {
    return this.metadata().some((k) => k.type === "ed25519" || k.type === "secp256k1-wif");
  }

  /** Steem-family (STEEM/BLURT) signing — secp256k1 keys. */
  async signSteemFamily(input: SignSteemInput): Promise<SignReceipt> {
    assertSaneTransaction(input.tx, input.now);
    const key = this.requireKey(input.keyId, "secp256k1-wif");
    assertRoleSufficient(roleOf(key.meta), input.tx.operations.map((o) => o.name));

    const chainId = chainIdFor(input.chain, input.blurtChainIdHex ?? null);
    const digest = transactionDigest(input.tx, chainId, opIdsFor(input.chain));

    let sig65Hex = "";
    let pub33Hex = "";
    await this.vault.withKey(input.keyId, (unsealed) => {
      const pk = PrivateKey.fromBytes(unsealed.material);
      sig65Hex = Buffer.from(pk.signRecoverable(digest)).toString("hex");
      pub33Hex = Buffer.from(pk.publicKey.bytes).toString("hex");
    });
    if (sig65Hex.length === 0) {
      throw new HsmError("HSM_E_BAD_INPUT", "signing produced no signature");
    }

    // Verifiability gate: the signature MUST recover to the key's OWN public
    // key — a receipt can never carry a signature its key did not produce.
    const recovered = recoverFromCompact(Buffer.from(sig65Hex, "hex"), digest);
    if (Buffer.from(recovered).toString("hex") !== pub33Hex) {
      throw new HsmError("HSM_E_BAD_INPUT", "signature recovery mismatch — refusing to emit a receipt");
    }

    const wire = appendSignatures(digest, [sig65Hex]);
    const body: ReceiptBody = {
      at: new Date(input.now).toISOString(),
      service: "saos-hsm-runtime/1",
      mode: "SIGN-ONLY",
      broadcast: "DISABLED",
      kind: "steem-family",
      chain: input.chain,
      keyId: input.keyId,
      keyType: key.type,
      digest: Buffer.from(digest).toString("hex"),
      txId: transactionId(input.tx),
      wireHex: Buffer.from(wire).toString("hex"),
      wireSha256: sha256Hex(wire),
      wireSignatures: [sig65Hex],
      signatureCount: 1,
      policy: {
        broadcast: false,
        role: roleOf(key.meta) ?? undefined,
        account: accountOf(key.meta),
      },
    };
    return finalizeReceipt(body);
  }

  /** ed25519 raw-bytes signing (identity proofs, cross-chain payloads). */
  async signBytes(input: SignBytesInput): Promise<SignReceipt> {
    if (!Buffer.isBuffer(input.message) || input.message.length === 0) {
      throw new HsmError("HSM_E_BAD_INPUT", "message must be a non-empty Buffer");
    }
    if (input.message.length > MAX_MESSAGE_BYTES) {
      throw new HsmError("HSM_E_BAD_INPUT", `message exceeds ${MAX_MESSAGE_BYTES} bytes`);
    }
    const key = this.requireKey(input.keyId, "ed25519");
    const sig = await this.vault.signEd25519(input.keyId, input.message);
    const wire = Buffer.concat([input.message, sig]);
    const body: ReceiptBody = {
      at: new Date(input.now).toISOString(),
      service: "saos-hsm-runtime/1",
      mode: "SIGN-ONLY",
      broadcast: "DISABLED",
      kind: "ed25519",
      keyId: input.keyId,
      keyType: key.type,
      digest: sha256Hex(input.message),
      wireHex: wire.toString("hex"),
      wireSha256: sha256Hex(wire),
      signatureHex: sig.toString("hex"),
      signatureCount: 1,
      policy: {
        broadcast: false,
        role: roleOf(key.meta) ?? undefined,
        account: accountOf(key.meta),
      },
    };
    return finalizeReceipt(body);
  }

  /** Raw 32-byte ed25519 public key for an id (public data). */
  async publicKeyEd25519(keyId: string): Promise<Buffer> {
    this.requireKey(keyId, "ed25519");
    return this.vault.ed25519PublicKey(keyId);
  }

  /** Verifiability helper — proves a steem signature recovers to `digest`. */
  verifySteemSignature(signatureHex: string, digest: Uint8Array): Uint8Array {
    const raw = Buffer.from(signatureHex, "hex");
    if (raw.length !== 65) {
      throw new HsmError("HSM_E_BAD_INPUT", "signature must be 65 bytes");
    }
    return recoverFromCompact(raw, digest);
  }

  private requireKey(keyId: string, wanted: "ed25519" | "secp256k1-wif"): KeyMetaLike {
    const listing = this.metadata();
    const key = listing.find((k) => k.id === keyId);
    if (!key) {
      throw new HsmError("HSM_E_UNKNOWN_KEY", `no key sealed under id "${keyId.slice(0, 64)}"`);
    }
    if (key.type !== wanted) {
      throw new HsmError("HSM_E_KEY_TYPE", `key "${keyId.slice(0, 64)}" is type "${key.type}", not "${wanted}"`);
    }
    return key;
  }
}

/** Measures whether the vault at `cfg.vaultDir` opens — without keeping it. */
export async function probeVault(cfg: HsmConfig): Promise<{ open: boolean; reason: string | null }> {
  if (cfg.vaultDir === null) {
    return { open: false, reason: "HSM_VAULT_DIR-unset" };
  }
  try {
    const signer = await HsmSigner.open({ vaultDir: cfg.vaultDir });
    void signer.metadata(); // prove the listing works
    return { open: true, reason: null };
  } catch (e) {
    const m = /code ([A-Z_]+)\)/.exec((e as Error).message);
    return { open: false, reason: m ? m[1] : "VAULT_E_STORE_CORRUPT" };
  }
}
