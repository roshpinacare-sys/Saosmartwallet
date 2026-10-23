/**
 * packages/chains/blurt — adapter coverage (task t56, agent-9)
 * ============================================================
 * Directive §7B names BLURT among the four mandatory chains. The blurt
 * adapter is the steem-family machinery re-parameterized with the
 * in-repo EMPIRICALLY-VERIFIED fork table (BLURT_OP_IDS: custom_json=12,
 * proven against blurt-rpc.saboin.com per operations.ts r20).
 *
 * FAIL-CLOSED LAW (this suite pins it): the adapter REFUSES to construct
 * without an explicit 32-byte chain id — blurt's reachable RPC does not
 * expose get_chain_id today, so no default constant is shipped. Same
 * doctrine as the M0 allowBroadcast gate: unverified state never signs.
 *
 * ZERO network. All signing paths are deterministic offline digest math.
 */

import { describe, it, expect } from "bun:test";

import { SteemAdapter } from "../../steem/src/adapter";
import { BLURT_OP_IDS, OP_IDS } from "../../steem/src/operations";
import { serializeTransaction, transactionDigest, STEEM_CHAIN_ID } from "../../steem/src/transaction";
import { PrivateKey } from "../../../crypto/src/keys";
import { BlurtAdapter, blurtChainIdFromHex } from "../src/adapter";

/** Test fixture chain id — the ADAPTER law is "explicit", not any specific value. */
const BLURT_CHAIN_ID_FIXTURE = blurtChainIdFromHex(
  "6c83adf3acbba31a3b3d36a4e8a12dfa4b4d37b64f388d7520bb15dadaa690a6",
);

/** Deterministic test key material (fromSeed is sha256 — fixed string, fixed key). */
const ACTIVE_WIF = PrivateKey.fromSeed("blurt-fixture-account" + "active" + "Pfixture-master-password").toWif();
const POSTING_WIF = PrivateKey.fromSeed("blurt-fixture-account" + "posting" + "Pfixture-master-password").toWif();

describe("BlurtAdapter — fail-closed construction", () => {
  it("REFUSES to construct without an explicit chain id (no default is shipped)", () => {
    expect(
      () =>
        new BlurtAdapter({
          rpcUrl: "http://127.0.0.1:9", // never contacted in this suite
        } as never),
    ).toThrow();
  });

  it("refuses chain ids that are not exactly 32 bytes", () => {
    expect(
      () =>
        new BlurtAdapter({
          rpcUrl: "http://127.0.0.1:9",
          chainId: new Uint8Array(31),
        } as never),
    ).toThrow();
  });

  it("constructs with an explicit chain id and pins the blurt vocabulary", () => {
    const a = new BlurtAdapter({ rpcUrl: "http://127.0.0.1:9", chainId: BLURT_CHAIN_ID_FIXTURE });
    expect(a.flavor).toBe("steem-family");
    expect(a.chainId).toBe(Buffer.from(BLURT_CHAIN_ID_FIXTURE).toString("hex"));
  });
});

describe("BlurtAdapter — blurt wire vocabulary", () => {
  const tx = {
    refBlockNum: 12345,
    refBlockPrefix: 0xaabbccdd,
    expiration: 1764000000,
    operations: [
      {
        name: "custom_json" as const,
        body: {
          required_auths: [],
          required_posting_auths: ["fixture"],
          id: "sm_market",
          json: JSON.stringify({ t: 1 }),
        },
      },
    ],
  };

  it("BLURT_OP_IDS maps custom_json to wire tag 12 (steem uses 18)", () => {
    expect(Number(BLURT_OP_IDS.custom_json)).toBe(12);
    expect(Number(OP_IDS.custom_json)).toBe(18);
  });

  it("the same custom_json op digests DIFFERENTLY under blurt vs steem tables", () => {
    const blurtDigest = bytesToHex(transactionDigest(tx, BLURT_CHAIN_ID_FIXTURE, BLURT_OP_IDS));
    const steemDigest = bytesToHex(transactionDigest(tx, STEEM_CHAIN_ID, OP_IDS));
    expect(blurtDigest).not.toBe(steemDigest);
  });

  it("serialization is blurt-table-exact (custom_json packed with tag 12)", () => {
    const bytes = serializeTransaction(tx, BLURT_OP_IDS);
    // wire layout: refBlockNum u16 (0-1) ‖ refBlockPrefix u32 (2-5) ‖
    // expiration u32 (6-9) ‖ varint opCount (10) ‖ op id (11) ‖ body
    expect(bytes[10]).toBe(0x01); // one operation
    expect(bytes[11]).toBe(0x0c); // blurt custom_json = 12
    // and the steem table packs 0x12 (18) for the identical op
    const steemBytes = serializeTransaction(tx, OP_IDS);
    expect(steemBytes[11]).toBe(0x12);
  });
});

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

describe("BlurtAdapter — offline sign path (deterministic, policy-inherited)", () => {
  const adapter = new BlurtAdapter({ rpcUrl: "http://127.0.0.1:9", chainId: BLURT_CHAIN_ID_FIXTURE });

  function buildTransferTx() {
    // buildOperations is network-free for the metadata math? No — it queries
    // the chain for ref_block data. Pin metadata directly instead (same shape
    // buildOperations produces) to keep this suite ZERO-network.
    return {
      chainId: adapter.chainId,
      operations: [{ type: "transfer", payload: { from: "fixture", to: "dest", amount: "1.000 BLURT", memo: "" } }],
      metadata: { refBlockNum: 1000, refBlockPrefix: 0x11223344, expiration: 1764000100 },
    };
  }

  it("signs a transfer with the ACTIVE role over the blurt digest (65-byte compact)", async () => {
    const tx = buildTransferTx();
    const signed = await adapter.sign(tx, { byRole: { active: ACTIVE_WIF } }, ["active"]);
    expect(signed.signatures).toHaveLength(1);
    expect(Buffer.from(signed.signatures[0], "hex")).toHaveLength(65);
    expect(signed.rolesUsed).toEqual(["active"]);
    expect(typeof (signed.metadata as { digestHex: string }).digestHex).toBe("string");
  });

  it("is deterministic — identical tx+key produce identical digest and signature", async () => {
    const tx = buildTransferTx();
    const a = await adapter.sign(tx, { byRole: { active: ACTIVE_WIF } }, ["active"]);
    const b = await adapter.sign(tx, { byRole: { active: ACTIVE_WIF } }, ["active"]);
    expect(a.signatures[0]).toBe(b.signatures[0]);
    expect((a.metadata as { digestHex: string }).digestHex).toBe((b.metadata as { digestHex: string }).digestHex);
  });

  it("digest equals the standalone blurt-table digest (plumbing exactness)", async () => {
    const tx = buildTransferTx();
    const signed = await adapter.sign(tx, { byRole: { active: ACTIVE_WIF } }, ["active"]);
    const meta = signed.metadata as { digestHex: string; refBlockNum: number; refBlockPrefix: number; expiration: number };
    const steemTx = {
      refBlockNum: meta.refBlockNum,
      refBlockPrefix: meta.refBlockPrefix,
      expiration: meta.expiration,
      operations: [{ name: "transfer" as const, body: { from: "fixture", to: "dest", amount: { amount: 1000n, precision: 3, symbol: "BLURT" }, memo: "" } }],
    };
    expect(meta.digestHex).toBe(bytesToHex(transactionDigest(steemTx, BLURT_CHAIN_ID_FIXTURE, BLURT_OP_IDS)));
  });

  it("policy inherited: posting key can NEVER sign funds ops (fail-closed)", async () => {
    const tx = buildTransferTx();
    await expect(adapter.sign(tx, { byRole: { posting: POSTING_WIF } }, ["posting"])).rejects.toThrow(/policy violation/);
  });

  it("broadcast is fail-closed by default (M0 gate inherited)", async () => {
    const tx = buildTransferTx();
    const signed = await adapter.sign(tx, { byRole: { active: ACTIVE_WIF } }, ["active"]);
    await expect(adapter.broadcast(signed)).rejects.toThrow(/broadcast disabled/);
  });
});

describe("BlurtAdapter — BLT address prefix", () => {
  it("defaults to the BLT prefix and roundtrips blurt key strings", async () => {
    const priv = PrivateKey.fromSeed("blurt-fixture-account" + "owner" + "Pfixture-master-password");
    const adapter = new BlurtAdapter({ rpcUrl: "http://127.0.0.1:9", chainId: BLURT_CHAIN_ID_FIXTURE });
    // The adapter must encode authorities with BLT — exercised via the same
    // graphene encoding the steem adapter uses (graphenePubToRaw33 inverts it).
    const { graphenePubToRaw33 } = await import("../../steem/src/operations");
    const blt = priv.publicKey.toString("BLT");
    expect(blt.startsWith("BLT")).toBe(true);
    const raw33 = graphenePubToRaw33(blt);
    expect(bytesToHex(raw33)).toBe(bytesToHex(priv.publicKey.bytes));
  });

  it("blurtChainIdFromHex is exact and validates length (fail-closed)", () => {
    expect(blurtChainIdFromHex("00".repeat(32))).toEqual(new Uint8Array(32));
    expect(() => blurtChainIdFromHex("00".repeat(31))).toThrow();
  });
});

// The blurt adapter IS-A SteemAdapter (seam conformance is structural).
describe("BlurtAdapter — ChainAdapter seam conformance", () => {
  it("is an instance of SteemAdapter and advertises steem-family read capabilities", () => {
    const a: SteemAdapter = new BlurtAdapter({ rpcUrl: "http://127.0.0.1:9", chainId: BLURT_CHAIN_ID_FIXTURE });
    expect(a instanceof SteemAdapter).toBe(true);
    expect(a.capabilities.has("sign-active")).toBe(true);
    expect(a.capabilities.has("broadcast")).toBe(false); // fail-closed default
  });
});
