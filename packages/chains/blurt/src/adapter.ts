/**
 * Saosmartwallet — BLURT chain adapter (§7B, task t56)
 * ====================================================
 * BLURT is the third steem-family rail (STEEM ✓, blurt ✓, ethereum ✓,
 * solana ✓). The machinery is the M0/M1/M3-proven SteemAdapter itself,
 * re-parameterized with:
 *
 *   • chainId   — EXPLICIT AND REQUIRED. Blurt's reachable public RPC
 *                 (blurt-rpc.saboin.com, measured live 2026-10-23) exposes
 *                 neither condenser_api.get_chain_id nor database_api.get_chain_id,
 *                 so the CLASS never guesses — an unverified chain id
 *                 must never sign (fail-closed, same doctrine as the M0
 *                 allowBroadcast gate). Canonical convergence (t56): the
 *                 r10-oracle-MEASURED constant BLURT_CHAIN_ID_HEX lives in
 *                 ../blurt.ts (3/3 real on-chain signature recoveries — the
 *                 chain is the oracle, wave 19.77) and the registry's
 *                 getBlurtAdapter() pins it as the explicit default. An
 *                 operator override is still parsed fail-closed via
 *                 blurtChainIdFromHex() (64 hex chars enforced).
 *   • opIds     — BLURT_OP_IDS (in-repo EMPIRICAL proof: blurt maps
 *                 custom_json to wire tag 0x0c; operations.ts r20).
 *   • prefix    — "BLT" (the graphene helper already recognizes it).
 *   • symbols   — BLURT / BBD (the conversion-plane pair named in
 *                 SteemAdapterOptions r21).
 *
 * Broadcast inherits the fail-closed default: allowBroadcast must be passed
 * explicitly, and the operator's chain id remains their responsibility.
 */

import { SteemAdapter, type SteemAdapterOptions } from "../../steem/src/adapter";
import { SerializationError } from "../../steem/src/serializer";
import { BLURT_OP_IDS, type OpIdTable } from "../../steem/src/operations";

export interface BlurtAdapterOptions extends SteemAdapterOptions {
  /**
   * REQUIRED 32-byte blurt mainnet chain id (hex via blurtChainIdFromHex).
   * Fail-closed: the constructor refuses to guess.
   */
  chainId: Uint8Array;
  /** Default "BLT". */
  addressPrefix?: string;
  /** Default BLURT_OP_IDS (custom_json = 12). */
  opIds?: OpIdTable;
}

export class BlurtAdapter extends SteemAdapter {
  constructor(opts: BlurtAdapterOptions) {
    if (!(opts.chainId instanceof Uint8Array) || opts.chainId.length !== 32) {
      throw new SerializationError(
        "BlurtAdapter: explicit 32-byte chainId is REQUIRED — blurt's public RPC does not expose get_chain_id, so no default is shipped (fail-closed)",
      );
    }
    super({
      ...opts,
      addressPrefix: opts.addressPrefix ?? "BLT",
      opIds: opts.opIds ?? BLURT_OP_IDS,
      assetSymbols: opts.assetSymbols ?? { liquid: "BLURT", debt: "BBD" },
    });
  }
}

/** Hex (64 chars) → 32-byte chain id; validates length and hex charset (fail-closed). */
export function blurtChainIdFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new SerializationError(`chain id hex must be exactly 64 hex chars, got ${hex.length}`);
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}
