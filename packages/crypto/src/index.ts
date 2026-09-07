/**
 * Saosmartwallet — crypto package (M0)
 * ====================================
 * Key hierarchy for Steem-family chains: PrivateKey / PublicKey / signatures,
 * WIF + "STM" encodings, password & brain-key derivations.
 *
 * STATUS (M0, D2 = Steem Protocol approved by owner):
 *   • Encoding rules verified against live-chain public keys.
 *   • Signature/recovery conventions verified against real on-chain
 *     signatures (tools/serialize-test.ts — see worklog for evidence).
 *   • Keystore encryption (AES-256-GCM) and Policy Engine live in
 *     packages/core — deliberately NOT here (separation of concerns; core
 *     remains network-agnostic).
 *
 * RULES (from packages/crypto/README.md — enforced by review):
 *   • No hand-rolled crypto: primitives come from @noble/* (audited).
 *   • Fail closed: any parse/derive error aborts the flow.
 *   • Never log key material.
 */

export {
  EncodingError,
  base58Decode,
  base58Encode,
  steemPublicKeyDecode,
  steemPublicKeyEncode,
  wifDecode,
  wifEncode,
} from "./encoding";

export {
  STEEM_ROLES,
  type RoleKeySet,
  type SteemRole,
  PrivateKey,
  PublicKey,
  deriveFromBrainKey,
  derivePrivateKey,
  derivePrivateKeys,
  generateMasterPassword,
  normalizeBrainKey,
  recoverFromCompact,
} from "./keys";
