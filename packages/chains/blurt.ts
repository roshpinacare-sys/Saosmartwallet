/**
 * Saosmartwallet — BLURT chain registry entry (wave 19.77)
 * ========================================================
 * The multichain registry (M3) shipped adapters for steem/ethereum/solana but
 * never registered BLURT — the fork-parameterized SteemAdapter documented the
 * intent ("Forks MUST override" chainId / prefix / opIds / asset pair, r20/r21)
 * while the registry kept the fork absent. This entry closes that gap with the
 * MEASURED constants only:
 *
 *   · BLURT_CHAIN_ID — empirically proven by the r10 oracles: 3/3 real
 *     on-chain signatures recover under cd8d90f29ae273abec3eaa7731e25934c63eb
 *     654d55080caff2ebb7f5df6381f while zeros/hive/testnet recover 0/3, and
 *     the serializer's wire form matched the BLURT wire bit-for-bit
 *     (tools/r10-blurt-digest-oracle.ts, tools/r10-blurt-wire-check). The
 *     chain itself is the oracle — zero assumption.
 *
 *   · BLURT_RPC_URLS — the endpoint the oracles and the live authority reads
 *     actually used (tools/r10-blurt-chainid-oracle.ts, tools/r37-key-identity).
 *     Ordered list for failover; only measured endpoints are listed.
 *
 *   · BLURT_PREFIXES / BLURT_ASSET_SYMBOLS — the BLT identity namespace and
 *     the BLURT/BBD three-token pair (serializer KNOWN_PRECISIONS already
 *     pins BLURT:3 / BBD:3); the r20 fork op table (custom_json=12) ships as
 *     BLURT_OP_IDS in steem/src/operations.ts and is wired here.
 *
 * Broadcast stays FAIL-CLOSED: makeBlurtAdapter never enables it implicitly —
 * an explicit allowBroadcast:true override is required, exactly like the base
 * adapter's M0 gate.
 */

import { SteemAdapter, type SteemAdapterOptions } from "./steem/src/adapter";
import { BLURT_OP_IDS, type OpIdTable } from "./steem/src/operations";

/** BLURT mainnet chain id — r10-oracle measured, 3/3 on-chain recovery proof. */
export const BLURT_CHAIN_ID_HEX =
  "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";

export const BLURT_CHAIN_ID: Uint8Array = new Uint8Array(Buffer.from(BLURT_CHAIN_ID_HEX, "hex"));

/** Measured public endpoints (failover order: the oracle/live-proven node first). */
export const BLURT_RPC_URLS = ["https://blurt-rpc.saboin.com"] as const;

/** BLURT's public-key identity namespace (mutually exclusive with STM/TST). */
export const BLURT_PREFIXES = ["BLT"] as const;

/** The BLURT/BBD three-token pair (serializer precisions already pinned at 3). */
export const BLURT_ASSET_SYMBOLS = { liquid: "BLURT", debt: "BBD" } as const;

/** The frozen BLURT defaults the factory applies before any user override. */
export const BLURT_ADAPTER_DEFAULTS: Readonly<
  Pick<SteemAdapterOptions, "chainId" | "addressPrefix" | "opIds" | "assetSymbols" | "rpcUrl" | "rpcUrls">
> = Object.freeze({
  chainId: BLURT_CHAIN_ID,
  addressPrefix: "BLT" as const,
  opIds: BLURT_OP_IDS as OpIdTable,
  assetSymbols: BLURT_ASSET_SYMBOLS,
  rpcUrl: BLURT_RPC_URLS[0],
  rpcUrls: [...BLURT_RPC_URLS],
});

/**
 * Constructs the BLURT adapter: the fork-parameterized SteemAdapter with the
 * measured BLURT constants pre-applied. Overrides replace defaults whole —
 * nothing merges silently. Broadcast stays disabled unless the caller passes
 * allowBroadcast:true explicitly (the M0 gate, never flipped by this factory).
 */
export function makeBlurtAdapter(overrides: Partial<SteemAdapterOptions> = {}): SteemAdapter {
  return new SteemAdapter({ ...BLURT_ADAPTER_DEFAULTS, ...overrides });
}
