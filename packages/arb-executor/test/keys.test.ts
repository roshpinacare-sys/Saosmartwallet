/**
 * arb-executor — keyfile loading + sealing (fixture keys ONLY, zero custody)
 * The custody file shape is the MEASURED army-keys.json shape; the keys are
 * self-generated deterministic fixtures (public, valueless). Sentinel scan
 * proves no WIF ever escapes the loader's metadata surface.
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PrivateKey } from "../../crypto/src/index";
import { openVault } from "../../vault/src/index";
import { HsmSigner } from "../../hsm-runtime/src/sign";

import { loadArmyKeys } from "../src/keys";

const MASTER = "88".repeat(32);
const NOW = 1_893_455_600_000;

const activeA = PrivateKey.fromSeed("arb-fixture-alice-active");
const activeB = PrivateKey.fromSeed("arb-fixture-bob-active");

function fixtureKeyfile(): object {
  return {
    extractedAt: "2026-10-27T00:00:00Z",
    generations: [
      { gen: "GEN-2", outerSha: "aaaaaaaa", innerSha: "bbbbbbbb" },
      { gen: "GEN-1", outerSha: "cccccccc", innerSha: "dddddddd" },
    ],
    errors: [],
    accounts: [
      {
        name: "fixture.alice",
        gens: [
          { gen: "GEN-2", wif: activeA.toWif(), pub: activeA.publicKey.toString(), activeWif: activeA.toWif(), activePub: activeA.publicKey.toString() },
          { gen: "GEN-1", wif: PrivateKey.fromSeed("arb-fixture-alice-old").toWif(), pub: PrivateKey.fromSeed("arb-fixture-alice-old").publicKey.toString(), activeWif: PrivateKey.fromSeed("arb-fixture-alice-old").toWif(), activePub: PrivateKey.fromSeed("arb-fixture-alice-old").publicKey.toString() },
        ],
      },
      {
        name: "fixture.bob",
        gens: [{ gen: "GEN-2", wif: activeB.toWif(), pub: activeB.publicKey.toString(), activeWif: activeB.toWif(), activePub: activeB.publicKey.toString() }],
      },
    ],
  };
}

const SENTINELS = [activeA.toWif(), activeB.toWif(), Buffer.from(activeA.bytes).toString("hex"), Buffer.from(activeB.bytes).toString("hex"), MASTER];

let dir = "";

describe("loadArmyKeys (measured custody shape, fixture keys)", () => {
  test("newest-gen metadata loads; WIFs never surface", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "arb-keys-test-"));
    const keyPath = path.join(dir, "army-keys.json");
    fs.writeFileSync(keyPath, JSON.stringify(fixtureKeyfile()));

    const army = loadArmyKeys(keyPath);
    expect(army.accounts.length).toBe(2);
    const alice = army.accounts[0];
    expect(alice.account).toBe("fixture.alice");
    expect(alice.gen).toBe("GEN-2");
    expect(alice.activePub).toBe(activeA.publicKey.toString());
    // sentinel scan: no key material anywhere in the metadata surface
    const surface = JSON.stringify(army.accounts);
    for (const s of SENTINELS) expect(surface.includes(s)).toBe(false);

    // seal + open through the production signer
    process.env.SAOS_VAULT_MASTER_KEY = MASTER;
    const vault = await openVault({ dir: path.join(dir, "vault") });
    const sealed = await army.sealActiveKeys(vault);
    expect(sealed).toEqual(["army/fixture.alice/active", "army/fixture.bob/active"]);
    const signer = await HsmSigner.open({ vaultDir: path.join(dir, "vault") });
    const meta = signer.metadata();
    expect(meta.length).toBe(2);
    expect(meta.every((k) => k.type === "secp256k1-wif" && k.meta?.role === "active")).toBe(true);
    // still no material in the signer's metadata surface
    for (const s of SENTINELS) expect(JSON.stringify(meta).includes(s)).toBe(false);

    // role policy: the sealed key CAN sign a funds op (active authority)
    const receipt = await signer.signSteemFamily({
      chain: "steem",
      tx: {
        refBlockNum: 1,
        refBlockPrefix: 2,
        expiration: Math.floor(NOW / 1000) + 600,
        operations: [{
          name: "limit_order_create",
          body: {
            owner: "fixture.alice",
            orderid: 7,
            amount_to_sell: { amount: 5000n, precision: 3, symbol: "SBD" },
            min_to_receive: { amount: 48000n, precision: 3, symbol: "STEEM" },
            fill_or_kill: true,
            expiration: Math.floor(NOW / 1000) + 600,
          },
        }],
      },
      keyId: "army/fixture.alice/active",
      now: NOW,
    });
    expect(receipt.mode).toBe("SIGN-ONLY");
    expect(receipt.broadcast).toBe("DISABLED");
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.SAOS_VAULT_MASTER_KEY;
  });

  test("custody activePub ≠ derived pubkey → honest refusal (pub mismatch)", () => {
    const bad = fixtureKeyfile() as { accounts: Array<{ name: string; gens: Array<Record<string, string>> }> };
    bad.accounts[0].gens[0].activePub = "STM1111111111111111111111111111111111111111111111111";
    const p = path.join(os.tmpdir(), `arb-bad-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(bad));
    expect(() => loadArmyKeys(p)).toThrow(/ARMY_KEYS_E_PUB_MISMATCH/);
    fs.rmSync(p, { force: true });
  });

  test("missing custody file → fail-closed named error", () => {
    expect(() => loadArmyKeys("/nonexistent/army-keys.json")).toThrow(/ARMY_KEYS_E_CUSTODY/);
  });
});
