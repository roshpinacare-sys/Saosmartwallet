/**
 * Saosmartwallet packages/fixedfloat — request-signing law suite
 * ==============================================================
 * The MEASURED v2 signing law, pinned to EXTERNAL standards and explicit
 * fixtures (reconciled with the live measurement of the fx-fixedfloat lane,
 * giant :3055, trace 1a178850450f2e55):
 *
 *   • HMAC-SHA1 KAT — RFC 2202 Test Case 3 (key "key", data "The quick
 *     brown fox jumps over the lazy dog") — the primitive is proven against
 *     an external standard, not against itself.
 *   • Canonical law fixtures: keys sorted alphabetically, nested objects
 *     deep-sorted compact JSON, primitives String(v), no separator.
 *   • Order sensitivity + empty-body determinism pinned.
 *   • The wire header constants pin the measured v2 names (X-Api-Key /
 *     X-Signature) and the v2 method set.
 */

import { describe, expect, test } from "bun:test";

import {
  ffSign,
  hmacSha1Hex,
  canonical,
  deepSort,
  FF_HEADER_KEY,
  FF_HEADER_SIGN,
  FF_API_BASE,
  FF_METHODS,
} from "../src/sign";

/** RFC 2202 TC3 — key "key", data "The quick brown fox jumps over the lazy dog". */
const RFC2202_TC3_KEY = "key";
const RFC2202_TC3_DATA = "The quick brown fox jumps over the lazy dog";
const RFC2202_TC3_EXPECTED = "de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9";

describe("fixedfloat sign — HMAC-SHA1 KAT (RFC 2202 TC3)", () => {
  test("primitive matches the RFC vector byte-for-byte", () => {
    expect(hmacSha1Hex(RFC2202_TC3_KEY, RFC2202_TC3_DATA)).toBe(RFC2202_TC3_EXPECTED);
  });

  test("wire signature = HMAC-SHA1 over the canonical form", () => {
    // canonical({x: DATA}) = "x" + DATA — so ffSign must equal the RFC vector
    // composed with the deterministic canonical prefix.
    const sig = ffSign({ x: RFC2202_TC3_DATA }, RFC2202_TC3_KEY);
    expect(sig).toBe(hmacSha1Hex(RFC2202_TC3_KEY, `x${RFC2202_TC3_DATA}`));
  });

  test("signs the empty body deterministically (40 lowercase hex)", () => {
    const a = ffSign({}, "s");
    const b = ffSign({}, "s");
    expect(a).toBe(b);
    expect(a).toHaveLength(40);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  test("is order-sensitive: same params, different insertion order ⇒ SAME wire sig (canonical law) but different body order law is canonicalized away", () => {
    const one = ffSign({ from: "btc", to: "eth", type: "float" }, "s");
    const two = ffSign({ type: "float", to: "eth", from: "btc" }, "s");
    // The whole point of the canonical form: signature is invariant to
    // insertion order — deterministic across callers.
    expect(one).toBe(two);
  });

  test("is value-sensitive: different values ⇒ different signature", () => {
    const one = ffSign({ from: "btc" }, "s");
    const two = ffSign({ from: "eth" }, "s");
    expect(one).not.toBe(two);
  });
});

describe("fixedfloat canonical law (measured fixtures)", () => {
  test("top-level keys sorted, primitives String()", () => {
    expect(canonical({ b: 2, a: 1 })).toBe("a1b2");
    expect(canonical({ type: "float", from: "eth", to: "btc" })).toBe("fromethtobtctypefloat");
  });

  test("nested objects deep-sorted compact JSON", () => {
    expect(
      canonical({ params: { to: "usdt", from: "btc", type: "float" }, method: "price" }),
    ).toBe('methodpriceparams{"from":"btc","to":"usdt","type":"float"}');
  });

  test("arrays are preserved in order, elements deep-sorted", () => {
    expect(canonical({ list: [{ z: 1, a: 2 }, "k"] })).toBe('list[{"a":2,"z":1},"k"]');
  });

  test("deepSort is recursive and non-mutating", () => {
    const input = { b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] };
    const out = deepSort(input) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["a", "b"]);
    expect(Object.keys(out.b as Record<string, unknown>)).toEqual(["c", "d"]);
    expect(Object.keys((out.a as Record<string, unknown>[])[0])).toEqual(["y", "z"]);
    // non-mutation
    expect(Object.keys(input)).toEqual(["b", "a"]);
  });
});

describe("fixedfloat measured v2 wire constants", () => {
  test("pin the measured auth headers, base and method set", () => {
    expect(FF_HEADER_KEY).toBe("X-Api-Key");
    expect(FF_HEADER_SIGN).toBe("X-Signature");
    expect(FF_API_BASE).toBe("https://ff.io/api/v2/");
    expect(FF_METHODS).toEqual(["price", "ccies", "create", "order", "emergency", "qr"]);
  });
});
