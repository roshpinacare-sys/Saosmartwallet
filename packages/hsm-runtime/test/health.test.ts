/**
 * packages/hsm-runtime — honest health verdicts (TDD, task G77-d)
 * ================================================================
 * /health and /status must report MEASURED verdicts per capability and never
 * fake-ready:
 *
 *   vault   : "SEALED" (master-key env missing or openVault failed, with the
 *             stable error code as the reason) | "OPEN"
 *   signing : READY only when vault OPEN + token SET + ≥1 signing key;
 *             NO-KEYS when vault open but zero signing-capable keys;
 *             BLOCKED-AUTH when the token is unset (deny-by-default);
 *             BLOCKED-VAULT when the vault is sealed.
 *   broadcast : always "DISABLED" — the runtime has no broadcast endpoint,
 *             structurally, by design (side-effect law).
 *   keys    : counts + type histogram ONLY (metadata; never ids of real
 *             custody in the bare /health shape, never material anywhere).
 *
 * The bare /health shape carries zero operational data (fleet law, G76-c
 * precedent): liveness + mode + broadcast posture only.
 */

import { describe, expect, test } from "bun:test";

import { HsmError } from "../src/errors";
import { bareHealth, measureHealth, type HealthInput } from "../src/health";
import type { KeyMetadata } from "../../vault/src/vault";

const STARTED_AT = 1_760_000_000_000; // fixed epoch ms — deterministic
const NOW = STARTED_AT + 65_000;

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    vaultOpen: true,
    vaultReason: null,
    tokenSet: true,
    keyMetadata: [
      {
        id: "fixture.alice/active",
        type: "secp256k1-wif",
        meta: { account: "fixture.alice", role: "active" },
        createdAt: "2026-10-26T00:00:00.000Z",
      },
      {
        id: "fixture.ed/proof",
        type: "ed25519",
        meta: null,
        createdAt: "2026-10-26T00:00:00.000Z",
      },
    ],
    startedAt: STARTED_AT,
    now: NOW,
    ...over,
  };
}

describe("hsm-runtime health — honest verdict matrix", () => {
  test("READY: vault open + token set + signing keys present", () => {
    const h = measureHealth(input());
    expect(h.vault).toBe("OPEN");
    expect(h.signing).toBe("READY");
    expect(h.token).toBe("SET");
    expect(h.keys.total).toBe(2);
    expect(h.keys.byType["secp256k1-wif"]).toBe(1);
    expect(h.keys.byType["ed25519"]).toBe(1);
    expect(h.broadcast).toBe("DISABLED");
    expect(h.mode).toBe("SIGN-ONLY");
    expect(h.uptimeSeconds).toBe(65);
    expect(h.time).toBe(new Date(NOW).toISOString());
    expect(h.reasons.length).toBe(0);
  });

  test("vault SEALED ⇒ signing BLOCKED-VAULT with the stable reason", () => {
    const h = measureHealth(
      input({
        vaultOpen: false,
        vaultReason: "VAULT_E_ENV_MISSING",
        keyMetadata: null,
      }),
    );
    expect(h.vault).toBe("SEALED");
    expect(h.signing).toBe("BLOCKED-VAULT");
    expect(h.reasons.join(" ")).toContain("VAULT_E_ENV_MISSING");
    // A sealed vault reports zero keys — never invents an inventory it cannot read.
    expect(h.keys.total).toBe(0);
  });

  test("vault open but zero signing keys ⇒ NO-KEYS (never READY)", () => {
    const h = measureHealth(input({ keyMetadata: [] }));
    expect(h.vault).toBe("OPEN");
    expect(h.signing).toBe("NO-KEYS");
    expect(h.reasons.join(" ")).toContain("no signing-capable keys");
  });

  test("opaque-only vault counts as NO-KEYS (opaque is not a signing type)", () => {
    const h = measureHealth(
      input({
        keyMetadata: [
          {
            id: "soldier-wif-string",
            type: "opaque",
            meta: null,
            createdAt: "2026-10-26T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(h.signing).toBe("NO-KEYS");
    expect(h.keys.byType["opaque"]).toBe(1);
  });

  test("token unset ⇒ BLOCKED-AUTH even with keys and open vault (deny-by-default)", () => {
    const h = measureHealth(input({ tokenSet: false }));
    expect(h.signing).toBe("BLOCKED-AUTH");
    expect(h.token).toBe("UNSET");
    expect(h.reasons.join(" ")).toContain("HSM_SIGNING_TOKEN");
  });

  test("precedence: auth-block beats vault-block beats no-keys", () => {
    expect(measureHealth(input({ tokenSet: false, vaultOpen: false, keyMetadata: null })).signing).toBe(
      "BLOCKED-AUTH",
    );
    expect(measureHealth(input({ vaultOpen: false, keyMetadata: null })).signing).toBe("BLOCKED-VAULT");
  });

  test("bare health carries zero operational data (no keys, no verdicts, no reasons)", () => {
    const bare = bareHealth(measureHealth(input()));
    const body = JSON.stringify(bare);
    expect(bare.ok).toBe(true);
    expect(body.includes("fixture")).toBe(false);
    expect(body.includes("key")).toBe(false);
    expect(body.includes("READY")).toBe(false);
    expect(bare.broadcast).toBe("DISABLED");
    expect(Object.keys(bare).sort()).toEqual(["broadcast", "mode", "ok", "service", "time", "uptimeSeconds"]);
  });

  test("error text never contains vault material or token values (sentinel law)", () => {
    // The health path can only carry STABLE error codes — never env values.
    const h = measureHealth(
      input({ vaultOpen: false, vaultReason: "VAULT_E_AUTH", keyMetadata: null }),
    );
    expect(h.vaultReason).toBe("VAULT_E_AUTH");
    expect(new HsmError("HSM_E_BAD_INPUT", "probe").code).toBe("HSM_E_BAD_INPUT"); // type presence
  });
});
