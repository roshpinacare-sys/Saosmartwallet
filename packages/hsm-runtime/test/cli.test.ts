/**
 * packages/hsm-runtime — --once CLI provability (TDD, task G77-d)
 * ================================================================
 * `hsm-runtime --once` is the CI proof: boot the runtime against the real
 * vault path, print the honest measured verdicts as JSON, produce one
 * deterministic SIGN-ONLY proof receipt when signing is READY, and exit with
 * a stable honest code:
 *
 *   0  READY — proof receipt produced
 *   2  SEALED — vault unavailable (env missing / open refused) — honest
 *   3  NO-KEYS — vault open, zero signing-capable keys — honest
 *   4  BLOCKED-AUTH — HSM_SIGNING_TOKEN unset — deny-by-default
 *   5  PROOF-BLOCKED — keys exist but none can prove (no role meta, etc.)
 *   1  unexpected — never masked
 *
 * Every line printed is JSON. No key material ever appears in output
 * (sentinel-scanned). Fixture keys only.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { PrivateKey } from "../../crypto/src/index";
import { openVault } from "../../vault/src/index";

import { runOnce } from "../src/cli";

const MASTER = "99".repeat(32);
const TOKEN = "hsm-fixture-cli-token-0123456789abcdef";
const FIXTURE_ACCOUNT = "fixture.dina";
const activeKey = PrivateKey.fromSeed("hsm-fixture-active-cli-G77d");
const edSeed = createHash("sha256").update("hsm-fixture-ed25519-cli-G77d").digest();

let dir = "";
const outLines: string[] = [];

function sink(line: string) {
  outLines.push(line);
}

function envFixture(over: Record<string, string | undefined> = {}) {
  return {
    HSM_VAULT_DIR: dir,
    HSM_SIGNING_TOKEN: TOKEN,
    ...over,
  };
}

function parseJsonLines(): unknown[] {
  return outLines.filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsm-cli-test-"));
  process.env.SAOS_VAULT_MASTER_KEY = MASTER;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SAOS_VAULT_MASTER_KEY;
});

describe("hsm-runtime --once — honest exit-code contract", () => {
  test("SEALED: no master key in the process env ⇒ exit 2 + honest verdict", async () => {
    delete process.env.SAOS_VAULT_MASTER_KEY;
    outLines.length = 0;
    const code = await runOnce({ env: envFixture({ HSM_VAULT_DIR: dir }), out: sink });
    expect(code).toBe(2);
    const health = parseJsonLines().at(-1) as Record<string, unknown>;
    expect(health.vault).toBe("SEALED");
    expect(JSON.stringify(health)).toContain("VAULT_E_ENV_MISSING");
    process.env.SAOS_VAULT_MASTER_KEY = MASTER;
  });

  test("BLOCKED-AUTH: token unset ⇒ exit 4 (deny-by-default)", async () => {
    outLines.length = 0;
    const code = await runOnce({ env: envFixture({ HSM_SIGNING_TOKEN: undefined }), out: sink });
    expect(code).toBe(4);
    const health = parseJsonLines().at(-1) as Record<string, unknown>;
    expect(health.signing).toBe("BLOCKED-AUTH");
    expect(health.vault).toBe("OPEN");
  });

  test("NO-KEYS: fresh empty vault ⇒ exit 3 + honest NO-KEYS verdict", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsm-cli-empty-"));
    try {
      outLines.length = 0;
      const code = await runOnce({ env: envFixture({ HSM_VAULT_DIR: emptyDir }), out: sink });
      expect(code).toBe(3);
      const health = parseJsonLines().at(-1) as Record<string, unknown>;
      expect(health.signing).toBe("NO-KEYS");
      expect((health.keys as Record<string, unknown>).total).toBe(0);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("READY: fixture keys ⇒ exit 0 + deterministic SIGN-ONLY proof receipt", async () => {
    const vault = await openVault({ dir });
    await vault.sealKey({
      id: `${FIXTURE_ACCOUNT}/active`,
      type: "secp256k1-wif",
      material: activeKey.toWif(),
      meta: { account: FIXTURE_ACCOUNT, role: "active" },
    });
    await vault.sealKey({
      id: "fixture.ed/proof",
      type: "ed25519",
      material: Buffer.from(edSeed),
      meta: null,
    });
    outLines.length = 0;
    const code = await runOnce({ env: envFixture(), out: sink });
    expect(code).toBe(0);
    const parsed = parseJsonLines();
    const health = parsed[0] as Record<string, unknown>;
    expect(health.signing).toBe("READY");
    expect(health.mode).toBe("SIGN-ONLY");
    const receipt = parsed.at(-1) as Record<string, unknown>;
    expect(receipt.mode).toBe("SIGN-ONLY");
    expect(receipt.broadcast).toBe("DISABLED");
    expect((receipt.policy as Record<string, unknown>).broadcast).toBe(false);
    expect(receipt.receiptId).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.kind).toBe("ed25519"); // the deterministic CI proof prefers ed25519
    // zero material in ALL output
    const everything = outLines.join("\n");
    expect(everything.includes(activeKey.toWif())).toBe(false);
    expect(everything.includes(Buffer.from(edSeed).toString("hex"))).toBe(false);
    expect(everything.includes(TOKEN)).toBe(false);
  });

  test("determinism: identical env + fixed clock ⇒ identical proof receipt", async () => {
    const NOW = 1_760_000_100_000;
    const a: string[] = [];
    await runOnce({ env: envFixture(), out: (l) => a.push(l), now: NOW });
    const b: string[] = [];
    await runOnce({ env: envFixture(), out: (l) => b.push(l), now: NOW });
    expect(a).toEqual(b);
  });

  test("PROOF-BLOCKED: vault has keys but none can prove ⇒ exit 5, honest", async () => {
    const noroleDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsm-cli-norole-"));
    try {
      const vault = await openVault({ dir: noroleDir });
      await vault.sealKey({
        id: "norole.only",
        type: "secp256k1-wif",
        material: PrivateKey.fromSeed("hsm-fixture-cli-norole-G77d").toWif(),
        meta: { account: "norole.only" },
      });
      outLines.length = 0;
      const code = await runOnce({ env: envFixture({ HSM_VAULT_DIR: noroleDir }), out: sink });
      expect(code).toBe(5);
      const health = parseJsonLines()[0] as Record<string, unknown>;
      expect(health.signing).toBe("READY");
      const blocked = parseJsonLines().at(-1) as Record<string, unknown>;
      expect(blocked.proof).toBe("BLOCKED");
      expect(JSON.stringify(blocked)).toContain("HSM_E_ROLE_POLICY");
    } finally {
      fs.rmSync(noroleDir, { recursive: true, force: true });
    }
  });
});
