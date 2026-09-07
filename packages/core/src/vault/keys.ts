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

import { seal, open } from "../crypto/cipher";
import { fromUtf8, utf8 } from "../encoding";
import { VaultError, type CipherAlgorithm, type EncryptedKey, type KeyRole, type NetworkId, type StorageKind, type VaultStateDoc } from "../types";

/**
 * Public-key string prefix per network.
 *
 * steem / hive / saos-net share the STM-style "PREFIX + base58(key ‖
 * ripemd160-check)" identity (hive intentionally kept the STM prefix; saos-
 * net is a steem-family fork). blurt uses BLT. tron has a completely
 * different identity scheme (keccak/keystore) — we honestly report `null`
 * instead of inventing a fake STM-family string for it.
 */
const NETWORK_PUBKEY_PREFIX: Record<NetworkId, string | null> = {
  steem: "STM",
  hive: "STM",
  blurt: "BLT",
  tron: null,
  "saos-net": "STM",
};

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
    const prefix = NETWORK_PUBKEY_PREFIX[input.network];
    if (prefix !== null) {
      try {
        publicKey = priv.publicKey.toString(prefix);
      } catch {
        publicKey = null; // honest degradation — never invent an identity string
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
  // saos-net — steem-family fork without a memo authority.
  if (role !== "owner" && role !== "active" && role !== "posting") {
    throw new VaultError("VALIDATION", "saos-net keys accept role owner, active or posting");
  }
}
