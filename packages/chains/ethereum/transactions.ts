/**
 * Saosmartwallet — Ethereum transaction models (M3)
 * =================================================
 * JSON-safe metadata shapes for the ChainAdapter seam. Ethers objects carry
 * bigints; every value that crosses the API boundary is converted to decimal
 * / hex strings here so the vault's audit log can serialize them.
 */

/** Adapter operation vocabulary (validated fail-closed in buildOperations). */
export type EvmOperationType = "transfer" | "erc20_transfer" | "erc20_approve";

/** The EIP-1559 envelope the adapter builds. Ethers-compatible field names. */
export interface Eip1559TxFields {
  type: 2;
  chainId: number;
  nonce: number;
  to: string;
  /** wei, decimal string in metadata; bigint in memory. */
  value: string;
  data: string; // hex, "0x" allowed
  gasLimit: string; // gas units, decimal string
  maxFeePerGas: string; // wei decimal string
  maxPriorityFeePerGas: string; // wei decimal string
}

/** Metadata carried inside UnsignedTx.metadata for Ethereum. */
export interface EvmTxMetadata extends Eip1559TxFields {
  [key: string]: unknown;
  /** Present after sign(): keccak256 of the unsigned serialized tx. */
  digestHex?: string;
  /** Present after sign(): the full signed raw transaction (0x…). */
  rawTransactionHex?: string;
  from?: string;
  /** Present after sign(): recovered signer address. */
  recoveredSigner?: string;
}

export interface EvmTransactionReceiptSummary {
  hash: string;
  blockNumber: number;
  /** 1 = success, 0 = reverted, null = unknown/deferred. */
  status: 1 | 0 | null;
  gasUsed: string;
  effectiveGasPrice: string;
  logCount: number;
  confirmations: number | null;
}

export function isEip1559TxFields(v: unknown): v is Eip1559TxFields {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    t.type === 2 &&
    typeof t.chainId === "number" &&
    typeof t.nonce === "number" &&
    (typeof t.to === "string" || t.to === null) &&
    typeof t.value === "string" &&
    typeof t.data === "string" &&
    typeof t.gasLimit === "string" &&
    typeof t.maxFeePerGas === "string" &&
    typeof t.maxPriorityFeePerGas === "string"
  );
}

/** Converts metadata strings back into an ethers-ready plain object. */
export function metadataToTxFields(m: EvmTxMetadata): {
  type: 2;
  chainId: number;
  nonce: number;
  to: string;
  value: bigint;
  data: string;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
} {
  return {
    type: 2,
    chainId: m.chainId,
    nonce: m.nonce,
    to: m.to,
    value: BigInt(m.value),
    data: m.data,
    gasLimit: BigInt(m.gasLimit),
    maxFeePerGas: BigInt(m.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(m.maxPriorityFeePerGas),
  };
}
