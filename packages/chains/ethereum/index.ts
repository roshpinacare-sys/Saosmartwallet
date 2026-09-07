/**
 * Saosmartwallet — Ethereum adapter barrel (M3)
 */

export { EthereumAdapter, toEvmAddress, ethAddressFromPrivateKey } from "./adapter";
export type {
  EthereumAdapterOptions,
  EvmChainInfo,
  EvmAccountInfo,
  Erc20BalanceInfo,
} from "./adapter";
export { ERC20_ABI, ERC20_READ_ABI } from "./abi/erc20";
export { BRIDGE_ABI, BRIDGE_MINT_ABI, BRIDGE_LOCK_ABI, BRIDGE_STATUS_ABI } from "./abi/bridge";
export {
  DEFAULT_GAS_LIMITS,
  FEE_POLICY,
  estimateEip1559Fees,
  toFeeSummary,
} from "./gas";
export type { Eip1559Fees, FeeSummary, FeeSpeed } from "./gas";
export {
  isEip1559TxFields,
  metadataToTxFields,
} from "./transactions";
export type {
  Eip1559TxFields,
  EvmOperationType,
  EvmTransactionReceiptSummary,
  EvmTxMetadata,
} from "./transactions";
