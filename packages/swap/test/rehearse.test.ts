/**
 * Saosmartwallet packages/swap — full-lifecycle swap rehearsal TDD suite (agent-9, wave W49)
 * ============================================================================================
 * Red-first suite for the rehearsal harness: the DIRECTIVE §3 production-grade
 * proof that drives the REAL session + REAL witness + REAL packer through the
 * complete atomic-swap lifecycle with a deterministic injected clock, zero
 * network, and zero broadcast — producing a self-verifying hash-chained
 * rehearsal report (SAOS-SWAP-REHEARSAL/1).
 *
 * Laws pinned here:
 *   • REHEARSAL IDENTITY: party ids must carry the "rehearsal:" prefix — the
 *     harness refuses production-looking account ids (broadcast-confusion
 *     guard; the rehearsal never signs with real authorities).
 *   • WIRE TRUTH: every step's txid is the REAL digest of a REAL witness
 *     transaction (sha256(chainId ‖ serialized tx)) through the oracle-proven
 *     packer — the report carries the full wire block (account, jsonId,
 *     authority, refBlockNum/Prefix, expiration, chainIdHex) so an external
 *     verifier can rebuild every digest byte-for-byte.
 *   • BINDING TRUTH: every witness payload's hashlock equals the session's
 *     hashlock; reveal payloads re-prove sha256(preimage) === hashlock inside
 *     the witness validator during external verification.
 *   • DETERMINISM: fixed clock + derived preimage/chainIds → identical report
 *     hash across runs; no wall-clock, no randomness anywhere in the harness.
 *   • HASH-CHAIN LAW: report.hash = sha256(canonicalJson(report minus hash));
 *     prevHash chains rehearsals (genesis = 64 zeros); tampered reports fail
 *     verification loudly.
 *   • FAIL-CLOSED PROBES: each scenario deliberately attempts a law-violating
 *     action and RECORDS the refusal (safety T1<=T2, counter-claim before
 *     reveal, respond after refund, claim in draft) — a law that stops
 *     refusing fails the rehearsal loudly.
 *   • HONEST ENDINGS: happy path settles both legs; responder-absent refunds
 *     legA at/after T1; initiator-absent refunds legB at/after T2 — every
 *     scenario ends claimed-or-refunded, receipts chain verified.
 */

import { describe, expect, test } from "bun:test";

import {
  REHEARSAL_ID_PREFIX,
  REHEARSAL_KIND,
  rehearseAtomicSwap,
  verifyRehearsalReport,
  type RehearsalOptions,
  type RehearsalReport,
  type RehearsalScenario,
} from "../src/rehearse";
import { canonicalJson, sha256Bytes } from "../src/htlc";
import { buildWitnessCustomJson, buildWitnessTransaction, bytesToHex, hexToBytes, witnessTransactionDigest, HTLC_WITNESS_JSON_ID } from "../src/witness";
import { OP_IDS } from "../../chains/steem/src/operations";

const NOW0 = 1_800_000_000;

function baseOpts(over: Partial<RehearsalOptions> = {}): RehearsalOptions {
  return { now0: NOW0, ...over };
}

describe("rehearsal identity laws", () => {
  test("refuses party ids without the rehearsal: prefix (broadcast-confusion guard)", () => {
    expect(() => rehearseAtomicSwap(baseOpts({ initiator: "headcorner" }))).toThrow(/rehearsal/i);
    expect(() => rehearseAtomicSwap(baseOpts({ responder: "someaccount" }))).toThrow(/rehearsal/i);
    expect(REHEARSAL_ID_PREFIX).toBe("rehearsal:");
  });

  test("refuses non-integer or negative now0 (injected-clock law)", () => {
    expect(() => rehearseAtomicSwap(baseOpts({ now0: 1.5 }))).toThrow(/now0/i);
    expect(() => rehearseAtomicSwap(baseOpts({ now0: -1 }))).toThrow(/now0/i);
    expect(() => rehearseAtomicSwap(baseOpts({ now0: Number.NaN }))).toThrow(/now0/i);
  });

  test("refuses a malformed prevHash (hash-chain link law)", () => {
    expect(() => rehearseAtomicSwap(baseOpts({ prevHash: "not-hex" }))).toThrow(/prevHash/i);
    expect(() => rehearseAtomicSwap(baseOpts({ prevHash: "AB" .repeat(32) }))).toThrow(/prevHash/i);
  });
});

describe("happy path — full settlement", () => {
  const report: RehearsalReport = rehearseAtomicSwap(baseOpts());

  test("verdict SETTLED with the four production steps in order", () => {
    expect(report.kind).toBe(REHEARSAL_KIND);
    expect(report.kind).toBe("SAOS-SWAP-REHEARSAL/1");
    expect(report.verdict).toBe("SETTLED");
    expect(report.scenario).toBe("happy-path");
    expect(report.steps.map((s) => s.step)).toEqual([
      "initiate-legA",
      "respond-legB",
      "claim-legB",
      "counter-claim-legA",
    ]);
    expect(report.steps[3].phase).toBe("settled");
  });

  test("every txid is 64 lowercase hex and the receipt chain verifies", () => {
    for (const step of report.steps) {
      expect(step.txid).toMatch(/^[0-9a-f]{64}$/);
      expect(step.at).toBeTypeOf("number");
      expect(step.witnessJson).toBeTypeOf("string");
    }
    expect(report.receiptChain.ok).toBe(true);
    expect(report.receiptChain.length).toBe(4);
    expect(report.receipts).toHaveLength(4);
  });

  test("witness payloads bind to the session hashlock (legA lock payload carries the session hashlock)", () => {
    const lockA = JSON.parse(report.steps[0].witnessJson) as { phase: string; leg: string; hashlock: string; swap: string; v: number };
    const revealB = JSON.parse(report.steps[2].witnessJson) as { phase: string; preimage?: string; hashlock: string };
    expect(lockA.phase).toBe("hashlock");
    expect(lockA.leg).toBe("A");
    expect(lockA.v).toBe(1);
    expect(revealB.phase).toBe("preimage");
    expect(typeof revealB.preimage).toBe("string");
    // Binding truth: the reveal payload's preimage hashes to ITS OWN hashlock —
    // the witness validator re-proves this during external verification too.
    const preimageBytes = hexToBytes(revealB.preimage as string);
    expect(bytesToHex(sha256Bytes(preimageBytes))).toBe(revealB.hashlock);
    // One hashlock across the session: lock-A and reveal-B commit to the same binding.
    expect(revealB.hashlock).toBe(lockA.hashlock);
  });

  test("txids are REAL witness digests — externally rebuildable from the wire block", () => {
    for (const step of report.steps) {
      const payload = JSON.parse(step.witnessJson) as Parameters<typeof buildWitnessCustomJson>[0]["payload"];
      const op = buildWitnessCustomJson({
        account: step.wire.account,
        payload,
        jsonId: step.wire.jsonId,
        authority: step.wire.authority,
      });
      const tx = buildWitnessTransaction({
        refBlockNum: step.wire.refBlockNum,
        refBlockPrefix: step.wire.refBlockPrefix,
        expiration: step.wire.expiration,
        operations: [{ kind: "custom_json", account: step.wire.account, payload, jsonId: step.wire.jsonId, authority: step.wire.authority }],
      });
      const digest = witnessTransactionDigest(tx, hexToBytes(step.wire.chainIdHex), OP_IDS);
      expect(bytesToHex(digest)).toBe(step.txid);
      void op;
    }
  });

  test("legs derive distinct per-leg chain ids (rehearsal domain separation)", () => {
    const chainA = report.steps[0].wire.chainIdHex;
    const chainB = report.steps[1].wire.chainIdHex;
    expect(chainA).toMatch(/^[0-9a-f]{64}$/);
    expect(chainA).not.toBe(chainB);
  });

  test("fail-closed probes were exercised and recorded (laws bite during rehearsal)", () => {
    expect(report.refusals.length).toBeGreaterThanOrEqual(2);
    const refusedKinds = report.refusals.map((r) => r.refused);
    expect(refusedKinds).toContain("construct T1<=T2 session");
    expect(refusedKinds).toContain("counter-claim before public reveal");
    for (const r of report.refusals) {
      expect(r.because.length).toBeGreaterThan(0);
    }
  });
});

describe("honest failure endings", () => {
  test("responder absent → REFUND-A at/after T1, respond-after-refund refused", () => {
    const report = rehearseAtomicSwap(baseOpts({ scenario: "responder-absent" }));
    expect(report.verdict).toBe("REFUND-A");
    expect(report.scenario).toBe("responder-absent");
    expect(report.steps.map((s) => s.step)).toEqual(["initiate-legA", "refund-legA"]);
    // The refund happened no earlier than the legA expiry (refund law: now >= expiresAt).
    const refundStep = report.steps[1];
    const legAExpiry = (JSON.parse(report.steps[0].witnessJson) as { expiresAt: number }).expiresAt;
    expect(refundStep.at).toBeGreaterThanOrEqual(legAExpiry);
    expect(report.receiptChain.ok).toBe(true);
    expect(report.receiptChain.length).toBe(2);
    const refused = report.refusals.map((r) => r.refused);
    expect(refused).toContain("respond after legA refund");
  });

  test("initiator absent → REFUND-B at/after T2, claim-in-draft refused", () => {
    const report = rehearseAtomicSwap(baseOpts({ scenario: "initiator-absent" }));
    expect(report.verdict).toBe("REFUND-B");
    expect(report.scenario).toBe("initiator-absent");
    expect(report.steps.map((s) => s.step)).toEqual(["initiate-legA", "respond-legB", "refund-legB"]);
    const refundStep = report.steps[2];
    const legBExpiry = (JSON.parse(report.steps[1].witnessJson) as { expiresAt: number }).expiresAt;
    expect(refundStep.at).toBeGreaterThanOrEqual(legBExpiry);
    expect(report.receiptChain.ok).toBe(true);
    expect(report.receiptChain.length).toBe(3);
    const refused = report.refusals.map((r) => r.refused);
    expect(refused).toContain("claim legB in draft");
  });
});

describe("report hash-chain law", () => {
  test("deterministic: identical inputs → identical report hash (no wall-clock, no randomness)", () => {
    const a = rehearseAtomicSwap(baseOpts());
    const b = rehearseAtomicSwap(baseOpts());
    expect(a.hash).toBe(b.hash);
    expect(a.prevHash).toBe("0".repeat(64));
    const c = rehearseAtomicSwap(baseOpts({ now0: NOW0 + 1 }));
    expect(c.hash).not.toBe(a.hash);
  });

  test("prevHash chaining links a rehearsal to its predecessor", () => {
    const first = rehearseAtomicSwap(baseOpts());
    const second = rehearseAtomicSwap(baseOpts({ prevHash: first.hash }));
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
    expect(verifyRehearsalReport(second).ok).toBe(true);
  });

  test("verifyRehearsalReport accepts an honest report and rejects a tampered one", () => {
    const report = rehearseAtomicSwap(baseOpts());
    expect(verifyRehearsalReport(report)).toMatchObject({ ok: true });

    const tampered: RehearsalReport = JSON.parse(JSON.stringify(report));
    tampered.steps[0].txid = "f".repeat(64);
    const verdict = verifyRehearsalReport(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason === "step-digest-mismatch" || verdict.reason === "hash-mismatch").toBe(true);
  });

  test("verdict agrees with the final session phase recorded in the last step", () => {
    const settled = rehearseAtomicSwap(baseOpts());
    const refundA = rehearseAtomicSwap(baseOpts({ scenario: "responder-absent" }));
    const refundB = rehearseAtomicSwap(baseOpts({ scenario: "initiator-absent" }));
    expect(settled.steps[settled.steps.length - 1].phase).toBe("settled");
    expect(refundA.steps[refundA.steps.length - 1].phase).toBe("legA-refunded");
    expect(refundB.steps[refundB.steps.length - 1].phase).toBe("legB-refunded");
  });
});

describe("report vocabulary", () => {
  test("scenarios are exhaustive and typed", () => {
    const scenarios: RehearsalScenario[] = ["happy-path", "responder-absent", "initiator-absent"];
    for (const scenario of scenarios) {
      const r = rehearseAtomicSwap(baseOpts({ scenario }));
      expect(r.scenario).toBe(scenario);
      expect(verifyRehearsalReport(r).ok).toBe(true);
    }
  });

  test("report hash is sha256 of canonicalJson(report minus hash) — recompute independently", () => {
    const report = rehearseAtomicSwap(baseOpts());
    const core = JSON.parse(JSON.stringify(report));
    delete core.hash;
    const expected = bytesToHex(sha256Bytes(Buffer.from(canonicalJson(core), "utf8")));
    expect(report.hash).toBe(expected);
  });

  test("default swapId carries the rehearsal vocabulary and the lock ops use the witness json id", () => {
    const report = rehearseAtomicSwap(baseOpts());
    expect(report.swapId.startsWith(REHEARSAL_ID_PREFIX.replace(":", "-"))).toBe(true);
    expect(report.swapId).toMatch(/^rehearsal-/);
    for (const step of report.steps) {
      if (step.step === "initiate-legA" || step.step === "respond-legB") {
        expect(step.wire.jsonId).toBe(HTLC_WITNESS_JSON_ID);
        expect(step.wire.authority).toBe("posting");
      }
    }
  });
});
