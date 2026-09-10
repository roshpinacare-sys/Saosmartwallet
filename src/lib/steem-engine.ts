/**
 * Saosmartwallet — engine re-exports for Next.js routes (M1)
 * ==========================================================
 * Re-exports the oracle-verified serialization engine from packages/chains/
 * steem for server-side use. Next.js route files import from here ("@/lib/
 * steem-engine") instead of deep relative paths — Turbopack resolves this
 * reliably, and it keeps the routes decoupled from the package layout.
 */

export { SerializationError, formatAsset, parseAsset, type Asset } from "../../packages/chains/steem/src/serializer";
export {
  STEEM_CHAIN_ID,
  serializeTransaction,
  transactionDigest,
  transactionId,
  type SteemTransaction,
} from "../../packages/chains/steem/src/transaction";
export {
  OP_IDS,
  type LimitOrderCreateOperation,
  type LimitOrderCancelOperation,
} from "../../packages/chains/steem/src/operations";

export { deserializeTransaction } from "../../packages/chains/steem/src/transaction";
export { OP_IDS as STEEM_OP_IDS, type SteemAuthority, type AccountUpdateOperation, graphenePubToRaw33, grapheneRaw33ToString } from "../../packages/chains/steem/src/operations";
