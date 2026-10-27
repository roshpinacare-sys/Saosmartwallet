/**
 * packages/arb-executor — the decision plane (deliverable 2)
 * ===========================================================
 * Turns a measured OpportunityTable + live account states into conversion
 * decisions under the armed policy. LAWS:
 *
 *   • the ONLY executable op class is the internal-market conversion
 *     (limit_order_create, fill_or_kill — the chain's own market order):
 *     allowTransfersOut=false is structural, and the planner never proposes
 *     any op outside the internal rail;
 *   • every decision carries its honest verdict: EXECUTE only when ALL of
 *     armed policy, measured threshold, cycle caps, reserve, RC floor,
 *     authority proof, and balance allow — every other case is a named HOLD;
 *   • gated corridors (STEEM↔HIVE bridge, FixedFloat 501) are HOLD with the
 *     gap attached — never silently dropped, never "assumed executable";
 *   • caps are cycle-scoped: ops ≤ maxOpsPerCycle, ask ≤ maxAskSteemPerCycle,
 *     bid ≤ maxBidSbdPerCycle, and the SBD bid side must respect
 *     bidReserveSbd AFTER the reserve is withheld.
 */

import type { Opportunity, OpportunityTable } from "../../arb-scanner/src/types";
import type { ArmedPolicy } from "./policy";
import type { AccountState, AuthorityVerdict } from "./chain";

export type DecisionAction = "BUY_STEEM_WITH_SBD" | "SELL_STEEM_FOR_SBD";

export type DecisionVerdict =
  | { kind: "EXECUTE" }
  | { kind: "HOLD_SPREAD"; detail: string }
  | { kind: "HOLD_CAP"; detail: string }
  | { kind: "HOLD_RESERVE"; detail: string }
  | { kind: "HOLD_BALANCE"; detail: string }
  | { kind: "HOLD_RC"; detail: string }
  | { kind: "HOLD_AUTHORITY"; detail: string }
  | { kind: "HOLD_CORRIDOR_GATED"; detail: string }
  | { kind: "HOLD_NO_OPPORTUNITY"; detail: string };

export interface ConversionDecision {
  account: string;
  pair: string;
  action: DecisionAction;
  /** Measured edge this decision evaluated (bps). */
  spreadBps: number;
  /** Threshold applied + where it came from (anti-mock provenance). */
  thresholdBps: number;
  thresholdSource: "owner-policy" | "builtin-conservative";
  /** Intended order size (satoshis of the asset being sold). */
  sellSatoshis: number;
  /** Minimum receivable (satoshis) at the MEASURED price — fill_or_kill. */
  receiveSatoshis: number;
  /** The measured limit price this intent commits to (quote per base). */
  limitPrice: number;
  verdict: DecisionVerdict;
  at: string;
}

/** The cycle ledger — caps consumed across decisions in one run. */
export interface CycleLedger {
  ops: number;
  askSteemSatoshis: number;
  bidSbdSatoshis: number;
}

export interface PlanInput {
  table: OpportunityTable;
  policy: ArmedPolicy;
  /** Per-account live state (balances, rc, active pubkeys). */
  states: Map<string, AccountState>;
  /** Per-account custody-vs-chain authority verdicts. */
  authorities: Map<string, AuthorityVerdict>;
  /** Accounts the rail is allowed to act for (the custody roster). */
  roster: string[];
  now: number;
}

/** Maximum crossable edge on the internal rail from the measured table. */
export function bestInternalEdge(table: OpportunityTable): Opportunity | null {
  const corridor = table.corridors.find((c) => c.corridor === "STEEM_SBD_INTERNAL");
  if (!corridor) return null;
  const opps = corridor.opportunities.filter((o) => o.basis === "same-book-cross");
  if (opps.length === 0) return null;
  return opps.reduce((best, o) => (o.spreadBps > best.spreadBps ? o : best), opps[0]);
}

/**
 * Evaluates ONE conversion intent (account + action + size) against the
 * full law stack. Pure — the executor signs only EXECUTE verdicts.
 */
export function decideConversion(input: {
  account: string;
  action: DecisionAction;
  edge: Opportunity | null;
  state: AccountState | undefined;
  authority: AuthorityVerdict | undefined;
  policy: ArmedPolicy;
  ledger: CycleLedger;
  sizeSatoshis: number;
  now: number;
}): ConversionDecision {
  const { account, action, edge, state, authority, policy, ledger, sizeSatoshis, now } = input;
  const at = new Date(now).toISOString();
  // min_to_receive at the MEASURED top-of-book price — zero invented
  // slippage; if the book moved past this price the fill_or_kill dies.
  const limitPrice = edge ? (action === "BUY_STEEM_WITH_SBD" ? edge.buyPrice : edge.sellPrice) : Number.NaN;
  const receiveSatoshis = edge
    ? action === "BUY_STEEM_WITH_SBD"
      ? Math.floor(sizeSatoshis / edge.buyPrice) // STEEM satoshis receivable
      : Math.floor(sizeSatoshis * edge.sellPrice) // SBD satoshis receivable
    : 0;
  const base: Omit<ConversionDecision, "verdict"> = {
    account,
    pair: edge?.pair ?? "STEEM/SBD",
    action,
    spreadBps: edge?.spreadBps ?? Number.NaN,
    thresholdBps: policy.thresholds.minSpreadBps,
    thresholdSource: policy.thresholdsSource,
    sellSatoshis: sizeSatoshis,
    receiveSatoshis,
    limitPrice,
    at,
  };

  // 1) corridor reality — a cross-venue edge must be executable
  if (edge === null) {
    return { ...base, verdict: { kind: "HOLD_NO_OPPORTUNITY", detail: "no measured internal-market edge in this cycle" } };
  }
  if (edge.basis === "parity-assumed-cross") {
    return {
      ...base,
      verdict: { kind: "HOLD_CORRIDOR_GATED", detail: "STEEM↔HIVE bridge rail is gated (no live bridge rate) — parity-assumed edge is NOT executable" },
    };
  }
  if (edge.basis === "fixedfloat-quote") {
    return {
      ...base,
      verdict: { kind: "HOLD_CORRIDOR_GATED", detail: "FixedFloat is a read-only quote in this runtime — order placement is the OWNER lever" },
    };
  }

  // 2) authority proof (custody vs live chain)
  if (authority === undefined) {
    return { ...base, verdict: { kind: "HOLD_AUTHORITY", detail: "no authority verdict computed for this account" } };
  }
  if (!authority.ok) {
    return { ...base, verdict: { kind: "HOLD_AUTHORITY", detail: authority.reason } };
  }

  // 3) live balances
  if (state === undefined) {
    return { ...base, verdict: { kind: "HOLD_BALANCE", detail: "no live account state" } };
  }
  if (action === "BUY_STEEM_WITH_SBD") {
    const spendable = state.sbdSatoshis - policy.bidReserveSbdSatoshis;
    if (spendable <= 0) {
      return { ...base, verdict: { kind: "HOLD_RESERVE", detail: `SBD spendable after bidReserveSbd is ${spendable} satoshis` } };
    }
    if (sizeSatoshis > spendable) {
      return { ...base, verdict: { kind: "HOLD_BALANCE", detail: `intent ${sizeSatoshis} SBD sat > spendable ${spendable} sat` } };
    }
    if (ledger.bidSbdSatoshis + sizeSatoshis > policy.maxBidSbdPerCycleSatoshis) {
      return { ...base, verdict: { kind: "HOLD_CAP", detail: "cycle bidSbd cap reached" } };
    }
    if (sizeSatoshis > policy.thresholds.maxNotionalSbdPerOp * 1000) {
      return { ...base, verdict: { kind: "HOLD_CAP", detail: "intent exceeds maxNotionalSbdPerOp" } };
    }
  } else {
    if (sizeSatoshis > state.steemSatoshis) {
      return { ...base, verdict: { kind: "HOLD_BALANCE", detail: `intent ${sizeSatoshis} STEEM sat > balance ${state.steemSatoshis} sat` } };
    }
    if (ledger.askSteemSatoshis + sizeSatoshis > policy.maxAskSteemPerCycleSatoshis) {
      return { ...base, verdict: { kind: "HOLD_CAP", detail: "cycle askSteem cap reached" } };
    }
  }

  // 4) RC floor
  if (state.rcPercent !== null && state.rcPercent < policy.minRcPct) {
    return { ...base, verdict: { kind: "HOLD_RC", detail: `rc ${state.rcPercent.toFixed(2)}% < minRcPct ${policy.minRcPct}%` } };
  }

  // 5) the measured threshold — LAST, so a clear edge with a blocked rail
  //    still reports WHY it was blocked (never a bare "no")
  if (!(edge.spreadBps >= policy.thresholds.minSpreadBps)) {
    return {
      ...base,
      verdict: {
        kind: "HOLD_SPREAD",
        detail: `measured edge ${edge.spreadBps.toFixed(2)} bps < threshold ${policy.thresholds.minSpreadBps} bps (${policy.thresholdsSource})`,
      },
    };
  }

  // 6) cycle op cap
  if (ledger.ops + 1 > policy.maxOpsPerCycle) {
    return { ...base, verdict: { kind: "HOLD_CAP", detail: "cycle ops cap reached" } };
  }

  return { ...base, verdict: { kind: "EXECUTE" } };
}

/** Plans the whole cycle across the roster. */
export function planCycle(input: PlanInput): { decisions: ConversionDecision[]; ledger: CycleLedger } {
  const ledger: CycleLedger = { ops: 0, askSteemSatoshis: 0, bidSbdSatoshis: 0 };
  const decisions: ConversionDecision[] = [];
  const edge = bestInternalEdge(input.table);

  for (const account of input.roster) {
    const state = input.states.get(account);
    const authority = input.authorities.get(account);
    // Conversion intent sizes: the WHOLE spendable side, capped by the
    // per-op notional ceiling — conservative by construction.
    const buySize = Math.min(
      Math.max((state?.sbdSatoshis ?? 0) - input.policy.bidReserveSbdSatoshis, 0),
      Math.round(input.policy.thresholds.maxNotionalSbdPerOp * 1000),
    );
    const sellSize = Math.min(state?.steemSatoshis ?? 0, Math.round(input.policy.thresholds.maxNotionalSbdPerOp * 1000));

    for (const action of ["BUY_STEEM_WITH_SBD", "SELL_STEEM_FOR_SBD"] as const) {
      const size = action === "BUY_STEEM_WITH_SBD" ? buySize : sellSize;
      const decision = decideConversion({
        account,
        action,
        edge,
        state,
        authority,
        policy: input.policy,
        ledger,
        sizeSatoshis: size,
        now: input.now,
      });
      if (decision.verdict.kind === "EXECUTE") {
        ledger.ops += 1;
        if (action === "BUY_STEEM_WITH_SBD") ledger.bidSbdSatoshis += size;
        else ledger.askSteemSatoshis += size;
      }
      decisions.push(decision);
    }
  }
  return { decisions, ledger };
}
