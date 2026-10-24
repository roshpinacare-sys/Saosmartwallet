/**
 * Saosmartwallet — vault package public API (task 4-b)
 * ====================================================
 * AES-256-GCM encrypted local key vault for the sovereign wallet (directive
 * §3/§8, invariants §11): envelope encryption at rest, master key from
 * SAOS_VAULT_MASTER_KEY only, fail-closed everywhere, zero plaintext in
 * state, logs, errors, or git.
 *
 * Quick start:
 *
 *   import { openVault } from "@saos/vault"; // or relative path in-repo
 *
 *   process.env.SAOS_VAULT_MASTER_KEY = "<64 hex chars>"; // provisioned, never logged
 *   const vault = await openVault({ dir: "./state" });
 *   await vault.sealKey({ id: "saos.tst/active", type: "secp256k1-wif", material: wif });
 *   const sig = await vault.signEd25519("solana/main", message);   // seed never exposed
 *   const meta = vault.listKeys();                                  // metadata ONLY
 *
 * Security contract (pinned by test/vault.test.ts):
 *   • At rest: per-key random IV + AES-256-GCM; JSON envelopes in keys.enc.
 *   • Wrong/missing master key, tampered ciphertext/tag, corrupt store,
 *     unknown/duplicate id, bad material ⇒ VaultError, NEVER a fallback.
 *   • withKey() zero-fills the material buffer after the callback settles.
 *   • secp256k1 here is storage/roundtrip/validation ONLY (no ECDSA signing,
 *     no third-party deps — directive scope note).
 */

export {
  openVault,
  loadMasterKeyFromEnv,
  DEFAULT_VAULT_DIR,
  Vault,
  type OpenVaultOptions,
  type SealedRecord,
  type SealKeyInput,
  type UnsealedKey,
  type KeyMetadata,
} from "./vault";

export { VaultError, type VaultErrorCode } from "./errors";

export {
  VAULT_KEY_TYPES,
  type VaultKeyType,
  type SealedEnvelope,
  type StoreFile,
  type VerifyBlock,
} from "./envelope";

export { ed25519Sign, ed25519Verify, ed25519PublicKey, ed25519SeedToPkcs8 } from "./ed25519";

export { wifEncode, wifDecode, type WifDecoded } from "./wif";

export { base58Encode, base58Decode } from "./base58";
