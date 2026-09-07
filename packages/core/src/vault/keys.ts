/**
 * Saosmartwallet — vault key sealing helpers (M2, layer 1)
 * ========================================================
 * VaultKeys is the ONLY sanctioned path for key material to enter or leave
 * the vault state document:
 *
 *   enter:  addKey()      — WIF in (caller-supplied), sealed payload out
 *   leave:  revealKey()   — sealed payload in, PrivateKey out (session key
 *                           required; used exclusively by the signing
 *                           orchestrator after policy approval)
 *
 * Security properties:
 *   • The plaintext WIF exists only inside the sealing/revealing call frame —
 *     it is never written to state, logs or error messages.
 *   • Each key is sealed under its own fresh content key (envelope format in
 *     ../crypto/cipher), keyed by the session's Argon2id master key.
 *   • The derived PUBLIC key is persisted alongside the payload so offline
 *     checks (policy, UI, audit) never need to unseal anything.
 */

import { PrivateKey } from "../../../crypto/src/index";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 as keccak256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";

import { seal, open } from "../crypto/cipher";
import { fromUtf8, utf8 } from "../encoding";
import { VaultError, type CipherAlgorithm, type EncryptedKey, type KeyRole, type NetworkId, type StorageKind, type VaultStateDoc } from "../types";

/**
 * Public-key string prefix per network.
 *
 * steem / hive / saos-net share the STM-style "PREFIX + base58(key ‖
 * ripemd160-check)" identity (hive intentionally kept the STM prefix; saos-
 * net is a steem-family fork). blurt uses BLT. tron / ethereum / solana have
 * completely different identity schemes — we honestly report `null` for the
 * STM-family prefix and derive their NATIVE identity strings below:
 *   ethereum → EIP-55 checksum address (keccak256 of the uncompressed pubkey)
 *   solana   → base58 Ed25519 public key of the seed (see keyScheme below)
 */
const NETWORK_PUBKEY_PREFIX: Record<NetworkId, string | null> = {
  steem: "STM",
  hive: "STM",
  blurt: "BLT",
  tron: null,
  "saos-net": "STM",
  ethereum: null,
  solana: null,
};

/**
 * M3 unified key scheme (documented):
 *   The WIF pipeline stores 32 secp256k1 scalar bytes. Those SAME bytes are
 *   the cross-chain identity source:
 *     · steem-family — secp256k1 + STM/BLT encoding (unchanged)
 *     · ethereum     — same secp256k1 key, EIP-55 address = keccak(pub)[-20:]
 *     · solana       — the same 32 bytes interpreted as an Ed25519 SEED
 *   One vault secret, per-chain interpretation — no cross-chain key reuse
 *   of signatures, only of the seed material.
 */

/** EIP-55 checksum address from a 32-byte secp256k1 private key. */
function eip55AddressFromKeyBytes(privBytes: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privBytes, false); // 65-byte uncompressed
  const addrBytes = keccak256(pub.slice(1)).slice(-20);
  const hex = Buffer.from(addrBytes).toString("hex");
  const hash = Buffer.from(keccak256(new TextEncoder().encode(hex))).toString("hex");
  let out = "0x";
  for (let i = 0; i < hex.length; i++) {
    const nibble = Number.parseInt(hash[i]!, 16);
    out += nibble >= 8 ? hex[i]!.toUpperCase() : hex[i];
  }
  return out;
}

/** Solana address (base58 Ed25519 pubkey) from the 32-byte seed. */
function solanaAddressFromSeedBytes(seed: Uint8Array): string {
  return base58.encode(ed25519.getPublicKey(seed));
}

/** Input for VaultKeys.addKey — the WIF travels in memory only, never persisted. */
export interface AddKeyInput {
  /** Owning vault id (e.g. "network-steem", "purpose-treasury"). */
  vaultId: string;
  network: NetworkId;
  /** Steem-family role; null for flavor-less keys. Validated per network. */
  role: KeyRole | null;
  /** Account the key authenticates, when applicable. */
  account: string | null;
  /** Plaintext WIF — sealed immediately, never stored or logged. */
  wif: string;
  storage: StorageKind;
  algorithm?: CipherAlgorithm;
  /** Human label; defaults to "network:role". */
  label?: string;
}

const STEEM_FAMILY_ROLES: ReadonlySet<string> = new Set(["owner", "active", "posting", "memo"]);

export class VaultKeys {
  /**
   * Seals a WIF into the state document under the session's derived master
   * key and derives the public key string for offline use.
   *
   * Role/network acceptance rules (fail closed):
   *   • steem | hive | blurt → one of owner / active / posting / memo
   *   • tron                 → null or "owner"
   *   • saos-net             → one of owner / active / posting
   *   • ethereum | solana    → "active" only (single-key chains)
   *
   * Returns the new EncryptedKey record AND the next state (pure: the caller
   * — SovereignVault — owns persistence).
   *
   * @throws VaultError("VALIDATION") on role/network mismatch or an
   *   unparsable WIF. Error messages never contain the WIF.
   */
  static addKey(
    state: VaultStateDoc,
    derivedKey: Uint8Array,
    input: AddKeyInput,
  ): { record: EncryptedKey; state: VaultStateDoc } {
    if (derivedKey.length !== 32) {
      throw new VaultError("VALIDATION", "derived master key must be 32 bytes");
    }
    validateRoleForNetwork(input.network, input.role);

    // Parse the WIF once — a key that cannot be parsed cannot ever sign, so
    // sealing it would be storing a dead secret (and a false sense of coverage).
    let priv: PrivateKey;
    try {
      priv = PrivateKey.fromWif(input.wif);
    } catch {
      throw new VaultError("VALIDATION", "key material is not a valid WIF");
    }

    let publicKey: string | null = null;
    if (input.network === "ethereum") {
      try {
        publicKey = eip55AddressFromKeyBytes(priv.bytes);
      } catch {
        publicKey = null; // honest degradation — never invent an identity string
      }
    } else if (input.network === "solana") {
      try {
        publicKey = solanaAddressFromSeedBytes(priv.bytes);
      } catch {
        publicKey = null;
      }
    } else {
      const prefix = NETWORK_PUBKEY_PREFIX[input.network];
      if (prefix !== null) {
        try {
          publicKey = priv.publicKey.toString(prefix);
        } catch {
          publicKey = null; // honest degradation — never invent an identity string
        }
      }
    }

    const now = Date.now();
    const keyId = `key-${crypto.randomUUID()}`;
    const record: EncryptedKey = {
      keyId,
      vaultId: input.vaultId,
      network: input.network,
      role: input.role,
      account: input.account,
      label: input.label ?? (input.role ? `${input.network}:${input.role}` : input.network),
      algorithm: input.algorithm ?? "aes-256-gcm",
      payload: seal(utf8(input.wif), derivedKey, {
        algorithm: input.algorithm ?? "aes-256-gcm",
        keyId: "master-v1",
      }),
      publicKey,
      storage: input.storage,
      createdAt: now,
      lastUsedAt: null,
      status: "active",
    };

    return {
      record,
      state: { ...state, keys: { ...state.keys, [keyId]: record }, updatedAt: now },
    };
  }

  /**
   * The ONLY path from sealed ciphertext to a usable PrivateKey. Requires the
   * session's derived master key; callers are the signing orchestrator and
   * SovereignVault.revealKeyFor, both of which enforce unlock + policy first.
   *
   * @throws VaultError("DECRYPTION_FAILED") when the payload cannot be
   *   opened with the given key — with no key material in the message.
   */
  static revealKey(encryptedKey: EncryptedKey, derivedKey: Uint8Array): PrivateKey {
    let wif: string;
    try {
      wif = fromUtf8(open(encryptedKey.payload, derivedKey));
    } catch {
      throw new VaultError("DECRYPTION_FAILED", "key payload could not be opened with this session key");
    }
    try {
      return PrivateKey.fromWif(wif);
    } catch {
      throw new VaultError("DECRYPTION_FAILED", "sealed key material is corrupt");
    }
  }

  /**
   * All key records in creation order (payloads stay sealed — this is safe
   * metadata for UIs and audits).
   */
  static listKeys(state: VaultStateDoc): EncryptedKey[] {
    return Object.values(state.keys).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Marks a key revoked (records persist — revocation history is audit
   * evidence). Idempotent: revoking an already-revoked key returns its
   * current record rather than throwing, so retries are safe.
   *
   * @throws VaultError("KEY_NOT_FOUND") for an unknown keyId.
   */
  static revokeKey(state: VaultStateDoc, keyId: string): { record: EncryptedKey; state: VaultStateDoc } {
    const record = state.keys[keyId];
    if (!record) throw new VaultError("KEY_NOT_FOUND", "no such key in the vault");
    if (record.status === "revoked") return { record, state };

    const revoked: EncryptedKey = { ...record, status: "revoked" };
    return {
      record: revoked,
      state: { ...state, keys: { ...state.keys, [keyId]: revoked }, updatedAt: Date.now() },
    };
  }
}

/** Fail-closed role acceptance per network (see addKey for the rule table). */
function validateRoleForNetwork(network: NetworkId, role: KeyRole | null): void {
  if (network === "steem" || network === "hive" || network === "blurt") {
    if (role === null || !STEEM_FAMILY_ROLES.has(role)) {
      throw new VaultError("VALIDATION", `network ${network} requires one of: owner, active, posting, memo`);
    }
    return;
  }
  if (network === "tron") {
    if (role !== null && role !== "owner") {
      throw new VaultError("VALIDATION", "tron keys accept role null or owner");
    }
    return;
  }
  if (network === "ethereum" || network === "solana") {
    if (role !== "active") {
      throw new VaultError("VALIDATION", `${network} is a single-key chain — role must be "active"`);
    }
    return;
  }
  // saos-net — steem-family fork without a memo authority.
  if (role !== "owner" && role !== "active" && role !== "posting") {
    throw new VaultError("VALIDATION", "saos-net keys accept role owner, active or posting");
  }
}
