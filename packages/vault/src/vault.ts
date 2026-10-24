/**
 * Saosmartwallet — AES-256-GCM encrypted local key vault (task 4-b)
 * =================================================================
 * The production-grade HSM-signing-runtime key store for owner directive §3/§8:
 * at-rest envelope encryption of every key the sovereign wallet operates.
 *
 * MASTER KEY (directive §11 — hard invariants):
 *   • Source: ONLY the env var SAOS_VAULT_MASTER_KEY (64 hex chars = 32 bytes).
 *   • Never persisted, never logged, never echoed — not in errors, not in
 *     store files, not in listKeys output.
 *   • Missing / malformed ⇒ VAULT_E_ENV_MISSING / VAULT_E_ENV_INVALID (fail-closed).
 *
 * STORE FORMAT (state/keys.enc, JSON, never committed — see .gitignore):
 *   { version: 1,
 *     store: { salt,                    // per-store, 32 random bytes (hex)
 *              verify: {iv,authTag,ciphertext} },   // GCM("saos-vault/verify/v1")
 *     keys:  [ { id, type: "ed25519"|"secp256k1-wif"|"opaque",
 *                salt, iv, authTag, ciphertext, meta, createdAt }, ... ] }
 *
 *   Every key gets a fresh random 12-byte IV; AES-256-GCM authenticates the
 *   ciphertext. The verify block proves the master key at openVault — BEFORE
 *   any key material is touched — even for an empty store.
 *
 * FAIL-CLOSED MATRIX (all enforced, all pinned by test/vault.test.ts):
 *   missing/bad env, unknown id, duplicate id, wrong-length material,
 *   corrupt JSON, schema deviation, salt mismatch, tampered ciphertext/tag,
 *   wrong master key, oversized store, concurrent foreign salt ⇒ throw.
 *   No null-then-continue, no partial material, no fallback paths.
 *
 * CONCURRENCY MODEL: a Vault instance is a single-writer session. persist()
 * re-reads the file and MERGES envelopes that appeared since our open
 * (disk truth ∪ our keys) so a stale writer can never silently drop
 * someone else's key. A foreign salt on disk ⇒ VAULT_E_STORE_CONFLICT,
 * and an unreadable disk store is NEVER clobbered.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveAesKey,
  gcmOpen,
  gcmSeal,
  MAX_STORE_FILE_BYTES,
  toHex,
  validateStoreFile,
  VAULT_KEY_TYPES,
  type SealedEnvelope,
  type VaultKeyType,
  isVaultKeyType,
} from "./envelope";
import { ed25519PublicKey, ed25519Sign } from "./ed25519";
import { VaultError } from "./errors";
import { wifDecode } from "./wif";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENV_NAME = "SAOS_VAULT_MASTER_KEY";
const STORE_FILE_NAME = "keys.enc";
const SALT_BYTES = 32;
const MAX_ID_CHARS = 512;
/** Constant plaintext sealed into the store verify block. */
const VERIFY_PLAINTEXT = Buffer.from("saos-vault/verify/v1", "utf8");
/** secp256k1 group order (SEC2) — scalar validation without any dependency. */
const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

/** Canonical store location: packages/vault/state (gitignored). */
export const DEFAULT_VAULT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "state",
);

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface OpenVaultOptions {
  /** Store directory. Defaults to packages/vault/state. */
  dir?: string;
}

/** Sealed representation of a key — hex fields only, never any plaintext. */
export type SealedRecord = SealedEnvelope;

/** What unsealKey / withKey hand to their caller. Caller owns the material. */
export interface UnsealedKey {
  type: VaultKeyType;
  material: Buffer;
  meta: Record<string, unknown> | null;
}

export interface KeyMetadata {
  id: string;
  type: VaultKeyType;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface SealKeyInput {
  id: string;
  type: VaultKeyType;
  /**
   * ed25519       → 32-byte seed Buffer, or a 64-hex-char seed string
   * secp256k1-wif → 32-byte scalar Buffer, or a base58check WIF string
   *                 (WIF strings are WIF only — never hex — to keep inputs
   *                 unambiguous; hex scalars go in as Buffers)
   * opaque        → arbitrary non-empty Buffer, or a UTF-8 string
   */
  material: Buffer | string;
  /** Optional public metadata (must survive a JSON round-trip). */
  meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Master key gate (the ONLY source of the master key)
// ---------------------------------------------------------------------------

/** Reads + validates SAOS_VAULT_MASTER_KEY; never echoes the value. */
export function loadMasterKeyFromEnv(): Buffer {
  const raw = process.env[ENV_NAME];
  if (raw === undefined || raw.length === 0) {
    throw new VaultError(
      "VAULT_E_ENV_MISSING",
      `${ENV_NAME} is not set — refusing to open the vault (fail-closed)`,
    );
  }
  // Tolerate benign whitespace (docker secrets / env files commonly add \n).
  const trimmed = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new VaultError(
      "VAULT_E_ENV_INVALID",
      `${ENV_NAME} must be exactly 64 hex chars (32 bytes) — got ${trimmed.length} chars`,
    );
  }
  return Buffer.from(trimmed, "hex");
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

/**
 * A single-writer vault session. Construct ONLY via openVault() — the
 * constructor is exported only so openVault (module scope) can instantiate;
 * it performs no validation of its own.
 */
export class Vault {
  constructor(
    private readonly dir: string,
    private readonly master: Buffer,
    private readonly saltHex: string,
    private readonly verifyBlock: { iv: string; authTag: string; ciphertext: string },
    private keys: Map<string, SealedEnvelope>,
    private lastDisk: Buffer | null,
  ) {}

  // ------------------------------------------------------------------ seal

  /** Encrypts + persists a new key. Duplicate ids and bad material fail closed. */
  async sealKey(unsealed: SealKeyInput): Promise<SealedRecord> {
    const id = requireValidId(unsealed?.id);
    if (this.keys.has(id)) {
      throw new VaultError("VAULT_E_DUPLICATE_ID", `a key is already sealed under id "${id}"`);
    }
    const type = unsealed.type;
    if (!isVaultKeyType(type)) {
      throw new VaultError(
        "VAULT_E_BAD_INPUT",
        `key type must be one of: ${VAULT_KEY_TYPES.join(", ")}`,
      );
    }
    assertJsonSerializableMeta(unsealed.meta, id);

    const wipe: Buffer[] = [];
    try {
      const material = normalizeMaterial(type, unsealed.material, wipe);
      const aesKey = deriveAesKey(this.master, Buffer.from(this.saltHex, "hex"), "key");
      let block: { iv: string; authTag: string; ciphertext: string };
      try {
        block = gcmSeal(aesKey, material);
      } finally {
        aesKey.fill(0);
      }
      const envelope: SealedEnvelope = {
        id,
        type,
        salt: this.saltHex,
        iv: block.iv,
        authTag: block.authTag,
        ciphertext: block.ciphertext,
        meta: unsealed.meta ?? null,
        createdAt: new Date().toISOString(),
      };
      this.keys.set(id, envelope);
      try {
        this.persist();
      } catch (persistError) {
        this.keys.delete(id); // keep memory consistent with disk — fail closed
        throw persistError;
      }
      return { ...envelope };
    } finally {
      for (const b of wipe) b.fill(0); // best-effort zeroization of copies
    }
  }

  // ---------------------------------------------------------------- unseal

  /** Decrypts one key envelope. Unknown id / auth failure ⇒ throw (no material). */
  async unsealKey(id: string): Promise<UnsealedKey> {
    requireValidId(id);
    const envelope = this.keys.get(id);
    if (!envelope) {
      throw new VaultError("VAULT_E_UNKNOWN_ID", `no key sealed under id "${id}"`);
    }
    const material = this.decryptEnvelope(envelope);
    return { type: envelope.type, material, meta: cloneMeta(envelope.meta) };
  }

  /**
   * Runs `fn` with the unsealed key, then ZERO-FILLS the material buffer
   * whether fn resolved or rejected (best-effort JS zeroization), and passes
   * fn's return value through. fn must not retain the buffer beyond the call.
   */
  async withKey<T>(id: string, fn: (key: UnsealedKey) => T | Promise<T>): Promise<T> {
    const key = await this.unsealKey(id);
    try {
      return await fn(key);
    } finally {
      key.material.fill(0);
    }
  }

  // ----------------------------------------------------------------- signs

  /** Unseals an ed25519 key and signs `message`; the seed is never exposed. */
  async signEd25519(id: string, message: Buffer): Promise<Buffer> {
    if (!Buffer.isBuffer(message)) {
      throw new VaultError("VAULT_E_BAD_INPUT", "ed25519 message must be a Buffer");
    }
    return this.withKey(id, (key) => {
      if (key.type !== "ed25519") {
        throw new VaultError("VAULT_E_BAD_INPUT", `key "${id}" is type "${key.type}", not ed25519`);
      }
      return ed25519Sign(key.material, message);
    });
  }

  /** Derives the raw 32-byte ed25519 public key for an id (public data). */
  async ed25519PublicKey(id: string): Promise<Buffer> {
    return this.withKey(id, (key) => {
      if (key.type !== "ed25519") {
        throw new VaultError("VAULT_E_BAD_INPUT", `key "${id}" is type "${key.type}", not ed25519`);
      }
      return ed25519PublicKey(key.material);
    });
  }

  // ------------------------------------------------------------ inspecting

  /** Metadata ONLY — ids/types/meta/createdAt. Never material, never envelope fields. */
  listKeys(): KeyMetadata[] {
    return [...this.keys.values()].map((env) => ({
      id: env.id,
      type: env.type,
      meta: cloneMeta(env.meta),
      createdAt: env.createdAt,
    }));
  }

  // -------------------------------------------------------------- internal

  private decryptEnvelope(envelope: SealedEnvelope): Buffer {
    const aesKey = deriveAesKey(this.master, Buffer.from(this.saltHex, "hex"), "key");
    try {
      return gcmOpen(
        aesKey,
        Buffer.from(envelope.iv, "hex"),
        Buffer.from(envelope.authTag, "hex"),
        Buffer.from(envelope.ciphertext, "hex"),
        `key "${envelope.id}"`,
      );
    } finally {
      aesKey.fill(0);
    }
  }

  /**
   * Atomic persistence (tmp file + rename, 0600). Delegates the merge-on-disk-
   * change policy to persistStore(); adopts its merged key view afterwards.
   */
  private persist(): void {
    const written = persistStore(this.dir, this.saltHex, this.verifyBlock, this.keys, this.lastDisk);
    this.lastDisk = written.json;
    if (written.keys !== this.keys) this.keys = written.keys;
  }
}

// ---------------------------------------------------------------------------
// Persistence (module-level so openVault can establish a fresh store too)
// ---------------------------------------------------------------------------

interface PersistedState {
  json: Buffer;
  keys: Map<string, SealedEnvelope>;
}

/**
 * Atomic persistence (tmp file + rename, 0600). If the on-disk store changed
 * since our last read/write, its envelopes are MERGED (disk truth ∪ ours);
 * a foreign salt or an unreadable disk store aborts the write — we never
 * clobber a store we cannot fully validate.
 */
function persistStore(
  dir: string,
  saltHex: string,
  verifyBlock: { iv: string; authTag: string; ciphertext: string },
  keys: Map<string, SealedEnvelope>,
  lastDisk: Buffer | null,
): PersistedState {
  const filePath = path.join(dir, STORE_FILE_NAME);
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;

  let keysToWrite = keys;
  if (current !== null && (lastDisk === null || !current.equals(lastDisk))) {
    const diskStore = parseStoreBytes(current); // throws on corrupt — no clobber
    if (diskStore.store.salt !== saltHex) {
      throw new VaultError(
        "VAULT_E_STORE_CONFLICT",
        "on-disk vault store was re-created with a different salt — refusing to overwrite (fail-closed)",
      );
    }
    const merged = new Map<string, SealedEnvelope>();
    for (const env of diskStore.keys) merged.set(env.id, env);
    for (const [id, env] of keys) merged.set(id, env); // ours wins on id collision
    keysToWrite = merged;
  }

  const file = {
    version: 1 as const,
    store: { salt: saltHex, verify: verifyBlock },
    keys: [...keysToWrite.values()],
  };
  const json = Buffer.from(JSON.stringify(file, null, 2), "utf8");
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  fs.writeFileSync(tmpPath, json, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  fs.chmodSync(filePath, 0o600);
  return { json, keys: keysToWrite };
}

// ---------------------------------------------------------------------------
// openVault — store init / load (all fail-closed)
// ---------------------------------------------------------------------------

/** Opens (or establishes) the encrypted store; the master key gate runs first. */
export async function openVault(options: OpenVaultOptions = {}): Promise<Vault> {
  const master = loadMasterKeyFromEnv();
  const dir = options.dir ?? DEFAULT_VAULT_DIR;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const filePath = path.join(dir, STORE_FILE_NAME);
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;

  if (raw === null) {
    // Fresh store: generate the per-store salt, seal the verify block, persist
    // immediately so wrong-master-key detection works even before the first seal.
    const saltHex = toHex(randomBytes(SALT_BYTES));
    const aesKey = deriveAesKey(master, Buffer.from(saltHex, "hex"), "verify");
    let verify: { iv: string; authTag: string; ciphertext: string };
    try {
      verify = gcmSeal(aesKey, VERIFY_PLAINTEXT);
    } finally {
      aesKey.fill(0);
    }
    const written = persistStore(dir, saltHex, verify, new Map(), null);
    return new Vault(dir, master, saltHex, verify, written.keys, written.json);
  }

  if (raw.length > MAX_STORE_FILE_BYTES) {
    throw new VaultError(
      "VAULT_E_STORE_CORRUPT",
      `vault store file exceeds ${MAX_STORE_FILE_BYTES} bytes — refusing to load`,
    );
  }

  const store = parseStoreBytes(raw);

  // Prove the master key against the verify block BEFORE touching key envelopes.
  const aesKey = deriveAesKey(master, Buffer.from(store.store.salt, "hex"), "verify");
  try {
    const plaintext = gcmOpen(
      aesKey,
      Buffer.from(store.store.verify.iv, "hex"),
      Buffer.from(store.store.verify.authTag, "hex"),
      Buffer.from(store.store.verify.ciphertext, "hex"),
      "the store verification block",
    );
    if (!plaintext.equals(VERIFY_PLAINTEXT)) {
      throw new VaultError(
        "VAULT_E_AUTH",
        "vault master key rejected — store verification block mismatch",
      );
    }
  } finally {
    aesKey.fill(0);
  }

  const keys = new Map<string, SealedEnvelope>();
  for (const env of store.keys) keys.set(env.id, env);
  return new Vault(dir, master, store.store.salt, store.store.verify, keys, raw);
}

/** JSON-parse + schema-validate raw store bytes (fail-closed, no content echo). */
function parseStoreBytes(raw: Buffer): ReturnType<typeof validateStoreFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new VaultError("VAULT_E_STORE_CORRUPT", "vault store is not valid JSON");
  }
  return validateStoreFile(parsed);
}

// ---------------------------------------------------------------------------
// Input normalization (fail-closed, material handled only in copies)
// ---------------------------------------------------------------------------

function requireValidId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new VaultError("VAULT_E_BAD_INPUT", "key id must be a non-empty string");
  }
  if (id.length > MAX_ID_CHARS) {
    throw new VaultError("VAULT_E_BAD_INPUT", `key id exceeds ${MAX_ID_CHARS} characters`);
  }
  if (id.trim().length === 0) {
    throw new VaultError("VAULT_E_BAD_INPUT", "key id must not be blank");
  }
  return id;
}

function assertJsonSerializableMeta(meta: unknown, id: string): void {
  if (meta === undefined || meta === null) return;
  try {
    JSON.stringify(meta);
  } catch {
    throw new VaultError(
      "VAULT_E_BAD_INPUT",
      `meta for key "${id}" must be JSON-serializable (no cycles, plain data only)`,
    );
  }
}

/**
 * Normalizes sealKey material per key type into a fresh working Buffer that
 * the caller registers for zeroization. All validation is fail-closed and
 * messages carry shapes/lengths only — never content.
 */
function normalizeMaterial(type: VaultKeyType, material: Buffer | string, wipe: Buffer[]): Buffer {
  if (Buffer.isBuffer(material)) {
    return validateMaterialBytes(type, material, wipe);
  }
  if (typeof material !== "string") {
    throw new VaultError("VAULT_E_BAD_INPUT", "material must be a Buffer or a string");
  }
  switch (type) {
    case "ed25519": {
      if (!/^[0-9a-fA-F]{64}$/.test(material)) {
        throw new VaultError(
          "VAULT_E_BAD_INPUT",
          "ed25519 seed string must be exactly 64 hex chars (or pass a 32-byte Buffer)",
        );
      }
      const seed = Buffer.from(material, "hex");
      assertNonZeroSeed(seed);
      wipe.push(seed);
      return seed;
    }
    case "secp256k1-wif": {
      // WIF strings are WIF only — a 64-hex string here is a caller error.
      if (/^[0-9a-fA-F]{64}$/.test(material)) {
        throw new VaultError(
          "VAULT_E_BAD_INPUT",
          "secp256k1-wif string material must be a WIF (base58check) — pass raw scalars as Buffers",
        );
      }
      const { secret } = wifDecode(material);
      assertValidScalar(secret);
      wipe.push(secret);
      return secret;
    }
    case "opaque": {
      if (material.length === 0) {
        throw new VaultError("VAULT_E_BAD_INPUT", "opaque material must not be empty");
      }
      const bytes = Buffer.from(material, "utf8");
      wipe.push(bytes);
      return bytes;
    }
  }
}

function validateMaterialBytes(type: VaultKeyType, material: Buffer, wipe: Buffer[]): Buffer {
  const copy = Buffer.from(material); // defensive copy — caller owns the original
  switch (type) {
    case "ed25519": {
      if (copy.length !== 32) {
        throw new VaultError("VAULT_E_BAD_INPUT", `ed25519 seed must be exactly 32 bytes, got ${copy.length}`);
      }
      assertNonZeroSeed(copy);
      break;
    }
    case "secp256k1-wif": {
      if (copy.length !== 32) {
        throw new VaultError(
          "VAULT_E_BAD_INPUT",
          `secp256k1 secret must be exactly 32 bytes, got ${copy.length}`,
        );
      }
      assertValidScalar(copy);
      break;
    }
    case "opaque": {
      if (copy.length === 0) {
        throw new VaultError("VAULT_E_BAD_INPUT", "opaque material must not be empty");
      }
      break;
    }
  }
  wipe.push(copy);
  return copy;
}

function assertNonZeroSeed(seed: Buffer): void {
  if (seed.every((b) => b === 0)) {
    throw new VaultError("VAULT_E_BAD_INPUT", "ed25519 seed must not be all-zero");
  }
}

/** Scalar validation without secp256k1 math: 0 < s < N (SEC2 order constant). */
function assertValidScalar(secret: Buffer): void {
  if (secret.length !== 32) {
    throw new VaultError("VAULT_E_BAD_INPUT", `secp256k1 secret must be exactly 32 bytes, got ${secret.length}`);
  }
  if (secret.every((b) => b === 0)) {
    throw new VaultError("VAULT_E_BAD_INPUT", "secp256k1 secret must not be zero");
  }
  if (BigInt(`0x${secret.toString("hex")}`) >= SECP256K1_N) {
    throw new VaultError("VAULT_E_BAD_INPUT", "secp256k1 secret must be below the curve order");
  }
}

function cloneMeta(meta: Record<string, unknown> | null): Record<string, unknown> | null {
  if (meta === null) return null;
  const clone = structuredClone(meta);
  return clone as Record<string, unknown>;
}
