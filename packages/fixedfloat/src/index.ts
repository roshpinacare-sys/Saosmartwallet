/**
 * Saosmartwallet packages/fixedfloat — public surface (wave G76-b)
 * ===================================================================
 * The FixedFloat production cross-chain swap rail: official v2 signing,
 * custody-vault key loading (fail-closed), honest client transport, and the
 * custodial rail mapping with REFUSED trustless-HTLC verdicts.
 */

export { FixedFloatError, type FixedFloatErrorCode } from "./errors";
export {
  EMPTY_PAYLOAD,
  FF_CONTENT_TYPE,
  buildApiHeaders,
  buildApiSignature,
  canonicalPayloadString,
} from "./sign";
export {
  FixedFloatVaultError,
  DEFAULT_FF_VAULT_PATH,
  loadFixedFloatKeys,
  type FixedFloatKeys,
  type LoadFixedFloatKeysOptions,
} from "./vault-loader";
export {
  FF_BASE_URL,
  FixedFloatClient,
  type CreateOrderRequest,
  type EmergencyRequest,
  type FixedFloatClientOptions,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "./client";
export {
  FF_ORDER_STATUSES,
  FixedFloatSwapRail,
  RAIL_CUSTODY_DISCLOSURE,
  htlcSupport,
  isFfOrderStatus,
  mapOrderStatus,
  settleEvidence,
  settleVerdict,
  type CreateSwapLegOrderRequest,
  type FfOrderStatus,
  type HtlcSupportReport,
  type HtlcSupportVerdict,
  type PollOrderOptions,
  type RailOrder,
  type RailOrderTime,
  type RailPhase,
  type RefundPath,
  type SettleEvidence,
  type SettleVerdictName,
  type SettleVerdictResult,
  type SwapLegOrderRef,
} from "./rail";
