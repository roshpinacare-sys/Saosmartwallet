/**
 * Saosmartwallet packages/fixedfloat — credential custody law suite (RED first)
 * =============================================================================
 * The owner's FixedFloat API keypair is LIVE PRODUCTION CUSTODY. The laws:
 *
 *   • Fail-closed construction: missing / empty / whitespace-only key or
 *     secret REFUSES (throws FixedFloatError kind "CONFIG") — there is no
 *     placeholder, no default credential, no degraded mode.
 *   • Custody env names: FIXEDFLOAT_API_KEY / FIXEDFLOAT_API_SECRET (primary),
 *     FIXEDFLOAT_KEY / FIXEDFLOAT_SECRET (fallback) — measured from the owner
 *     upload (fffixedflot.txt, 2026-10-25) into the runtime secret store.
 *   • Redaction: the config's printable form NEVER contains the key or the
 *     secret — not the full value, not a suffix — only a sha256 fingerprint.
 *   • Error messages are redacted by construction: if a secret ever leaks
 *     into a message, the redactor strips it before the error escapes.
 */

import { describe, expect, test } from "bun:test";

import { FixedFloatError, redact, loadFixedFloatConfig, type FixedFloatConfig } from "../src/config";

/** Test fixture only — NOT production custody; production keys live outside the tree. */
const TEST_KEY = "ff-test-key-0123456789abcdef";
const TEST_SECRET = "ff-test-secret-0123456789abcdef";

function envFixture(over: Record<string, string | undefined> = {}) {
  return {
    FIXEDFLOAT_API_KEY: TEST_KEY,
    FIXEDFLOAT_API_SECRET: TEST_SECRET,
    ...over,
  };
}

describe("fixedfloat config — fail-closed custody", () => {
  test("loads from the primary env names", () => {
    const cfg = loadFixedFloatConfig(envFixture());
    expect(cfg.apiKey).toBe(TEST_KEY);
    expect(cfg.apiSecret).toBe(TEST_SECRET);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  test("falls back to the secondary env names when primaries are absent", () => {
    const cfg = loadFixedFloatConfig({
      FIXEDFLOAT_KEY: TEST_KEY,
      FIXEDFLOAT_SECRET: TEST_SECRET,
    });
    expect(cfg.apiKey).toBe(TEST_KEY);
  });

  test("refuses when the key is missing", () => {
    expect(() => loadFixedFloatConfig({ FIXEDFLOAT_API_SECRET: TEST_SECRET })).toThrow(
      FixedFloatError,
    );
  });

  test("refuses when the secret is missing", () => {
    expect(() => loadFixedFloatConfig({ FIXEDFLOAT_API_KEY: TEST_KEY })).toThrow(FixedFloatError);
  });

  test("refuses empty and whitespace-only values (no degraded mode)", () => {
    expect(() => loadFixedFloatConfig(envFixture({ FIXEDFLOAT_API_KEY: "" }))).toThrow(FixedFloatError);
    expect(() => loadFixedFloatConfig(envFixture({ FIXEDFLOAT_API_KEY: "   " }))).toThrow(FixedFloatError);
    expect(() => loadFixedFloatConfig(envFixture({ FIXEDFLOAT_API_SECRET: "" }))).toThrow(FixedFloatError);
  });

  test("CONFIG refusals carry kind CONFIG and never echo the missing value context with secrets", () => {
    try {
      loadFixedFloatConfig({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FixedFloatError);
      const err = e as FixedFloatError;
      expect(err.kind).toBe("CONFIG");
      expect(err.message).toContain("FIXEDFLOAT_API_KEY");
      expect(err.message).not.toContain(TEST_SECRET);
    }
  });
});

describe("fixedfloat redaction law", () => {
  test("redact() strips every occurrence of both credentials from any text", () => {
    const dirty = `POST /api/v1/getCurrencies key=${TEST_KEY} sign=… secret=${TEST_SECRET} done`;
    const clean = redact(dirty, { apiKey: TEST_KEY, apiSecret: TEST_SECRET });
    expect(clean).not.toContain(TEST_KEY);
    expect(clean).not.toContain(TEST_SECRET);
    expect(clean).toContain("[REDACTED:key]");
    expect(clean).toContain("[REDACTED:secret]");
  });

  test("redaction survives partial leakage (suffix of the secret is still stripped)", () => {
    const suffix = TEST_SECRET.slice(8);
    const clean = redact(`trace tail: ${suffix}`, { apiKey: TEST_KEY, apiSecret: TEST_SECRET });
    expect(clean).not.toContain(suffix);
  });

  test("config fingerprint is deterministic and reveals neither credential", () => {
    const cfg: FixedFloatConfig = loadFixedFloatConfig(envFixture());
    const fp1 = cfg.fingerprint();
    const fp2 = cfg.fingerprint();
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^key:sha256:[0-9a-f]{12}…$/);
    expect(fp1).not.toContain(TEST_KEY);
  });
});
