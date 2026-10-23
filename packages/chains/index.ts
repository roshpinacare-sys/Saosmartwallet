/**
 * Saosmartwallet — chain adapter registry (M3)
 * ============================================
 * Single place where every network's adapter is constructed with its
 * production endpoints. The vault runtime + eco probes both build from here.
 *
 * Endpoint policy (documented, public — no keys, no secrets):
 *   · Every list is ordered by observed reliability from the sandbox.
 *   · First endpoint that answers the health ping wins (failover each call).
 *   · broadcast stays fail-closed by default everywhere (M0 gate).
 */

import { SteemAdapter } from "./steem/src/adapter";
import { BLURT_CHAIN_ID_HEX, BLURT_RPC_URLS } from "./blurt";
import { BlurtAdapter, blurtChainIdFromHex } from "./blurt/src/adapter";
import { EthereumAdapter, type EvmChainInfo } from "./ethereum";
import { SolanaAdapter, type SolanaChainInfo } from "./solana";

export type { ChainAdapter, ChainHealthReport, AccountSnapshot, TokenBalances, RcManabar, UnsignedTx, SignedTx, BroadcastResult, SigningKeys, ChainOperation, AdapterCapability, ChainFlavor, KeyRole } from "./chain-adapter";
export {
  BLURT_CHAIN_ID,
  BLURT_CHAIN_ID_HEX,
  BLURT_RPC_URLS,
  BLURT_PREFIXES,
  BLURT_ASSET_SYMBOLS,
  BLURT_ADAPTER_DEFAULTS,
  makeBlurtAdapter,
} from "./blurt";
export { SteemAdapter } from "./steem/src/adapter";
export { BlurtAdapter, blurtChainIdFromHex } from "./blurt/src/adapter";
export {
  EthereumAdapter,
  toEvmAddress,
  ethAddressFromPrivateKey,
  ERC20_ABI,
  BRIDGE_ABI,
} from "./ethereum";
export type { EvmChainInfo, EvmAccountInfo, Erc20BalanceInfo, FeeSummary, EvmTxMetadata, EvmTransactionReceiptSummary } from "./ethereum";
export {
  SolanaAdapter,
  toSolanaAddress,
  keypairFromSecretBytes,
  solanaAddressFromSeed,
  formatLamports,
} from "./solana";
export type { SolanaChainInfo, SolanaAccountInfo, SplTokenBalance, SolanaSignatureStatus, CommitmentLevel } from "./solana";

// ---------------------------------------------------------------------------
// Endpoint book (public RPCs, verified live 2026-09-08 from this sandbox)
// ---------------------------------------------------------------------------

export const ETHEREUM_RPC_URLS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://eth-mainnet.public.blastapi.io",
  "https://rpc.ankr.com/eth",
] as const;

export const SOLANA_RPC_URLS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
] as const;

export const STEEM_RPC_URL = "https://api.steemit.com";

// ---------------------------------------------------------------------------
// Adapters (read-only by default — broadcast requires explicit opt-in)
// ---------------------------------------------------------------------------

let steemAdapter: SteemAdapter | null = null;

export function getSteemAdapter(): SteemAdapter {
  steemAdapter ??= new SteemAdapter({ rpcUrl: STEEM_RPC_URL });
  return steemAdapter;
}

/**
 * BLURT adapter — canonical convergence of the two sister rails (t56):
 *   · constants come ONLY from ./blurt (r10-oracle-measured: 3/3 real
 *     on-chain signature recoveries under BLURT_CHAIN_ID_HEX — the chain is
 *     the oracle, zero assumption, wave 19.77);
 *   · the explicit-chain-id law still holds in the class: getBlurtAdapter
 *     pins the MEASURED constant by default, and an operator override is
 *     parsed fail-closed (64 hex chars enforced) — never guessed.
 */
export function getBlurtAdapter(chainIdHex: string = BLURT_CHAIN_ID_HEX): BlurtAdapter {
  return new BlurtAdapter({
    rpcUrl: BLURT_RPC_URLS[0],
    rpcUrls: [...BLURT_RPC_URLS.slice(1)],
    chainId: blurtChainIdFromHex(chainIdHex),
  });
}

let ethereumAdapter: EthereumAdapter | null = null;

export function getEthereumAdapter(): EthereumAdapter {
  ethereumAdapter ??= new EthereumAdapter({ rpcUrls: [...ETHEREUM_RPC_URLS] });
  return ethereumAdapter;
}

let solanaAdapter: SolanaAdapter | null = null;

export function getSolanaAdapter(): SolanaAdapter {
  solanaAdapter ??= new SolanaAdapter({ rpcUrls: [...SOLANA_RPC_URLS] });
  return solanaAdapter;
}

/** All adapters, construction lazily deferred. Blurt requires an operator-pinned chain id (fail-closed) and is constructed on demand. */
export function getAllAdapters(): Array<SteemAdapter | EthereumAdapter | SolanaAdapter> {
  return [getSteemAdapter(), getEthereumAdapter(), getSolanaAdapter()];
}

export type { EvmChainInfo as ChainInfoEthereum, SolanaChainInfo as ChainInfoSolana };
