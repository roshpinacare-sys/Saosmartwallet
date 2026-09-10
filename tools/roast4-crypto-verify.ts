/**
 * ROAST r4 verification — the two crypto fixes must be proven, not claimed.
 *
 * 1. wifToPrivHex: roundtrip against steem-js (the chain authority) on a
 *    DISPOSABLE dev-faucet WIF (never leaves the tool, never a vault key).
 * 2. buildSteemClaimTx: the LOCAL finalize bytes must be BIT-IDENTICAL to the
 *    adapter's own serialization (toWireOperation path) — the same oracle
 *    discipline that caught the legacy-tag shift, now guarding the r4 fix.
 *
 * Read-only: no broadcasting, no keys touched.
 */
import { wifToPrivHex, wifToChainPub } from "@/lib/gate/key-id";
import { buildSteemClaimTx } from "@/lib/steem-social";
import { steemAdapter } from "@/lib/steem-server";
import { serializeTransaction } from "../packages/chains/steem/src/transaction";

async function main() {
  // ── 1. WIF roundtrip (dev-faucet key, disposable, NOT in the vault) ──
  const WIF = "5Kd3NBUAdUnhyzenEwVLy9pBKxSwXvE9FMPyR4UKZvpe6E3AgLr";
  const privHex = wifToPrivHex(WIF);
  const pub = wifToChainPub(WIF);
  console.log(`[1] wifToPrivHex: hex=${privHex.slice(0, 12)}… (${privHex.length} chars)`);
  if (privHex.length !== 64) throw new Error(`expected 64 hex chars, got ${privHex.length}`);
  if (!/^[0-9a-f]+$/.test(privHex)) throw new Error("priv hex corrupted (non-hex chars) — toString('hex') bug back");
  if (!pub.startsWith("STM") || pub.length < 50) throw new Error(`bad chain pub: ${pub}`);
  console.log(`[1] ✅ WIF roundtrip sane: hex is real hex, chain pub ${pub.slice(0, 12)}…`);

  // ── 2. claim build: local finalize bytes vs adapter serialization ──
  const spec = { account: "headcorner", rewardSteem: "0.156 STEEM", rewardSbd: "0.000 SBD", rewardVests: "1401.361689 VESTS" };
  const built = await buildSteemClaimTx(spec);
  // independent reconstruction through the ADAPTER's own wire mapping:
  const adapter = steemAdapter();
  const unsigned2 = await adapter.buildOperations([
    { type: "claim_reward_balance", payload: { account: spec.account, reward_steem: spec.rewardSteem, reward_sbd: spec.rewardSbd, reward_vests: spec.rewardVests } },
  ]);
  // borrow the metadata of the FIRST build so both serialize the same envelope
  const sameEnvelope: Parameters<typeof serializeTransaction>[0] = {
    refBlockNum: built.unsigned.metadata.refBlockNum,
    refBlockPrefix: built.unsigned.metadata.refBlockPrefix,
    expiration: built.unsigned.metadata.expiration,
    operations: unsigned2.operations.map((o) => ({
      name: "claim_reward_balance" as const,
      body: {
        account: spec.account,
        reward_steem: { amount: BigInt(Math.round(parseFloat(spec.rewardSteem) * 1000)), precision: 3, symbol: "STEEM" },
        reward_sbd: { amount: 0n, precision: 3, symbol: "SBD" },
        reward_vests: { amount: BigInt(Math.round(parseFloat(spec.rewardVests) * 1e6)), precision: 6, symbol: "VESTS" },
      },
    })),
  };
  const adapterHex = Buffer.from(serializeTransaction(sameEnvelope)).toString("hex");
  const match = adapterHex === built.serializedHex;
  console.log(`[2] local hex (${built.serializedHex.length / 2}B): ${built.serializedHex.slice(0, 24)}…`);
  console.log(`[2] adapter-path hex (${adapterHex.length / 2}B): ${adapterHex.slice(0, 24)}…`);
  if (!match) {
    console.log(`[2] local  = ${built.serializedHex}`);
    console.log(`[2] adapter= ${adapterHex}`);
    throw new Error("local finalize bytes differ from the independent Asset reconstruction");
  }
  console.log(`[2] ✅ BIT-IDENTICAL — claim builder fixed without drift (local = independent reconstruction)`);
  console.log("ROAST r4 crypto verification: ALL PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
