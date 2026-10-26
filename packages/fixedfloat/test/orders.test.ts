/**
 * Saosmartwallet packages/fixedfloat — order lifecycle + receipt law suite
 * ========================================================================
 * The rail's state model, honestly bounded:
 *
 *   • Documented v1 statuses map to lifecycle phases: 0 awaiting-deposit,
 *     1 confirming, 2 exchanging, 3 sending, 4 complete, -1 expired,
 *     -2 failed. ANY other code maps to "unknown" with the raw code carried —
 *     the connector never invents semantics for codes it has not measured.
 *   • Terminal law: complete / expired / failed are terminal; unknown is NOT
 *     assumed terminal (polling continues until measured otherwise).
 *   • Emergency law (setEmergency): REFUND requires a refund address —
 *     refused locally, zero wire; EXCHANGE refuses an address field (the
 *     exchange continuation uses the order's original destination).
 *   • Receipt chain: sha256-linked, deterministic (same op sequence ⇒ same
 *     hashes), tamper-evident (verify reports the broken index), and its
 *     printable form never carries credentials.
 */

import { describe, expect, test } from "bun:test";

import {
  statusPhase,
  isTerminalStatus,
  validateEmergencyAction,
  appendRailReceipt,
  verifyRailReceiptChain,
  RAIL_GENESIS_PREV_HASH,
  type FfOrderStatus,
} from "../src/orders";

describe("fixedfloat order status model — honest mapping", () => {
  test("documented statuses map to their measured phases", () => {
    expect(statusPhase(0 as FfOrderStatus)).toBe("awaiting-deposit");
    expect(statusPhase(1 as FfOrderStatus)).toBe("confirming");
    expect(statusPhase(2 as FfOrderStatus)).toBe("exchanging");
    expect(statusPhase(3 as FfOrderStatus)).toBe("sending");
    expect(statusPhase(4 as FfOrderStatus)).toBe("complete");
    expect(statusPhase(-1 as FfOrderStatus)).toBe("expired");
    expect(statusPhase(-2 as FfOrderStatus)).toBe("failed");
  });

  test("unmeasured codes map to unknown WITH the raw code preserved", () => {
    expect(statusPhase(7 as FfOrderStatus)).toEqual({ phase: "unknown", raw: 7 });
    expect(statusPhase(-99 as FfOrderStatus)).toEqual({ phase: "unknown", raw: -99 });
  });

  test("terminal law", () => {
    expect(isTerminalStatus(4 as FfOrderStatus)).toBe(true);
    expect(isTerminalStatus(-1 as FfOrderStatus)).toBe(true);
    expect(isTerminalStatus(-2 as FfOrderStatus)).toBe(true);
    expect(isTerminalStatus(2 as FfOrderStatus)).toBe(false);
    expect(isTerminalStatus(7 as FfOrderStatus)).toBe(false); // unknown ≠ terminal
  });
});

describe("fixedfloat emergency law", () => {
  test("REFUND without an address refuses locally", () => {
    const verdict = validateEmergencyAction({ id: "CH-1", choice: "REFUND", address: "" });
    expect(verdict.ok).toBe(false);
  });

  test("EXCHANGE with an address field refuses locally (destination comes from the order)", () => {
    const verdict = validateEmergencyAction({ id: "CH-1", choice: "EXCHANGE", address: "0xabc" });
    expect(verdict.ok).toBe(false);
  });

  test("valid forms pass: EXCHANGE bare, REFUND with address", () => {
    expect(validateEmergencyAction({ id: "CH-1", choice: "EXCHANGE" }).ok).toBe(true);
    expect(validateEmergencyAction({ id: "CH-1", choice: "REFUND", address: "0xabc" }).ok).toBe(true);
  });

  test("empty order id refuses", () => {
    expect(validateEmergencyAction({ id: "", choice: "EXCHANGE" }).ok).toBe(false);
  });
});

describe("fixedfloat rail receipts — hash-chain law", () => {
  const GENESIS = RAIL_GENESIS_PREV_HASH;

  function chainFixture() {
    let chain = appendRailReceipt(null, {
      at: 1_700_000_000,
      orderId: "CH-100",
      kind: "order-created",
      detail: { from: "BTC", to: "ETH", direction: "from", type: "fixed" },
    });
    chain = appendRailReceipt(chain, {
      at: 1_700_000_300,
      orderId: "CH-100",
      kind: "status-observed",
      detail: { phase: "exchanging" },
    });
    chain = appendRailReceipt(chain, {
      at: 1_700_000_600,
      orderId: "CH-100",
      kind: "status-observed",
      detail: { phase: "complete" },
    });
    return chain;
  }

  test("genesis prev hash is all-zero sha256-length bytes", () => {
    expect(GENESIS).toHaveLength(32);
    expect(GENESIS.every((b) => b === 0)).toBe(true);
  });

  test("records link prev→hash and verify green", () => {
    const head = chainFixture();
    const records = head.trail;
    expect(records).toHaveLength(3);
    const verdict = verifyRailReceiptChain(records);
    expect(verdict.ok).toBe(true);
    expect(verdict.brokenIndex).toBeUndefined();
  });

  test("deterministic: same sequence ⇒ identical hashes", () => {
    const a = chainFixture();
    const b = chainFixture();
    expect(a.hash).toEqual(b.hash);
    expect(a.trail.map((r) => r.hash)).toEqual(b.trail.map((r) => r.hash));
  });

  test("tamper-evident: flipping one byte is reported at the exact index", () => {
    const records = chainFixture().trail.map((r) => ({ ...r }));
    records[1]!.kind = "tampered";
    const verdict = verifyRailReceiptChain(records);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenIndex).toBe(1);
  });

  test("receipt payload stays credential-free by construction", () => {
    const head = appendRailReceipt(null, {
      at: 1_700_000_000,
      orderId: "CH-100",
      kind: "order-created",
      detail: { note: "any" },
    });
    const printed = JSON.stringify(head.record);
    expect(printed).not.toContain("apiSecret");
    expect(printed).not.toContain("apiKey");
  });
});
