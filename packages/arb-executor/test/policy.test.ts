/**
 * arb-executor — armed policy (fail-closed) tests
 */
import { describe, expect, test } from "bun:test";

import { parseArmedPolicy, BUILTIN_ARB_THRESHOLDS, MAX_OPS_PER_CYCLE_CAP, loadArmedPolicy } from "../src/policy";

const VALID = {
  armed: true,
  maxOpsPerCycle: 60,
  maxAskSteemPerCycle: 320,
  maxBidSbdPerCycle: 100,
  bidReserveSbd: 0.5,
  minRcPct: 20,
  policy: { allowTransfersOut: false },
};

describe("parseArmedPolicy", () => {
  test("valid policy loads with builtin-conservative thresholds when owner is silent", () => {
    const p = parseArmedPolicy(VALID, "/tmp/exec-armed.json");
    expect(p.armed).toBe(true);
    expect(p.maxOpsPerCycle).toBe(60);
    expect(p.maxAskSteemPerCycleSatoshis).toBe(320_000);
    expect(p.maxBidSbdPerCycleSatoshis).toBe(100_000);
    expect(p.bidReserveSbdSatoshis).toBe(500);
    expect(p.minRcPct).toBe(20);
    expect(p.allowTransfersOut).toBe(false);
    expect(p.thresholds).toEqual(BUILTIN_ARB_THRESHOLDS);
    expect(p.thresholdsSource).toBe("builtin-conservative");
  });

  test("owner-supplied arb thresholds are honored and sourced honestly", () => {
    const p = parseArmedPolicy({ ...VALID, policy: { allowTransfersOut: false, arb: { minSpreadBps: 37, maxNotionalSbdPerOp: 5, orderTtlSec: 600 } } }, "x");
    expect(p.thresholds.minSpreadBps).toBe(37);
    expect(p.thresholds.maxNotionalSbdPerOp).toBe(5);
    expect(p.thresholds.orderTtlSec).toBe(600);
    expect(p.thresholdsSource).toBe("owner-policy");
  });

  test("disarmed policy is refused (fail-closed)", () => {
    expect(() => parseArmedPolicy({ ...VALID, armed: false }, "x")).toThrow(/ARMED_POLICY_E_DISARMED/);
    expect(() => parseArmedPolicy({}, "x")).toThrow(/ARMED_POLICY_E_DISARMED/);
  });

  test("transfer law: allowTransfersOut ≠ false is refused", () => {
    expect(() => parseArmedPolicy({ ...VALID, policy: { allowTransfersOut: true } }, "x")).toThrow(/ARMED_POLICY_E_TRANSFER_LAW/);
    expect(() => parseArmedPolicy({ ...VALID, policy: {} }, "x")).toThrow(/ARMED_POLICY_E_TRANSFER_LAW/);
    expect(() => parseArmedPolicy({ armed: true }, "x")).toThrow(/ARMED_POLICY_E_TRANSFER_LAW/);
  });

  test("ops cap above the mandate ceiling is refused", () => {
    expect(() => parseArmedPolicy({ ...VALID, maxOpsPerCycle: 61 }, "x")).toThrow(/ARMED_POLICY_E_CAP/);
    expect(() => parseArmedPolicy({ ...VALID, maxOpsPerCycle: MAX_OPS_PER_CYCLE_CAP }, "x")).not.toThrow();
    expect(() => parseArmedPolicy({ ...VALID, maxOpsPerCycle: 12.5 }, "x")).toThrow(/ARMED_POLICY_E_CAP/);
  });

  test("malformed numbers and TTL bounds are refused", () => {
    expect(() => parseArmedPolicy({ ...VALID, maxBidSbdPerCycle: -1 }, "x")).toThrow(/ARMED_POLICY_E_FIELD/);
    expect(() => parseArmedPolicy({ ...VALID, policy: { allowTransfersOut: false, arb: { orderTtlSec: 10 } } }, "x")).toThrow(/ARMED_POLICY_E_TTL/);
    expect(() => parseArmedPolicy({ ...VALID, policy: { allowTransfersOut: false, arb: { orderTtlSec: 9999 } } }, "x")).toThrow(/ARMED_POLICY_E_TTL/);
  });

  test("custody read failure is fail-closed with a named error", () => {
    expect(() => loadArmedPolicy("/nonexistent/exec-armed.json")).toThrow(/ARMED_POLICY_E_CUSTODY/);
  });
});
