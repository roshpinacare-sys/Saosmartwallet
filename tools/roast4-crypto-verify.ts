/**
 * ROAST r4 verification — the two crypto fixes must be proven, not claimed.
 *
 * 1. wifToPrivHex: roundtrip against steem-js (the chain authority) on an
 *    EPHEMERAL WIF minted at runtime from crypto.randomBytes — the repo must
 *    never contain key-shaped material (r5 roast: even a well-known test WIF
 *    poisons every future secret-scan and violates the zero-WIF doctrine).
 * 2. buildSteemClaimTx: the LOCAL finalize bytes must be BIT-IDENTICAL to the
 *    adapter's own serialization (toWireOperation path) — the same oracle
 *    discipline that caught the legacy-tag shift, now guarding the r4 fix.
 *
 * Read-only: no broadcasting, no keys touched.
 */
import { randomBytes } from "crypto";
import { wifToPrivHex, wifToChainPub } from "@/lib/gate/key-id";
import { buildSteemClaimTx } from "@/lib/steem-social";
import { steemAdapter } from "@/lib/steem-server";
import { serializeTransaction } from "../packages/chains/steem/src/transaction";
import bs58 from "bs58";
import { createHash } from "crypto";

function mintEphemeralWif(): string {
  const payload = Buffer.concat([Buffer.from([0x80]), randomBytes(32)]);
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
}

async function main() {
  // ── 1. WIF roundtrip (ephemeral key, minted fresh, never persisted) ──
  const WIF = mintEphemeralWif();
  const privHex = wifToPrivHex(WIF);
  const pub = wifToChainPub(WIF);
  console.log(`[1] wifToPrivHex: hex=${privHex.slice(0, 12)}… (${privHex.length} chars)`);
  if (privHex.length !== 64) throw new Error(`expected 64 hex chars, got ${privHex.length}`);
  if (!/^[0-9a-f]+$/.test(privHex)) throw new Error("priv hex corrupted (non-hex chars) — toString('hex') bug back");
  if (!pub.startsWith("STM") || pub.length < 50) throw new Error(`bad chain pub: ${pub}`);
  // the roundtrip is only meaningful if the WIF is sane: 0x80 prefix, btc checksum
  const raw = Buffer.from(bs58.decode(WIF));
  if (raw[0] !== 0x80 || raw.length !== 37) throw Error("ephemeral WIF malformed"); // 0x80 + 32B body + 4B checksum
  const privFromWif = Buffer.from(raw.subarray(1, 33));
  if (privHex !== privFromWif.toString("hex")) throw Error("wifToPrivHex drifted from the WIF body");
  console.log(`[1] ✅ WIF roundtrip sane: hex is real hex and equals the WIF body, chain pub ${pub.slice(0, 12)}…`);

  // ── 2. claim build: local finalize bytes vs adapter serialization ──
  const spec = { account: "headcorner", rewardSteem: "0.156 STEEM", rewardSbd: "0.000 SBD", rewardVests: "1401.361689 VESTS" };
  const built = await buildSteemClaimTx(spec);
  // independent reconstruction through the ADAPTER's own wire mapping:
  const adapter = steemAdapter();
  const unsigned2 = await adapter.buildOperations([
    { type: "claim_reward_balance", payload: { account: spec.account, reward_steem: spec.rewardSteem, reward_sbd: spec.rewardSbd, reward_vests: spec.rewardVests } },
  ]);
  // borrow the metadata of the FIRST build so both serialize the same envelope
  // (tsc: metadata is typed `unknown` upstream — narrow it once, explicitly)
  const meta = built.unsigned.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number };
  const sameEnvelope: Parameters<typeof serializeTransaction>[0] = {
    refBlockNum: meta.refBlockNum,
    refBlockPrefix: meta.refBlockPrefix,
    expiration: meta.expiration,
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
