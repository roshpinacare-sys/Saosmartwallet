/**
 * Saosmartwallet — chain adapter seam + deterministic simulated adapter
 * ====================================================================
 * HONEST SCOPE BOUNDARY (directive §3, documented in README):
 *   This file defines the ChainAdapter INTERFACE and ONE adapter
 *   implementation — SimulatedChainAdapter, a deterministic in-memory
 *   ledger. It is marked `simulated: true` and exists for tests and dry-run
 *   orchestration ONLY. REAL per-chain signing/broadcast adapters
 *   (Ethereum, Solana, HIVE, STEEM) are FUTURE WORK: they plug in here
 *   without touching the machine, codec or session. Nothing in this package
 *   broadcasts anything anywhere.
 *
 * The seam mirrors what a real HTLC contract does on ONE chain:
 *   lock   — initiator funds the hash-locked contract
 *   claim  — redeemer spends it with the secret preimage
 *   refund — initiator reclaims after the claim deadline
 *
 * SimulatedChainAdapter guarantees:
 *   • deterministic tx ids — sha256 over {adapter, op, swapId, counter};
 *     identical inputs replay to identical receipts (no wall clock in the id)
 *   • the same refusal discipline as the state machine (typed errors)
 *   • an inspectable books() ledger for tests
 */

import { HtlcError } from "./errors";
import { createHash } from "node:crypto";
import {
  canonicalBytes,
  validateClaim,
  validateOffer,
  validateRefund,
  type Asset,
  type Claim,
  type Offer,
  type Refund,
} from "./messages";
import { phase as evalPhase } from "./timelock";
import { verifySecret } from "./secret";

/** Receipt of a successful adapter operation (all fields deterministic). */
export interface AdapterReceipt {
  op: "lock" | "claim" | "refund";
  swapId: string;
  /** sha256 over {adapter, op, swapId, counter} — stable across replays. */
  txId: string;
  /** Clock value at commit (epoch ms; NOT part of the tx id). */
  at: number;
  /** true for simulated adapters — honest marker, never stripped. */
  simulated: boolean;
}

/** One entry of the adapter's internal ledger (audit view). */
export interface AdapterBookEntry {
  op: AdapterReceipt["op"];
  swapId: string;
  txId: string;
  at: number;
  asset: Asset;
  /** Decimal string amount where the operation carries one, else null. */
  amount: string | null;
}

/**
 * The seam where real chains enter. Production adapters implement this with
 * actual contracts/RPC — and MUST report `simulated: false`.
 */
export interface ChainAdapter {
  readonly id: string;
  /** true ONLY for deterministic simulated adapters (tests / dry-run). */
  readonly simulated: boolean;
  /** Refuses (HTLC_E_ADAPTER_ASSET) assets this adapter cannot hold. */
  validateAsset(asset: Asset): Promise<void>;
  /** Funds the hash-locked contract for the offer's give-side. */
  lock(offer: Offer): Promise<AdapterReceipt>;
  /** Spends the locked contract with the secret preimage. */
  claim(claim: Claim): Promise<AdapterReceipt>;
  /** Reclaims the locked contract inside the refund window. */
  refund(refund: Refund): Promise<AdapterReceipt>;
}

interface SimulatedSwap {
  offer: Offer;
  state: "Locked" | "Redeemed" | "Refunded";
}

/**
 * Deterministic in-memory chain adapter. SIMULATED — for tests and dry-run
 * orchestration only (see header). No network, no signing, no persistence.
 */
export class SimulatedChainAdapter implements ChainAdapter {
  readonly id: string;
  readonly simulated = true as const;

  private readonly clock: () => number;
  private readonly supported: ReadonlySet<string>;
  private readonly swaps = new Map<string, SimulatedSwap>();
  private readonly ledger: AdapterBookEntry[] = [];
  private counter = 0;

  constructor(options: { id: string; assets?: readonly Asset[]; clock?: () => number }) {
    if (options === null || typeof options !== "object") {
      throw new HtlcError("HTLC_E_BAD_INPUT", "SimulatedChainAdapter requires options { id, assets?, clock? }");
    }
    if (typeof options.id !== "string" || options.id.length === 0 || /\s/.test(options.id)) {
      throw new HtlcError("HTLC_E_BAD_INPUT", 'adapter id must be a non-empty string without whitespace');
    }
    this.id = options.id;
    this.clock = options.clock ?? Date.now;
    if (typeof this.clock !== "function") {
      throw new HtlcError("HTLC_E_BAD_INPUT", "clock must be a function returning epoch ms");
    }
    const assets = options.assets ?? [];
    this.supported = new Set(assets.map((a) => assetKey(a)));
  }

  /** Refuses assets outside the constructor's supported set. */
  async validateAsset(asset: Asset): Promise<void> {
    const key = assetKey(asset); // throws HTLC_E_BAD_MESSAGE on malformed assets
    if (!this.supported.has(key)) {
      throw new HtlcError(
        "HTLC_E_ADAPTER_ASSET",
        `adapter "${this.id}" does not support asset ${asset.chain}/${asset.symbol}`,
      );
    }
  }

  /** Funds the give-side of the offer on this (simulated) chain. */
  async lock(offer: Offer): Promise<AdapterReceipt> {
    const valid = validateOffer(offer); // protocol + shapes + timelock margin
    await this.validateAsset(valid.assetGive);
    if (this.swaps.has(valid.swapId)) {
      throw new HtlcError(
        "HTLC_E_ADAPTER_STATE",
        `swap ${valid.swapId} is already locked on adapter "${this.id}" (no double funding)`,
      );
    }
    const now = this.clock();
    if (evalPhase(now, valid.timelocks) !== "claim-window") {
      throw new HtlcError(
        "HTLC_E_WRONG_PHASE",
        `lock requires the claim-window phase, swap ${valid.swapId} is not claimable at ${now}`,
      );
    }
    this.swaps.set(valid.swapId, { offer: valid, state: "Locked" });
    return this.commit("lock", valid.swapId, now, valid.assetGive, valid.amountGive);
  }

  /** Spends the locked contract with the secret preimage. */
  async claim(claim: Claim): Promise<AdapterReceipt> {
    const valid = validateClaim(claim);
    const swap = this.swaps.get(valid.swapId);
    if (!swap || swap.state !== "Locked") {
      throw new HtlcError(
        "HTLC_E_ADAPTER_STATE",
        `swap ${valid.swapId} has no locked contract on adapter "${this.id}"` +
          (swap ? ` (already ${swap.state})` : ""),
      );
    }
    if (!verifySecret(valid.secret, swap.offer.hashSecret)) {
      throw new HtlcError(
        "HTLC_E_BAD_SECRET",
        `claim secret does not hash to the contract hash for swap ${valid.swapId} (secret never echoed)`,
      );
    }
    const now = this.clock();
    if (evalPhase(now, swap.offer.timelocks) !== "claim-window") {
      throw new HtlcError(
        "HTLC_E_WRONG_PHASE",
        `claim requires the claim-window phase, swap ${valid.swapId} is past it at ${now}`,
      );
    }
    swap.state = "Redeemed";
    return this.commit("claim", valid.swapId, now, swap.offer.assetGive, swap.offer.amountGive);
  }

  /** Reclaims the locked contract inside the refund window. */
  async refund(refund: Refund): Promise<AdapterReceipt> {
    const valid = validateRefund(refund);
    const swap = this.swaps.get(valid.swapId);
    if (!swap || swap.state !== "Locked") {
      throw new HtlcError(
        "HTLC_E_ADAPTER_STATE",
        `swap ${valid.swapId} has no locked contract on adapter "${this.id}"` +
          (swap ? ` (already ${swap.state})` : ""),
      );
    }
    const now = this.clock();
    if (evalPhase(now, swap.offer.timelocks) !== "refund-window") {
      throw new HtlcError(
        "HTLC_E_WRONG_PHASE",
        `refund requires the refund-window phase, swap ${valid.swapId} is in another phase at ${now}`,
      );
    }
    swap.state = "Refunded";
    return this.commit("refund", valid.swapId, now, swap.offer.assetGive, swap.offer.amountGive);
  }

  /** The internal ledger — audit view for tests and dry-run reports. */
  books(): readonly AdapterBookEntry[] {
    return [...this.ledger];
  }

  // ------------------------------------------------------------------ internal

  private commit(op: AdapterReceipt["op"], swapId: string, at: number, asset: Asset, amount: string | null): AdapterReceipt {
    const n = this.counter++;
    const txId = createHash("sha256")
      .update(canonicalBytes({ adapter: this.id, op, swapId, n }))
      .digest("hex");
    this.ledger.push({ op, swapId, txId, at, asset, amount });
    return { op, swapId, txId, at, simulated: true };
  }
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

function assetKey(asset: Asset): string {
  if (asset === null || typeof asset !== "object" || Array.isArray(asset)) {
    throw new HtlcError("HTLC_E_BAD_MESSAGE", "asset must be an object { chain, symbol }");
  }
  const { chain, symbol } = asset as Partial<Asset>;
  if (typeof chain !== "string" || chain.length === 0 || typeof symbol !== "string" || symbol.length === 0) {
    throw new HtlcError("HTLC_E_BAD_MESSAGE", "asset chain/symbol must be non-empty strings");
  }
  return `${chain}/${symbol}`;
}
