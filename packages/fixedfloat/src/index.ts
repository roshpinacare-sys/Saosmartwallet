/**
 * Saosmartwallet — packages/fixedfloat public surface (agent-9, wave 20.01)
 * =========================================================================
 * The wallet's FixedFloat exchange rail (ULTIMATE SWARM DIRECTIVE §4 —
 * cross-chain routing): production API-v1 connector for the ETH/SOL legs of
 * the cross-chain matrix, sitting beside packages/htlc + packages/swap
 * (the atomic-swap layer) and packages/bridges (the path router).
 *
 * Layering:
 *   sign.ts   — HMAC-SHA256 request signing (RFC 4231-pinned) + monotonic nonce
 *   config.ts — fail-closed credential custody (env names, redaction, fingerprint)
 *   errors.ts — the five-kind taxonomy, redaction enforced at construction
 *   orders.ts — honest status model + emergency guard laws + fleet hash-chain
 *               rail receipts (fleet-economy anchorable)
 *   client.ts — the injected-transport client (wire law, envelope law,
 *               fail-closed local validation)
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
