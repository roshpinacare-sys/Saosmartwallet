/**
 * Saosmartwallet packages/fixedfloat — TDD suite 1/4: request-signature construction
 * ====================================================================================
 * Red-first, fully deterministic (zero network, zero randomness, zero secrets —
 * every fixture below is a documented DUMMY; the real FixedFloat credentials live
 * only in the 0600 custody vault and never enter this suite).
 *
 * Spec source (pinned, honest provenance): the OFFICIAL FixedFloat API v2 docs,
 * https://fixedfloat.com/api — fetched and archived by wave G76-b:
 *   • Every request is POST to https://ff.io/api/v2/<method> with a UTF-8 JSON body.
 *   • Mandatory headers: Content-Type "application/json; charset=UTF-8",
 *     X-API-KEY (the API key), X-API-SIGN = HMAC-SHA256(apiSecret, exactBodyString)
 *     in lowercase hex (openssl dgst -sha256 -hmac convention).
 *   • With no parameters the signature is HMAC over the empty string.
 *   • Response envelope {code, msg, data}; code === 0 ⇒ success.
 *
 * Laws pinned here:
 *   • SIGN-EXACTNESS: the HMAC is computed over the EXACT string that is sent —
 *     the client canonicalizes once (sorted keys, no whitespace) and signs that
 *     same string (pinned again in client.test.ts via string-identity capture).
 *   • VECTORS: expected digests were computed independently with node:crypto
 *     against the dummy secret "ff-test-secret" and are pinned literally — a
 *     regression in the signing path fails these before any network call exists.
 *   • LOWERCASE HEX: signatures are 64 lowercase hex chars, always.
 *   • NO-SECRET-LEAK: headers/signature helpers never echo the secret.
 */

import { describe, expect, test } from "bun:test";

import {
  EMPTY_PAYLOAD,
  buildApiHeaders,
  buildApiSignature,
  canonicalPayloadString,
} from "../src/sign";

const DUMMY_SECRET = "ff-test-secret";

// Pinned HMAC-SHA256 vectors for the dummy secret (computed independently).
const VECTOR_EMPTY = "518c264fcc9a378efdcc5dd013a337272a151b4826b5c90725884c77336d3083";
const VECTOR_EMPTY_OBJECT = "49af7d0f07adbc545a3c457c42731ace61242bd4ebe3ee4ca51ed4eaff8337a9";
const VECTOR_ORDER = "87f0ce99fbaafa95d81b42a6673b26f041a8504987376234ad6b198486005386";

const HEX64_LOWER = /^[0-9a-f]{64}$/;

describe("canonicalPayloadString — deterministic JSON canonicalization", () => {
  test("sorts object keys and strips whitespace", () => {
    expect(canonicalPayloadString({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  test("same object, different insertion order ⇒ identical canonical string", () => {
    const a = canonicalPayloadString({ token: "tok", id: "8PQWPY" });
    const b = canonicalPayloadString({ id: "8PQWPY", token: "tok" });
    expect(a).toBe(b);
    expect(a).toBe('{"id":"8PQWPY","token":"tok"}');
  });

  test("nested objects sort recursively; arrays preserve order", () => {
    const s = canonicalPayloadString({ z: { c: 3, a: 1, b: 2 }, list: [3, 1, 2] });
    expect(s).toBe('{"list":[3,1,2],"z":{"a":1,"b":2,"c":3}}');
  });

  test("string escaping matches JSON semantics exactly", () => {
    expect(canonicalPayloadString({ k: 'a"b\\c' })).toBe('{"k":"a\\"b\\\\c"}');
  });

  test("numbers keep their JSON form (no locale drift)", () => {
    expect(canonicalPayloadString({ amount: 0.5 })).toBe('{"amount":0.5}');
  });
});

describe("buildApiSignature — HMAC-SHA256(apiSecret, exactBodyString), official v2 spec", () => {
  test("empty string payload (no parameters) matches the pinned vector", () => {
    expect(buildApiSignature(DUMMY_SECRET, EMPTY_PAYLOAD)).toBe(VECTOR_EMPTY);
  });

  test("empty JSON object payload matches the pinned vector", () => {
    expect(buildApiSignature(DUMMY_SECRET, "{}")).toBe(VECTOR_EMPTY_OBJECT);
  });

  test("order-info payload matches the pinned vector", () => {
    expect(buildApiSignature(DUMMY_SECRET, '{"id":"8PQWPY","token":"tok"}')).toBe(VECTOR_ORDER);
  });

  test("create-order payload matches the pinned vector (canonical sorted-key form)", () => {
    const body = canonicalPayloadString({
      type: "fixed",
      fromCcy: "BTC",
      toCcy: "ETH",
      direction: "from",
      amount: 0.5,
      toAddress: "bc1qtest",
    });
    // Canonical form sorts keys lexicographically — the signed string is the sent string.
    expect(body).toBe('{"amount":0.5,"direction":"from","fromCcy":"BTC","toAddress":"bc1qtest","toCcy":"ETH","type":"fixed"}');
    expect(buildApiSignature(DUMMY_SECRET, body)).toBe("f9aca48555759e51809368f5d1979767f17b26222a7f9cb18ec474b3f0aacfe5");
  });

  test("signature is always 64 lowercase hex chars", () => {
    for (const payload of [EMPTY_PAYLOAD, "{}", '{"a":1}']) {
      const sign = buildApiSignature(DUMMY_SECRET, payload);
      expect(sign).toMatch(HEX64_LOWER);
      expect(sign).toBe(sign.toLowerCase());
    }
  });

  test("different secret ⇒ different signature (and still deterministic)", () => {
    const s1 = buildApiSignature(DUMMY_SECRET, '{"a":1}');
    const s2 = buildApiSignature("another-secret", '{"a":1}');
    expect(s1).not.toBe(s2);
    expect(buildApiSignature(DUMMY_SECRET, '{"a":1}')).toBe(s1);
  });

  test("refuses non-string inputs (fail-closed typing)", () => {
    // @ts-expect-error deliberate wrong-type probe
    expect(() => buildApiSignature(DUMMY_SECRET, 42)).toThrow();
    // @ts-expect-error deliberate wrong-type probe
    expect(() => buildApiSignature(undefined, "")).toThrow();
  });
});

describe("buildApiHeaders — mandatory official v2 request headers", () => {
  test("emits exactly the documented header set", () => {
    const headers = buildApiHeaders("DUMMY-KEY", VECTOR_EMPTY);
    expect(headers["Content-Type"]).toBe("application/json; charset=UTF-8");
    expect(headers["X-API-KEY"]).toBe("DUMMY-KEY");
    expect(headers["X-API-SIGN"]).toBe(VECTOR_EMPTY);
    expect(Object.keys(headers).sort()).toEqual(["Content-Type", "X-API-KEY", "X-API-SIGN"]);
  });

  test("never contains the API secret anywhere in the header object", () => {
    const headers = buildApiHeaders("DUMMY-KEY", buildApiSignature(DUMMY_SECRET, '{"a":1}'));
    const flat = JSON.stringify(headers);
    expect(flat.includes(DUMMY_SECRET)).toBe(false);
  });
});
