/**
 * Saosmartwallet packages/swap — HTLC core TDD suite (agent-9, wallet-htlc-swap-engine)
 * =====================================================================================
 * Red-first suite for the pure chain-agnostic hash-time-lock state machine.
 *
 * Laws pinned here (implementation must make every line green WITHOUT weakening
 * any assertion):
 *   • sha256 KAT — RFC 6234 / FIPS 180 vector for ASCII "abc", expressed as a
 *     BYTE-ARRAY literal (public constant, no hex-string entropy in the tree).
 *   • Fail-closed construction: bad id, bad hashlock length, empty/identical
 *     parties, non-positive duration, u32-overflow expiry all refuse.
 *   • Claim law: beneficiary-only, preimage-mismatch refused, claim at/after
 *     expiry refused (the refund window is exclusive), double-claim refused,
 *     records are IMMUTABLE (claim/refund return new records).
 *   • Refund law: issuer-only, refund BEFORE expiry refused, refund at/after
 *     expiry accepted.
 *   • Receipt chain: sha256-linked (prev → hash), deterministic (same op
 *     sequence ⇒ identical hashes), tamper-evident (verifyReceiptChain reports
 *     the broken index).
 *   • Zero wall-clock: every function takes `now` (unix seconds).
 */

import { describe, expect, test } from "bun:test";

import {
  createHtlc,
  claimHtlc,
  refundHtlc,
  htlcStateAt,
  appendLedgerEvent,
  verifyReceiptChain,
  sha256Bytes,
  HTLC_PREIMAGE_MIN,
  HTLC_PREIMAGE_MAX,
  HTLC_GENESIS_PREV_HASH,
  type HtlcReceipt,
} from "../src/htlc";

const enc = new TextEncoder();

/** sha256("abc") — RFC 6234 test vector, byte-array form (public constant). */
const SHA256_ABC_KAT: number[] = [
  0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae, 0x22, 0x23,
  0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61, 0xf2, 0x00, 0x15, 0xad,
];

const NOW = 1_700_000_000;
const DURATION = 3_600;
/** A valid preimage (≥ 16 bytes per the length law) — every claim fixture reveals this. */
const PREIMG = "preimage-abc-000000001";
const PREIMG_BYTES = new TextEncoder().encode(PREIMG);

function termsFixture() {
  return {
    id: "swap-0001:legA",
    hashlock: sha256Bytes(PREIMG_BYTES), // the binding of the fixture preimage
    issuer: "initiator.acct",
    beneficiary: "responder.acct",
    amount: "10.000 STEEM",
  };
}

describe("sha256 binding primitive", () => {
  test("matches the RFC 6234 vector for ASCII abc", () => {
    const digest = sha256Bytes(enc.encode("abc"));
    expect(Array.from(digest)).toEqual(SHA256_ABC_KAT);
  });
});

describe("createHtlc — fail-closed construction", () => {
  test("creates an active record with exact expiry and a create receipt", () => {
    const { record, event } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    expect(record.status).toBe("active");
    expect(record.expiresAt).toBe(NOW + DURATION);
    expect(record.terms.id).toBe("swap-0001:legA");
    expect(event.kind).toBe("create");
    expect(event.htlcId).toBe("swap-0001:legA");
    expect(event.at).toBe(NOW);
  });

  test("refuses empty id and ids over 64 chars", () => {
    expect(() => createHtlc({ ...termsFixture(), id: "" }, { now: NOW, durationSeconds: DURATION })).toThrow();
    expect(() => createHtlc({ ...termsFixture(), id: "x".repeat(65) }, { now: NOW, durationSeconds: DURATION })).toThrow();
  });

  test("refuses hashlock that is not exactly 32 bytes", () => {
    for (const len of [0, 1, 31, 33, 64]) {
      expect(() =>
        createHtlc({ ...termsFixture(), hashlock: new Uint8Array(len) }, { now: NOW, durationSeconds: DURATION }),
      ).toThrow();
    }
  });

  test("refuses empty parties and identical parties", () => {
    expect(() => createHtlc({ ...termsFixture(), issuer: "" }, { now: NOW, durationSeconds: DURATION })).toThrow();
    expect(() => createHtlc({ ...termsFixture(), beneficiary: "" }, { now: NOW, durationSeconds: DURATION })).toThrow();
    expect(() =>
      createHtlc({ ...termsFixture(), issuer: "same.acct", beneficiary: "same.acct" }, { now: NOW, durationSeconds: DURATION }),
    ).toThrow();
  });

  test("refuses empty amount and non-positive duration", () => {
    expect(() => createHtlc({ ...termsFixture(), amount: "" }, { now: NOW, durationSeconds: DURATION })).toThrow();
    expect(() => createHtlc(termsFixture(), { now: NOW, durationSeconds: 0 })).toThrow();
    expect(() => createHtlc(termsFixture(), { now: NOW, durationSeconds: -5 })).toThrow();
  });

  test("refuses expiries that overflow the graphene u32 unix-seconds field", () => {
    expect(() => createHtlc(termsFixture(), { now: 0xfffffffe, durationSeconds: 10 })).toThrow();
  });
});

describe("claimHtlc — the preimage law", () => {
  test("beneficiary claims with the true preimage before expiry; record immutability holds", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    const preimage = PREIMG_BYTES;
    const { record: claimed, event } = claimHtlc(record, { now: NOW + 60, party: "responder.acct", preimage });
    expect(claimed.status).toBe("claimed");
    expect(claimed.claimedBy).toBe("responder.acct");
    expect(claimed.claimedAt).toBe(NOW + 60);
    expect(event.kind).toBe("claim");
    // the original record is untouched (immutability law)
    expect(record.status).toBe("active");
  });

  test("refuses a claim by anyone but the beneficiary", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    expect(() => claimHtlc(record, { now: NOW + 60, party: "initiator.acct", preimage: PREIMG_BYTES })).toThrow();
    expect(() => claimHtlc(record, { now: NOW + 60, party: "stranger.acct", preimage: PREIMG_BYTES })).toThrow();
  });

  test("refuses a wrong preimage and leaves the record active", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    expect(() => claimHtlc(record, { now: NOW + 60, party: "responder.acct", preimage: enc.encode("preimage-xyz-000000001") })).toThrow();
    expect(record.status).toBe("active");
  });

  test("refuses claims at and after expiry (the refund window is exclusive)", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    const atExpiry = claimHtlc.bind(null, record, { now: NOW + DURATION, party: "responder.acct", preimage: PREIMG_BYTES });
    expect(atExpiry).toThrow();
    const afterExpiry = claimHtlc.bind(null, record, { now: NOW + DURATION + 1, party: "responder.acct", preimage: PREIMG_BYTES });
    expect(afterExpiry).toThrow();
  });

  test("refuses a second claim after a first successful one", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    const { record: claimed } = claimHtlc(record, { now: NOW + 60, party: "responder.acct", preimage: PREIMG_BYTES });
    expect(() => claimHtlc(claimed, { now: NOW + 61, party: "responder.acct", preimage: PREIMG_BYTES })).toThrow();
  });

  test("enforces the preimage length law (16..1024 bytes)", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    expect(HTLC_PREIMAGE_MIN).toBe(16);
    expect(HTLC_PREIMAGE_MAX).toBe(1024);
    expect(() => claimHtlc(record, { now: NOW + 60, party: "responder.acct", preimage: enc.encode("short") })).toThrow();
    const long = new Uint8Array(HTLC_PREIMAGE_MAX + 1).fill(0x61);
    expect(() => claimHtlc(record, { now: NOW + 60, party: "responder.acct", preimage: long })).toThrow();
  });
});

describe("refundHtlc — the expiry law", () => {
  test("issuer refunds at exactly the expiry second", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    const { record: refunded, event } = refundHtlc(record, { now: NOW + DURATION, party: "initiator.acct" });
    expect(refunded.status).toBe("refunded");
    expect(refunded.refundedAt).toBe(NOW + DURATION);
    expect(event.kind).toBe("refund");
    expect(record.status).toBe("active"); // immutability
  });

  test("refuses an early refund (one second before expiry)", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    expect(() => refundHtlc(record, { now: NOW + DURATION - 1, party: "initiator.acct" })).toThrow();
  });

  test("refuses refunds by anyone but the issuer", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    expect(() => refundHtlc(record, { now: NOW + DURATION, party: "responder.acct" })).toThrow();
  });

  test("refunds and claims are mutually terminal", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    const { record: refunded } = refundHtlc(record, { now: NOW + DURATION, party: "initiator.acct" });
    expect(() => claimHtlc(refunded, { now: NOW + DURATION + 10, party: "responder.acct", preimage: PREIMG_BYTES })).toThrow();
    expect(() => refundHtlc(refunded, { now: NOW + DURATION + 10, party: "initiator.acct" })).toThrow();
  });
});

describe("htlcStateAt — honest derived view", () => {
  test("reports expired exactly at the boundary without mutating", () => {
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    expect(htlcStateAt(record, NOW + DURATION - 1).expired).toBe(false);
    expect(htlcStateAt(record, NOW + DURATION).expired).toBe(true);
    expect(record.status).toBe("active");
  });
});

describe("receipt chain — hash-linked and tamper-evident", () => {
  test("chains create/claim events with seq and prevHash; verify passes", () => {
    const chain: HtlcReceipt[] = [];
    const a = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    appendLedgerEvent(chain, a.event);
    const { record } = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    const claim = claimHtlc(record, { now: NOW + 60, party: "responder.acct", preimage: PREIMG_BYTES });
    appendLedgerEvent(chain, claim.event);
    expect(chain.length).toBe(2);
    expect(chain[0].seq).toBe(0);
    expect(chain[0].prevHash).toBe(HTLC_GENESIS_PREV_HASH);
    expect(chain[1].seq).toBe(1);
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(verifyReceiptChain(chain).ok).toBe(true);
  });

  test("determinism: the same op sequence yields identical hashes", () => {
    const build = (): HtlcReceipt[] => {
      const chain: HtlcReceipt[] = [];
      const a = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
      appendLedgerEvent(chain, a.event);
      const b = createHtlc({ ...termsFixture(), id: "swap-0001:legB" }, { now: NOW, durationSeconds: 1800 });
      appendLedgerEvent(chain, b.event);
      return chain;
    };
    const one = build();
    const two = build();
    expect(one.map((r) => r.hash)).toEqual(two.map((r) => r.hash));
  });

  test("tampering one event breaks verification at its index", () => {
    const chain: HtlcReceipt[] = [];
    const a = createHtlc(termsFixture(), { now: NOW, durationSeconds: DURATION });
    appendLedgerEvent(chain, a.event);
    const b = createHtlc({ ...termsFixture(), id: "swap-0001:legB" }, { now: NOW, durationSeconds: 1800 });
    appendLedgerEvent(chain, b.event);
    const forged = chain.map((r, i) => (i === 1 ? { ...r, detail: { ...r.detail, tampered: "yes" } } : r));
    const verdict = verifyReceiptChain(forged);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAt).toBe(1);
  });

  test("an empty chain verifies trivially", () => {
    expect(verifyReceiptChain([]).ok).toBe(true);
  });
});
