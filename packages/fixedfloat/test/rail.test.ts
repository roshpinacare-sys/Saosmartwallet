/**
 * Saosmartwallet packages/fixedfloat — TDD suite 4/4: swap rail + HTLC honesty
 * ==============================================================================
 * Red-first, deterministic (injected transport, injected clock/sleep). This suite
 * pins the CROSS-CHAIN RAIL CONTRACT between the official FixedFloat v2 order
 * lifecycle and packages/swap's trustless HTLC session model — including the
 * HONEST REFUSALS where the rail cannot honor the atomic-swap laws.
 *
 * Status vocabulary (official docs, archived): NEW, PENDING, EXCHANGE, WITHDRAW,
 * DONE, EXPIRED, EMERGENCY (+ emergency.choice EXCHANGE|REFUND).
 *
 * Laws pinned here:
 *   • STATUS TABLE: every official status maps to exactly one rail phase; an
 *     UNKNOWN status is a fail-honest refusal (FF_E_STATE) — the rail never
 *     guesses what an unfamiliar status means for funds.
 *   • HTLC HONESTY: FixedFloat v2 exposes NO hashlock parameter and NO user
 *     timelock parameter — trustless atomicity is therefore REFUSED on this rail
 *     with precise causes; the rail is custodial and says so. The timelock
 *     analog (order expiration → EXPIRED) is reported as DATA, never claimed as
 *     an HTLC timelock.
 *   • SETTLE EVIDENCE: a DONE order yields evidence {txid: "ff:<orderId>",
 *     chainProof: false, kind: "fixedfloat-order"} — the rail NEVER fabricates
 *     an on-chain txid and never claims chain-level proof; the session glue
 *     (packages/swap) accepts the evidence id while the custody disclosure
 *     stays attached.
 *   • REFUND PATHS: EMERGENCY ⇒ emergencyAction choice=REFUND with a required
 *     refund address (fail-closed without one); EXPIRED ⇒ the service refunds
 *     per its own policy — the rail reports REFUNDED-TIMEOUT and never invents
 *     a manual trigger the API does not offer.
 *   • POLL LAW: polling is bounded (maxPolls), deterministic (injected sleep),
 *     and exhausts honest (FF_E_POLL_TIMEOUT carrying the last observed status).
 */

import { describe, expect, test } from "bun:test";

import { FixedFloatClient } from "../src/client";
import { FixedFloatError } from "../src/errors";
import {
  FF_ORDER_STATUSES,
  FixedFloatSwapRail,
  htlcSupport,
  mapOrderStatus,
  RAIL_CUSTODY_DISCLOSURE,
  settleEvidence,
  settleVerdict,
  type RailOrder,
  type RailPhase,
} from "../src/rail";

const KEY = "FFDUMMY-KEY";
const SECRET = "ff-test-secret";
const BASE = "https://ff.io/api/v2/";

function order(over: Partial<RailOrder> = {}): RailOrder {
  return {
    id: "8PQWPY",
    token: "tok",
    status: "NEW",
    type: "fixed",
    time: { reg: 100, start: null, finish: null, update: 100, expiration: 3600, left: 3500 },
    emergency: { status: [], choice: "NONE", repeat: 0 },
    ...over,
  };
}

function scriptedClient(responses: Array<{ status: number; text: string }>) {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  let i = 0;
  const transport = async (req: { url: string; body: string; headers: Record<string, string> }) => {
    calls.push({ ...req });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return next;
  };
  const client = new FixedFloatClient({
    apiKey: KEY,
    apiSecret: SECRET,
    transport,
    sleep: async () => {},
    rng: () => 0,
  });
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Status mapping (official 7-value table)
// ---------------------------------------------------------------------------

describe("mapOrderStatus — official status table", () => {
  test.each([
    ["NEW", "deposit-waiting"],
    ["PENDING", "deposit-confirming"],
    ["EXCHANGE", "exchanging"],
    ["WITHDRAW", "sending"],
    ["DONE", "settled"],
    ["EXPIRED", "expired"],
    ["EMERGENCY", "emergency"],
  ])("%s ⇒ %s", (status, phase) => {
    expect(mapOrderStatus(status)).toBe(phase as RailPhase);
  });

  test("all seven statuses are declared in FF_ORDER_STATUSES", () => {
    expect(FF_ORDER_STATUSES).toEqual(["NEW", "PENDING", "EXCHANGE", "WITHDRAW", "DONE", "EXPIRED", "EMERGENCY"]);
  });

  test.each(["WAT", "failed", "", "DONE ", "done"])("unknown/foreign status %s ⇒ FF_E_STATE (never guesses)", (status) => {
    try {
      mapOrderStatus(status);
      throw new Error("expected FF_E_STATE");
    } catch (err) {
      expect(err).toBeInstanceOf(FixedFloatError);
      expect((err as FixedFloatError).code).toBe("FF_E_STATE");
      expect((err as Error).message).toContain("status");
    }
  });
});

// ---------------------------------------------------------------------------
// HTLC honesty — the core refusal verdicts
// ---------------------------------------------------------------------------

describe("htlcSupport — honest REFUSED verdicts for the trustless laws", () => {
  const support = htlcSupport();

  test("hashlock: REFUSED — FixedFloat v2 exposes no hashlock parameter", () => {
    expect(support.hashlock.verdict).toBe("REFUSED");
    expect(support.hashlock.supported).toBe(false);
    expect(support.hashlock.cause).toContain("hashlock");
    expect(support.hashlock.cause).toContain("v2");
  });

  test("timelock: REFUSED — no user timelock parameter; expiration is order data, not an HTLC lock", () => {
    expect(support.timelock.verdict).toBe("REFUSED");
    expect(support.timelock.supported).toBe(false);
    expect(support.timelock.cause).toContain("timelock");
  });

  test("custody model disclosed as custodial with a non-empty note", () => {
    expect(support.custodyModel).toBe("custodial");
    expect(support.note.length).toBeGreaterThan(20);
    expect(RAIL_CUSTODY_DISCLOSURE.length).toBeGreaterThan(20);
  });

  test("a rail that ever claims hashlock support would breach the verdict law", () => {
    // Guard against accidental "supported" regressions in the literal object.
    expect(JSON.stringify(support.hashlock).includes('"supported":true')).toBe(false);
    expect(JSON.stringify(support.timelock).includes('"supported":true')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Settle verdicts + evidence (no fabricated chain proof)
// ---------------------------------------------------------------------------

describe("settleVerdict + settleEvidence — honest lifecycle mapping", () => {
  test.each(["NEW", "PENDING", "EXCHANGE", "WITHDRAW"])("%s ⇒ IN-FLIGHT", (status) => {
    expect(settleVerdict(order({ status })).verdict).toBe("IN-FLIGHT");
  });

  test("DONE ⇒ SETTLED with evidence txid ff:<orderId>, chainProof:false", () => {
    const o = order({ status: "DONE", time: { reg: 1, start: 2, finish: 9, update: 9, expiration: 3600, left: 0 } });
    const v = settleVerdict(o);
    expect(v.verdict).toBe("SETTLED");
    expect(v.evidence.orderId).toBe("8PQWPY");
    expect(v.evidence.status).toBe("DONE");
    const ev = settleEvidence(o);
    expect(ev.txid).toBe("ff:8PQWPY");
    expect(ev.chainProof).toBe(false);
    expect(ev.kind).toBe("fixedfloat-order");
  });

  test("EXPIRED ⇒ REFUNDED-TIMEOUT (service-side refund policy, honestly labeled)", () => {
    const v = settleVerdict(order({ status: "EXPIRED" }));
    expect(v.verdict).toBe("REFUNDED-TIMEOUT");
    expect(v.evidence.chainProof).toBe(false);
  });

  test("EMERGENCY ⇒ EMERGENCY-CHOICE-REQUIRED with the emergency payload data attached", () => {
    const v = settleVerdict(order({ status: "EMERGENCY", emergency: { status: ["LIMIT"], choice: "NONE", repeat: 0 } }));
    expect(v.verdict).toBe("EMERGENCY-CHOICE-REQUIRED");
    expect(v.evidence.status).toBe("EMERGENCY");
  });

  test("unknown status in settleVerdict ⇒ FF_E_STATE", () => {
    expect(() => settleVerdict(order({ status: "LOST" }))).toThrow(FixedFloatError);
  });
});

// ---------------------------------------------------------------------------
// The rail — order creation, polling, refund actions
// ---------------------------------------------------------------------------

describe("FixedFloatSwapRail — createSwapLegOrder (fail-closed request schema)", () => {
  test("valid fixed-rate leg ⇒ create payload canonical; returns orderId/token/status/expiration", async () => {
    const data = {
      id: "8PQWPY",
      token: "tok",
      status: "NEW",
      type: "fixed",
      time: { reg: 1, start: null, finish: null, update: 1, expiration: 7200, left: 7200 },
    };
    const { client, calls } = scriptedClient([{ status: 200, text: JSON.stringify({ code: 0, msg: "OK", data }) }]);
    const rail = new FixedFloatSwapRail(client);
    const leg = await rail.createSwapLegOrder({
      type: "fixed",
      fromCcy: "BTC",
      toCcy: "ETH",
      direction: "from",
      amount: 0.5,
      toAddress: "bc1qtest",
    });
    expect(leg.orderId).toBe("8PQWPY");
    expect(leg.token).toBe("tok");
    expect(leg.status).toBe("NEW");
    expect(leg.expiresAt).toBe(7200);
    expect(calls[0].url).toBe(BASE + "create");
    expect(calls[0].body).toContain('"type":"fixed"');
  });

  test.each([
    ["bad type", { type: "aggressive", fromCcy: "BTC", toCcy: "ETH", direction: "from", amount: 1, toAddress: "x" }],
    ["zero amount", { type: "fixed", fromCcy: "BTC", toCcy: "ETH", direction: "from", amount: 0, toAddress: "x" }],
    ["negative amount", { type: "fixed", fromCcy: "BTC", toCcy: "ETH", direction: "from", amount: -1, toAddress: "x" }],
    ["empty address", { type: "fixed", fromCcy: "BTC", toCcy: "ETH", direction: "from", amount: 1, toAddress: "" }],
    ["bad direction", { type: "fixed", fromCcy: "BTC", toCcy: "ETH", direction: "sideways", amount: 1, toAddress: "x" }],
    ["empty fromCcy", { type: "fixed", fromCcy: "", toCcy: "ETH", direction: "from", amount: 1, toAddress: "x" }],
  ])("invalid leg request (%s) ⇒ FF_E_STATE before any transport call", async (_n, req) => {
    const { client, calls } = scriptedClient([{ status: 200, text: '{"code":0,"msg":"OK","data":{}}' }]);
    const rail = new FixedFloatSwapRail(client);
    try {
      await rail.createSwapLegOrder(req as never);
      throw new Error("expected FF_E_STATE");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_STATE");
    }
    expect(calls.length).toBe(0); // refused BEFORE the network
  });

  test("API rejection (code≠0, e.g. LIMIT_MIN) surfaces honestly as FF_E_API", async () => {
    const { client } = scriptedClient([{ status: 200, text: JSON.stringify({ code: 3015, msg: "amount less than the minimum" }) }]);
    const rail = new FixedFloatSwapRail(client);
    try {
      await rail.createSwapLegOrder({ type: "float", fromCcy: "BTC", toCcy: "ETH", direction: "from", amount: 0.00001, toAddress: "x" });
      throw new Error("expected FF_E_API");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_API");
      expect((err as Error).message).toContain("3015");
    }
  });
});

describe("FixedFloatSwapRail — bounded deterministic polling", () => {
  test("PENDING → PENDING → DONE: returns the settled order, sleeps between polls", async () => {
    const mk = (status: string) => ({ status: 200, text: JSON.stringify({ code: 0, msg: "OK", data: order({ status }) }) });
    const sleeps: number[] = [];
    const calls: unknown[] = [];
    const transport = async (req: { url: string; body: string; headers: Record<string, string> }) => {
      calls.push({ ...req });
      const next = [mk("PENDING"), mk("PENDING"), mk("DONE")][Math.min(calls.length - 1, 2)];
      return next;
    };
    const client = new FixedFloatClient({
      apiKey: KEY,
      apiSecret: SECRET,
      transport,
      sleep: async (ms: number) => { sleeps.push(ms); },
      rng: () => 0,
    });
    const rail = new FixedFloatSwapRail(client);
    const done = await rail.pollOrderUntil("8PQWPY", "tok", {
      accept: (o) => o.status === "DONE",
      maxPolls: 5,
      intervalMs: 1000,
    });
    expect(done.status).toBe("DONE");
    expect(sleeps).toEqual([1000, 1000]);
    expect(calls.length).toBe(3);
  });

  test("exhaustion ⇒ FF_E_POLL_TIMEOUT carrying the last observed status", async () => {
    const { client } = scriptedClient([{ status: 200, text: JSON.stringify({ code: 0, msg: "OK", data: order({ status: "PENDING" }) }) }]);
    const rail = new FixedFloatSwapRail(client);
    try {
      await rail.pollOrderUntil("8PQWPY", "tok", { accept: (o) => o.status === "DONE", maxPolls: 3, intervalMs: 5 });
      throw new Error("expected FF_E_POLL_TIMEOUT");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_POLL_TIMEOUT");
      expect((err as Error).message).toContain("PENDING");
    }
  });

  test("maxPolls must be a positive integer (fail-closed)", async () => {
    const { client } = scriptedClient([{ status: 200, text: JSON.stringify({ code: 0, msg: "OK", data: order() }) }]);
    const rail = new FixedFloatSwapRail(client);
    try {
      await rail.pollOrderUntil("8PQWPY", "tok", { accept: () => false, maxPolls: 0, intervalMs: 1 });
      throw new Error("expected FF_E_STATE");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_STATE");
    }
  });
});

describe("FixedFloatSwapRail — refund paths", () => {
  test("EMERGENCY + REFUND requires a refund address (fail-closed)", async () => {
    const { client, calls } = scriptedClient([{ status: 200, text: '{"code":0,"msg":"OK","data":{"choice":"REFUND"}}' }]);
    const rail = new FixedFloatSwapRail(client);
    try {
      await rail.emergencyRefund("8PQWPY", "tok", "");
      throw new Error("expected FF_E_STATE");
    } catch (err) {
      expect((err as FixedFloatError).code).toBe("FF_E_STATE");
    }
    expect(calls.length).toBe(0);
  });

  test("EMERGENCY + REFUND with address ⇒ emergency payload choice=REFUND", async () => {
    const { client, calls } = scriptedClient([{ status: 200, text: '{"code":0,"msg":"OK","data":{"choice":"REFUND"}}' }]);
    const rail = new FixedFloatSwapRail(client);
    await rail.emergencyRefund("8PQWPY", "tok", "bc1qrefund");
    expect(calls[0].url).toBe(BASE + "emergency");
    expect(calls[0].body).toBe('{"address":"bc1qrefund","choice":"REFUND","id":"8PQWPY","token":"tok"}');
  });

  test("emergencyExchange ⇒ choice=EXCHANGE, no address required", async () => {
    const { client, calls } = scriptedClient([{ status: 200, text: '{"code":0,"msg":"OK","data":{"choice":"EXCHANGE"}}' }]);
    const rail = new FixedFloatSwapRail(client);
    await rail.emergencyExchange("8PQWPY", "tok");
    expect(calls[0].body).toBe('{"choice":"EXCHANGE","id":"8PQWPY","token":"tok"}');
  });

  test("expired order maps to the honest AUTO-POLICY refund recommendation (no invented trigger)", async () => {
    const { client } = scriptedClient([{ status: 200, text: JSON.stringify({ code: 0, msg: "OK", data: order({ status: "EXPIRED" }) }) }]);
    const rail = new FixedFloatSwapRail(client);
    const rec = rail.refundPath(order({ status: "EXPIRED" }));
    expect(rec.action).toBe("AUTO-POLICY");
    expect(rec.verdict).toBe("REFUNDED-TIMEOUT");
    const recE = rail.refundPath(order({ status: "EMERGENCY" }));
    expect(recE.action).toBe("REFUND-EMERGENCY");
    expect(recE.requiresAddress).toBe(true);
    expect(recE.verdict).toBe("EMERGENCY-CHOICE-REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Session glue — packages/swap accepts the custodial evidence id, honestly labeled
// ---------------------------------------------------------------------------

describe("rail↔session glue — custodial evidence id in the swap session", () => {
  test("sessionInitiateLegA accepts ff:<orderId> as commit evidence; custody disclosure stays explicit", async () => {
    const { createSwapSession, sessionInitiateLegA } = await import("../../swap/src/session");
    const o = order({ status: "DONE" });
    const ev = settleEvidence(o);
    const preimage = new Uint8Array(32).fill(7);
    const { view } = createSwapSession({
      swapId: "rail-glue-test",
      legA: { chain: "fixedfloat", asset: "BTC", amount: "0.5 BTC", initiator: "ff-initiator", responder: "ff-responder", timeoutSeconds: 3600 },
      legB: { chain: "steem", asset: "STEEM", amount: "1.000 STEEM", initiator: "ff-responder", responder: "ff-initiator", timeoutSeconds: 1800 },
      preimage,
    });
    sessionInitiateLegA(view, { now: 1000, txid: ev.txid });
    expect(view.legA.committedTxid).toBe("ff:8PQWPY");
    expect(ev.chainProof).toBe(false);
    expect(RAIL_CUSTODY_DISCLOSURE).toContain("custodial");
  });
});
