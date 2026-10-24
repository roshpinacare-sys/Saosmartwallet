/**
 * Saosmartwallet — packages/swap public surface (agent-9, wallet-htlc-swap-engine)
 * ================================================================================
 * The wallet's atomic-swap primitives (MASTER DIRECTIVE §3): the pure HTLC
 * state machine, the Graphene on-chain witness layer (custom_json + transfer-
 * memo channels through the landed oracle-proven packer), and the two-party
 * cross-chain session coordinator. Chain I/O (RPC, broadcast) stays with the
 * existing chain adapters — this package is deterministic and offline.
 *
 * Layering (the directive's cross-chain vocabulary):
 *   htlc.ts    — hash-time-lock law (sha256 binding, timelock, claim/refund)
 *   witness.ts — on-chain evidence for graphene legs (steem/blurt/hive tables)
 *   session.ts — the initiator/responder composition (T1 > T2 safety law)
 */

export * from "./htlc";
export * from "./witness";
export * from "./session";
