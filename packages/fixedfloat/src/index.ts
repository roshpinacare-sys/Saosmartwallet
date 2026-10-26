/**
 * Saosmartwallet — packages/fixedfloat public surface (agent-9, wave 20.01)
 * =========================================================================
 * The wallet's FixedFloat exchange rail (ULTIMATE SWARM DIRECTIVE §4 —
 * cross-chain routing): production API-v2 connector for the ETH/SOL legs of
 * the cross-chain matrix, sitting beside packages/htlc + packages/swap
 * (the atomic-swap layer) and packages/bridges (the path router).
 *
 * Wire contract = MEASURED (2026-10-26): ff.io/api/v2/, JSON body,
 * X-Api-Key + X-Signature = HMAC-SHA1(sorted-canonical body) — reconciled
 * with the live measurement of the fx-fixedfloat bridge head (giant :3055,
 * trace 1a178850450f2e55), which also measured the owner key's current
 * state: signature accepted, but code 501 "Not have permission" until the
 * account-side API enablement lands (owner action).
 *
 * Layering:
 *   sign.ts   — RFC 2202-pinned HMAC-SHA1 + measured canonical law (deepSort)
 *   config.ts — fail-closed credential custody (env names, redaction, fingerprint)
 *   errors.ts — the five-kind taxonomy, redaction enforced at construction
 *   orders.ts — honest status model + emergency guard laws + fleet hash-chain
 *               rail receipts (fleet-economy anchorable)
 *   client.ts — the injected-transport client (wire law, envelope law,
 *               fail-closed local validation, method whitelist)
 *
 * Custody: the live keypair NEVER enters the tree. Runtime loads it from
 * /home/z/.secrets/fixedfloat.env (FIXEDFLOAT_API_KEY / FIXEDFLOAT_API_SECRET).
 * Measured boundary: ff.io egress from THIS sandbox is Cloudflare-blocked
 * (403, datacenter IP class) — live calls run from the daemon host.
 */

export * from "./sign";
export * from "./config";
export * from "./errors";
export * from "./orders";
export * from "./client";
