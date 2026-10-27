/**
 * arb-executor — decision plane tests (verdict matrix, zero network)
 */
import { describe, expect, test } from "bun:test";

import { parseArmedPolicy } from "../src/policy";
import { planCycle, decideConversion, bestInternalEdge, type CycleLedger } from "../src/plan";
import type { OpportunityTable, Opportunity } from "../../arb-scanner/src/types";
import type { AccountState, AuthorityVerdict } from "../src/chain";

const NOW = 1_893_455_600_000;

const POLICY = parseArmedPolicy(
  { armed: true, maxOpsPerCycle: 60, maxAskSteemPerCycle: 320, maxBidSbdPerCycle: 100, bidReserveSbd: 0.5, minRcPct: 20, policy: { allowTransfersOut: false } },
  "fixture",
);

const EDGE: Opportunity = {
  pair: "STEEM/SBD",
  buyVenue: "steem-internal",
  sellVenue: "steem-internal",
  spreadBps: 150, // clears the 100bps builtin
  depthBaseSatoshis: 100_000,
  depthQuoteSatoshis: 10_000,
  buyPrice: 0.10241,
  sellPrice: 0.10206,
  basis: "same-book-cross",
  note: "fixture",
  at: new Date(NOW).toISOString(),
};

function tableWith(edge: Opportunity | null): OpportunityTable {
  return {
    schema: "arb-opportunities/1",
    at: new Date(NOW).toISOString(),
    scannerVersion: "1.0.0",
    corridors: edge
      ? [{ corridor: "STEEM_SBD_INTERNAL", opportunities: [edge], gaps: [], books: [] }]
      : [{ corridor: "STEEM_SBD_INTERNAL", opportunities: [], gaps: [], books: [] }],
    measured: [],
  };
}

const STATE: AccountState = {
  account: "fixture.alice",
  steemSatoshis: 50_000,
  sbdSatoshis: 20_000,
  activePubkeys: ["STMGood"],
  rcPercent: 92,
};

const AUTH_OK: AuthorityVerdict = { account: "fixture.alice", ok: true, matchedKeys: 1 };

function emptyLedger(): CycleLedger {
  return { ops: 0, askSteemSatoshis: 0, bidSbdSatoshis: 0 };
}

describe("decideConversion verdict matrix", () => {
  test("all laws pass → EXECUTE (buy side, measured price honored)", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: EDGE,
      state: STATE,
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 5_000,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("EXECUTE");
    expect(d.limitPrice).toBeCloseTo(0.10241, 8);
    expect(d.receiveSatoshis).toBe(Math.floor(5000 / 0.10241));
  });

  test("measured edge below threshold → HOLD_SPREAD with provenance", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "SELL_STEEM_FOR_SBD",
      edge: { ...EDGE, spreadBps: 42 },
      state: STATE,
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_SPREAD");
    if (d.verdict.kind === "HOLD_SPREAD") expect(d.verdict.detail).toContain("builtin-conservative");
  });

  test("bridge-gated corridor → HOLD_CORRIDOR_GATED (never assumed executable)", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: { ...EDGE, basis: "parity-assumed-cross", spreadBps: 900 },
      state: STATE,
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_CORRIDOR_GATED");
  });

  test("authority mismatch → HOLD_AUTHORITY (custody-wound class)", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: EDGE,
      state: STATE,
      authority: { account: "fixture.alice", ok: false, reason: "rotated off-vault", matchedKeys: 0 },
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_AUTHORITY");
  });

  test("bidReserveSbd eats the whole SBD balance → HOLD_RESERVE", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: EDGE,
      state: { ...STATE, sbdSatoshis: 400 }, // < 500 reserve
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 400,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_RESERVE");
  });

  test("intent above spendable → HOLD_BALANCE", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: EDGE,
      state: { ...STATE, sbdSatoshis: 10_000 },
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 9_600, // > 10000-500
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_BALANCE");
  });

  test("cycle caps → HOLD_CAP", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: EDGE,
      state: STATE,
      authority: AUTH_OK,
      policy: POLICY,
      ledger: { ops: 0, askSteemSatoshis: 0, bidSbdSatoshis: 99_500 },
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_CAP");
  });

  test("RC below floor → HOLD_RC; unknown RC (null) never blocks", () => {
    const low = decideConversion({
      account: "fixture.alice",
      action: "SELL_STEEM_FOR_SBD",
      edge: EDGE,
      state: { ...STATE, rcPercent: 12 },
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(low.verdict.kind).toBe("HOLD_RC");
    const unknown = decideConversion({
      account: "fixture.alice",
      action: "SELL_STEEM_FOR_SBD",
      edge: EDGE,
      state: { ...STATE, rcPercent: null },
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(unknown.verdict.kind).toBe("EXECUTE");
  });

  test("no measured edge → HOLD_NO_OPPORTUNITY", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: null,
      state: STATE,
      authority: AUTH_OK,
      policy: POLICY,
      ledger: emptyLedger(),
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_NO_OPPORTUNITY");
  });
});

describe("planCycle (full roster, caps ledger)", () => {
  test("healthy account with clearing edge executes within caps; ledger counts both sides", () => {
    const table = tableWith(EDGE);
    const states = new Map([["fixture.alice", STATE]]);
    const auths = new Map([["fixture.alice", AUTH_OK]]);
    const { decisions, ledger } = planCycle({
      table,
      policy: POLICY,
      states,
      authorities: auths,
      roster: ["fixture.alice"],
      now: NOW,
    });
    expect(decisions.length).toBe(2);
    const buy = decisions.find((d) => d.action === "BUY_STEEM_WITH_SBD")!;
    const sell = decisions.find((d) => d.action === "SELL_STEEM_FOR_SBD")!;
    expect(buy.verdict.kind).toBe("EXECUTE");
    expect(sell.verdict.kind).toBe("EXECUTE");
    expect(ledger.ops).toBe(2);
    // buy size = min(sbd 20000 - 500 reserve, 50k notional cap) = 19_500
    expect(ledger.bidSbdSatoshis).toBe(19_500);
    // sell size = min(steem 50_000, 50_000) = 50_000
    expect(ledger.askSteemSatoshis).toBe(50_000);
  });

  test("capped ledger blocks subsequent buys but reports why", () => {
    const d = decideConversion({
      account: "fixture.alice",
      action: "BUY_STEEM_WITH_SBD",
      edge: EDGE,
      state: STATE,
      authority: AUTH_OK,
      policy: POLICY,
      ledger: { ops: 0, askSteemSatoshis: 0, bidSbdSatoshis: POLICY.maxBidSbdPerCycleSatoshis },
      sizeSatoshis: 1_000,
      now: NOW,
    });
    expect(d.verdict.kind).toBe("HOLD_CAP");
  });

  test("empty table → every decision HOLD_NO_OPPORTUNITY (honest zero)", () => {
    const { decisions } = planCycle({
      table: tableWith(null),
      policy: POLICY,
      states: new Map([["fixture.alice", STATE]]),
      authorities: new Map([["fixture.alice", AUTH_OK]]),
      roster: ["fixture.alice"],
      now: NOW,
    });
    expect(decisions.length).toBe(2);
    for (const d of decisions) expect(d.verdict.kind).toBe("HOLD_NO_OPPORTUNITY");
  });

  test("bestInternalEdge picks the max same-book row and ignores gated rows", () => {
    const table: OpportunityTable = {
      schema: "arb-opportunities/1",
      at: "x",
      scannerVersion: "1",
      corridors: [
        {
          corridor: "STEEM_SBD_INTERNAL",
          opportunities: [
            { ...EDGE, spreadBps: 10 },
            { ...EDGE, spreadBps: 90 },
          ],
          gaps: [],
          books: [],
        },
        {
          corridor: "STEEM_HIVE_BRIDGE",
          opportunities: [{ ...EDGE, basis: "parity-assumed-cross", spreadBps: 9_000 }],
          gaps: [],
          books: [],
        },
      ],
      measured: [],
    };
    const best = bestInternalEdge(table);
    expect(best!.spreadBps).toBe(90);
  });
});
