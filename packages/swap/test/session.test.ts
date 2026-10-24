/**
 * Saosmartwallet packages/swap — two-party swap session TDD suite (agent-9)
 * =========================================================================
 * Red-first suite for the cross-chain swap session coordinator that composes
 * the HTLC core into the atomic-swap pattern:
 *
 *   initiator locks legA (T1) ──► responder locks legB (T2, T2 < T1)
 *   initiator claims legB by REVEALING the preimage ──►
 *   responder counter-claims legA with the now-public preimage
 *
 * Laws pinned here:
 *   • SAFETY LAW (fail-closed): T1 > T2 — the initiator's lock must outlive
 *     the responder's; a session where the responder's leg dies first from
 *     the initiator's perspective refuses to exist.
 *   • COUNTERPARTY BINDING: legB.initiator === legA.responder and
 *     legB.responder === legA.initiator — the two legs mirror exactly.
 *   • ONE HASHLOCK: both legs share sha256(preimage); a session cannot hold
 *     divergent bindings.
 *   • SEQUENCING: respond requires initiate; claim B requires legB; the
 *     counter-claim of A is fail-closed on a PUBLIC REVEAL (the responder may
 *     only act on the preimage after it entered the session's observed
 *     history), plus every core law (preimage match, expiry, party).
 *   • DETERMINISM: with a fixed preimage and fixed timestamps, the entire
 *     receipt chain hashes identically on replay.
 *   • Honest failure paths: refund-after-expiry per leg, refund-before-expiry
 *     refusal, late-claim refusal — the swap never loses funds in the model.
 */

import { describe, expect, test } from "bun:test";

import {
  createSwapSession,
  sessionInitiateLegA,
  sessionRespondLegB,
  sessionClaimLegB,
  sessionCounterClaimLegA,
  sessionRefundLeg,
  sessionPhase,
  verifySessionReceipts,
} from "../src/session";

const enc = new TextEncoder();
const T0 = 1_700_000_000;
const PREIMAGE = enc.encode("atomic-swap-preimage-0001"); // 26 bytes, ≥ 16

function legSpecs() {
  return {
    legA: { chain: "steem", asset: "STEEM", amount: "10.000 STEEM", initiator: "initiator.acct", responder: "responder.acct", timeoutSeconds: 7200 },
    legB: { chain: "blurt", asset: "BLURT", amount: "500.000 BLURT", initiator: "responder.acct", responder: "initiator.acct", timeoutSeconds: 3600 },
  };
}

function freshSession() {
  return createSwapSession({ swapId: "swap-0001", ...legSpecs(), preimage: PREIMAGE });
}

describe("createSwapSession — construction laws", () => {
  test("derives the shared hashlock from the preimage and starts in draft", () => {
    const { view, hashlock } = freshSession();
    expect(hashlock.length).toBe(32);
    expect(Array.from(view.hashlock)).toEqual(Array.from(hashlock));
    expect(sessionPhase(view)).toBe("draft");
    expect(view.legA.record).toBeNull();
    expect(view.legB.record).toBeNull();
    expect(view.receipts.length).toBe(0);
  });

  test("generates a random preimage when none is given (hashlock still binds)", () => {
    const a = createSwapSession({ swapId: "s-a", ...legSpecs() });
    const b = createSwapSession({ swapId: "s-b", ...legSpecs() });
    expect(a.preimage.length).toBe(32);
    expect(Array.from(a.hashlock)).not.toEqual(Array.from(b.hashlock));
  });

  test("refuses T1 <= T2 (the initiator leg must strictly outlive the responder leg)", () => {
    const bad = legSpecs();
    bad.legB.timeoutSeconds = 7200; // equal
    expect(() => createSwapSession({ swapId: "s", ...bad, preimage: PREIMAGE })).toThrow();
    const worse = legSpecs();
    worse.legB.timeoutSeconds = 9000; // inverted
    expect(() => createSwapSession({ swapId: "s", ...worse, preimage: PREIMAGE })).toThrow();
  });

  test("refuses broken counterparty binding (legs must mirror)", () => {
    const bad = legSpecs();
    bad.legB.initiator = "stranger.acct";
    expect(() => createSwapSession({ swapId: "s", ...bad, preimage: PREIMAGE })).toThrow();
    const bad2 = legSpecs();
    bad2.legB.responder = "stranger.acct";
    expect(() => createSwapSession({ swapId: "s", ...bad2, preimage: PREIMAGE })).toThrow();
  });

  test("refuses empty swap id and sub-minimum preimages", () => {
    expect(() => createSwapSession({ swapId: "", ...legSpecs(), preimage: PREIMAGE })).toThrow();
    expect(() => createSwapSession({ swapId: "s", ...legSpecs(), preimage: enc.encode("tiny") })).toThrow();
  });
});

describe("the happy path — commit, respond, reveal, counter-claim", () => {
  test("full atomic settlement with a verifying receipt chain", () => {
    const { view } = freshSession();
    let v = view;
    v = sessionInitiateLegA(v, { now: T0, txid: "legA-tx-1" });
    expect(sessionPhase(v)).toBe("legA-committed");
    expect(v.legA.record?.terms.issuer).toBe("initiator.acct");
    expect(v.legA.record?.terms.beneficiary).toBe("responder.acct");
    expect(v.legA.committedTxid).toBe("legA-tx-1");

    v = sessionRespondLegB(v, { now: T0 + 30, txid: "legB-tx-1" });
    expect(sessionPhase(v)).toBe("legB-committed");
    expect(v.legB.record?.terms.issuer).toBe("responder.acct");
    expect(v.legB.record?.terms.beneficiary).toBe("initiator.acct");
    // ONE HASHLOCK across legs
    expect(Array.from(v.legB.record!.terms.hashlock)).toEqual(Array.from(v.legA.record!.terms.hashlock));
    // T2 < T1 honoured at the record level
    expect(v.legB.record!.expiresAt).toBeLessThan(v.legA.record!.expiresAt);

    v = sessionClaimLegB(v, { now: T0 + 300, preimage: PREIMAGE });
    expect(sessionPhase(v)).toBe("legB-claimed");
    expect(v.preimageRevealed).toBe(true);

    v = sessionCounterClaimLegA(v, { now: T0 + 330, preimage: PREIMAGE });
    expect(sessionPhase(v)).toBe("settled");
    expect(v.legA.record!.status).toBe("claimed");
    expect(v.legB.record!.status).toBe("claimed");

    expect(verifySessionReceipts(v).ok).toBe(true);
    expect(v.receipts.length).toBe(4); // createA, createB, claimB, claimA
  });

  test("determinism: replay with fixed inputs hashes the chain identically", () => {
    const run = () => {
      const { view } = freshSession();
      let v = view;
      v = sessionInitiateLegA(v, { now: T0, txid: "legA-tx-1" });
      v = sessionRespondLegB(v, { now: T0 + 30, txid: "legB-tx-1" });
      v = sessionClaimLegB(v, { now: T0 + 300, preimage: PREIMAGE });
      v = sessionCounterClaimLegA(v, { now: T0 + 330, preimage: PREIMAGE });
      return v.receipts.map((r) => r.hash);
    };
    expect(run()).toEqual(run());
  });
});

describe("sequencing and adversarial matrix", () => {
  test("respond before initiate refuses", () => {
    const { view } = freshSession();
    expect(() => sessionRespondLegB(view, { now: T0, txid: "x" })).toThrow();
  });

  test("double-initiate refuses", () => {
    const { view } = freshSession();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    expect(() => sessionInitiateLegA(v, { now: T0 + 1, txid: "tx-a2" })).toThrow();
  });

  test("claim B before legB exists refuses", () => {
    const { view } = freshSession();
    expect(() => sessionClaimLegB(view, { now: T0, preimage: PREIMAGE })).toThrow();
  });

  test("claim B with a wrong preimage refuses and stays committed", () => {
    const { view } = freshSession();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    v = sessionRespondLegB(v, { now: T0 + 30, txid: "tx-b" });
    expect(() => sessionClaimLegB(v, { now: T0 + 300, preimage: enc.encode("wrong-preimage-000000") })).toThrow();
    expect(sessionPhase(v)).toBe("legB-committed");
    expect(v.preimageRevealed).toBe(false);
  });

  test("the counter-claim of A is fail-closed on a PUBLIC REVEAL — even a true preimage before reveal refuses", () => {
    const { view } = freshSession();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    v = sessionRespondLegB(v, { now: T0 + 30, txid: "tx-b" });
    expect(() => sessionCounterClaimLegA(v, { now: T0 + 300, preimage: PREIMAGE })).toThrow();
    expect(sessionPhase(v)).toBe("legB-committed");
  });

  test("claim B at expiry refuses (refund window exclusive)", () => {
    const { view } = freshSession();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    v = sessionRespondLegB(v, { now: T0 + 30, txid: "tx-b" });
    const expiresB = v.legB.record!.expiresAt;
    expect(() => sessionClaimLegB(v, { now: expiresB, preimage: PREIMAGE })).toThrow();
  });

  test("refund of B before its expiry refuses; at expiry by its issuer settles honestly", () => {
    const { view } = freshSession();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    v = sessionRespondLegB(v, { now: T0 + 30, txid: "tx-b" });
    const expiresB = v.legB.record!.expiresAt;
    expect(() => sessionRefundLeg(v, { leg: "B", now: expiresB - 1 })).toThrow();
    v = sessionRefundLeg(v, { leg: "B", now: expiresB });
    expect(sessionPhase(v)).toBe("legB-refunded");
    expect(v.legB.record!.status).toBe("refunded");
    expect(v.legA.record!.status).toBe("active");
  });

  test("the initiator who never claims recovers legA at T1 (funds are never lost)", () => {
    const { view } = freshSession();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    v = sessionRespondLegB(v, { now: T0 + 30, txid: "tx-b" });
    const expiresB = v.legB.record!.expiresAt;
    v = sessionRefundLeg(v, { leg: "B", now: expiresB });
    const expiresA = v.legA.record!.expiresAt;
    expect(() => sessionRefundLeg(v, { leg: "A", now: expiresA - 1 })).toThrow();
    v = sessionRefundLeg(v, { leg: "A", now: expiresA });
    expect(sessionPhase(v)).toBe("legA-refunded");
    expect(verifySessionReceipts(v).ok).toBe(true);
  });

  test("counter-claim of A after its expiry refuses even after a reveal", () => {
    const { view } = freshSession();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    v = sessionRespondLegB(v, { now: T0 + 30, txid: "tx-b" });
    const expiresA = v.legA.record!.expiresAt;
    v = sessionClaimLegB(v, { now: T0 + 300, preimage: PREIMAGE }); // reveal long before T1
    expect(() => sessionCounterClaimLegA(v, { now: expiresA, preimage: PREIMAGE })).toThrow();
  });

  test("empty txids refuse at the commit gates", () => {
    const { view } = freshSession();
    expect(() => sessionInitiateLegA(view, { now: T0, txid: "" })).toThrow();
    let v = sessionInitiateLegA(view, { now: T0, txid: "tx-a" });
    expect(() => sessionRespondLegB(v, { now: T0 + 30, txid: "" })).toThrow();
  });
});
