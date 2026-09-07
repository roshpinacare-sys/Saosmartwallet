/**
 * Saosmartwallet — packages/core root barrel (M2)
 * ===============================================
 * One import surface for the whole sovereign vault core:
 *
 *   types          — the frozen shared vocabulary + VaultError
 *   encoding       — canonicalJson, b64/hex/utf8 helpers, satoshi math
 *   crypto (M0)    — PrivateKey/PublicKey, WIF/STM encodings, derivations
 *   vault (L1)     — SovereignVault hierarchy + the CryptoEngine facade
 *   policy (L3)    — PolicyEngine + STATIC_RULES + default rule data
 *   signing (L4)   — SigningOrchestrator (sign/simulate/multi/batch/cross)
 *   backup (L5)    — BackupManager (encrypted/sharded/social/dead-man/QR)
 *   audit (L6)     — hash-chained AuditSystem + reports
 *   storage        — VaultStorage/AuditStore seams + memory stores
 *
 * Runtime rule: importing this barrel never pulls network I/O — chains stay
 * behind the type-only adapter seam.
 */

export * from "./types";
export * from "./encoding";

export * from "../../crypto/src/index";

export * from "./vault/index";
export * from "./policy/index";
export * from "./signing/index";
export * from "./backup/index";
export * from "./audit/index";

export * from "./storage/types";
export * from "./storage/memory-store";
