/**
 * packages/hsm-runtime — token law (TDD, task G77-d)
 * ===================================================
 * The signing API is deny-by-default. The laws pinned here:
 *
 *   1. No token configured (HSM_SIGNING_TOKEN unset) ⇒ EVERY gated route
 *      refuses fail-closed (HSM_E_TOKEN_UNSET) — the service never arms
 *      itself implicitly.
 *   2. Missing Bearer header ⇒ HSM_E_AUTH_MISSING. Wrong token ⇒
 *      HSM_E_AUTH_INVALID. Comparison is constant-time (sha256 +
 *      timingSafeEqual) — no early-exit oracle on content.
 *   3. The token value never appears in any error message or printable
 *      form — fingerprint (sha256 prefix) only, and only via the caller's
 *      own probe, never in HsmError text.
 *   4. "Bearer <token>" and the raw token are both accepted forms; anything
 *      else in the Authorization header is refused.
 *
 * Zero network. Zero real credentials — every value here is a PUBLIC
 * self-generated fixture.
 */

import { describe, expect, test } from "bun:test";

import { HsmError } from "../src/errors";
import { authorizeToken, tokenFingerprint } from "../src/auth";

const TOKEN = "hsm-fixture-token-0123456789abcdef";

describe("hsm-runtime auth — deny-by-default token law", () => {
  test("unset configured token refuses BEFORE anything else (fail-closed)", () => {
    // The service has no token configured: even a "correct-looking" request
    // must be refused — there is nothing to compare against, so no route arms.
    expect(() => authorizeToken(TOKEN, null)).toThrow(HsmError);
    try {
      authorizeToken(TOKEN, null);
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_TOKEN_UNSET");
    }
    expect(() => authorizeToken(undefined, null)).toThrow(HsmError);
    expect(() => authorizeToken(null, null)).toThrow(HsmError);
  });

  test("missing Authorization header ⇒ HSM_E_AUTH_MISSING", () => {
    try {
      authorizeToken(undefined, TOKEN);
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_AUTH_MISSING");
    }
    try {
      authorizeToken(null, TOKEN);
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_AUTH_MISSING");
    }
    try {
      authorizeToken("", TOKEN);
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_AUTH_MISSING");
    }
  });

  test("wrong token ⇒ HSM_E_AUTH_INVALID (constant-time path, no content echo)", () => {
    for (const bad of [TOKEN + "x", "Bearer wrong", "hsm-fixture-token-0123456789abcdeg"]) {
      try {
        authorizeToken(bad, TOKEN);
        expect.unreachable();
      } catch (e) {
        expect((e as HsmError).code).toBe("HSM_E_AUTH_INVALID");
        const msg = (e as Error).message;
        expect(msg.includes(TOKEN)).toBe(false);
        expect(msg.includes(bad)).toBe(false);
      }
    }
  });

  test("correct token passes — raw form and Bearer form", () => {
    expect(() => authorizeToken(TOKEN, TOKEN)).not.toThrow();
    expect(() => authorizeToken(`Bearer ${TOKEN}`, TOKEN)).not.toThrow();
    expect(() => authorizeToken(`bearer ${TOKEN}`, TOKEN)).not.toThrow();
  });

  test("malformed Authorization schemes are refused", () => {
    try {
      authorizeToken("Basic c2Fvcw==", TOKEN);
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_AUTH_MISSING");
    }
    try {
      authorizeToken("Bearer", TOKEN);
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_AUTH_MISSING");
    }
  });

  test("tokenFingerprint exposes a stable sha256 prefix only — never the value", () => {
    const fp = tokenFingerprint(TOKEN);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fp.includes(TOKEN)).toBe(false);
    expect(tokenFingerprint(`Bearer ${TOKEN}`)).toBe(fp);
    expect(tokenFingerprint(null)).toBe("unset");
  });
});
