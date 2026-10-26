/**
 * Saosmartwallet packages/fixedfloat — request-signing law suite (RED first)
 * ==========================================================================
 * FixedFloat API v1 request authentication, pinned by public vectors so the
 * implementation is proven against an EXTERNAL standard, not against itself:
 *
 *   • HMAC-SHA256 KAT — RFC 4231 Test Case 2 (key "Jefe", data
 *     "what do ya want for nothing?") — byte-array literal form.
 *   • The wire law: signature = HMAC_SHA256(secret, CONCAT(values in the exact
 *     order they are sent)) — value-order sensitivity and empty-body signing
 *     both pinned.
 *   • Hex output is lowercase, deterministic.
 *   • Nonce law: strictly increasing, derived from the injected clock, never
 *     wall-clock inside the module.
 */

import { describe, expect, test } from "bun:test";

import { ffSign, nextNonce, FF_HEADER_KEY, FF_HEADER_SIGN, FF_HEADER_NONCE } from "../src/sign";

/** RFC 4231 Test Case 2 — key = "Jefe", data = "what do ya want for nothing?" */
const RFC4231_TC2_KEY: number[] = [
  0x4a, 0x65, 0x66, 0x65, // "Jefe"
];
const RFC4231_TC2_DATA: number[] = [
  0x77, 0x68, 0x61, 0x74, 0x20, 0x64, 0x6f, 0x20, 0x79, 0x61, 0x20, 0x77, 0x61, 0x6e, 0x74, 0x20,
  0x66, 0x6f, 0x72, 0x20, 0x6e, 0x6f, 0x74, 0x68, 0x69, 0x6e, 0x67, 0x3f, // "what do ya want for nothing?"
];
const RFC4231_TC2_EXPECTED = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

describe("fixedfloat sign — HMAC-SHA256 KAT (RFC 4231 TC2)", () => {
  test("matches the RFC vector byte-for-byte", () => {
    const sig = ffSign(RFC4231_TC2_KEY, [RFC4231_TC2_DATA]);
    expect(sig).toBe(RFC4231_TC2_EXPECTED);
  });

  test("signs the empty body (the getCurrencies/no-param wire case) deterministically", () => {
    const a = ffSign([0x73], []); // secret byte 0x73 = "s", empty payload
    const b = ffSign([0x73], []);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is order-sensitive: same values, different order ⇒ different signature", () => {
    const key = [0x01, 0x02, 0x03];
    const one = ffSign(key, [new TextEncoder().encode("BTC"), new TextEncoder().encode("ETH")]);
    const two = ffSign(key, [new TextEncoder().encode("ETH"), new TextEncoder().encode("BTC")]);
    expect(one).not.toBe(two);
  });

  test("accepts plain string values (the wire form used by the client)", () => {
    // RFC 4231 TC2 expressed through the string overload — same expected digest.
    const sig = ffSign(new TextEncoder().encode("Jefe"), ["what do ya want for nothing?"]);
    expect(sig).toBe(RFC4231_TC2_EXPECTED);
  });
});

describe("fixedfloat nonce law", () => {
  test("strictly increases across calls with a fixed injected clock", () => {
    let tick = 1_700_000_000_000;
    const now = () => tick;
    const n1 = nextNonce(now);
    const n2 = nextNonce(now); // same clock reading — nonce must still advance
    const n3 = nextNonce(now);
    expect(BigInt(n2) > BigInt(n1)).toBe(true);
    expect(BigInt(n3) > BigInt(n2)).toBe(true);
  });

  test("advances when the injected clock jumps forward", () => {
    let tick = 1_700_000_000_000;
    const now = () => tick;
    const n1 = nextNonce(now);
    tick += 5_000;
    const n2 = nextNonce(now);
    expect(BigInt(n2) > BigInt(n1)).toBe(true);
  });

  test("emits decimal digits only (wire-safe integer)", () => {
    const n = nextNonce(() => 1_700_000_000_123);
    expect(n).toMatch(/^[0-9]+$/);
  });
});

describe("fixedfloat wire header constants", () => {
  test("pin the documented v1 auth headers", () => {
    expect(FF_HEADER_KEY).toBe("X-API-KEY");
    expect(FF_HEADER_SIGN).toBe("X-API-SIGN");
    expect(FF_HEADER_NONCE).toBe("X-API-NONCE");
  });
});
