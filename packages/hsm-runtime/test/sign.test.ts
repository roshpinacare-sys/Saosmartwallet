/**
 * packages/hsm-runtime — signing engine + receipts (TDD, task G77-d)
 * ===================================================================
 * PRODUCTION SIGNING LAWS pinned here, all with SELF-GENERATED FIXTURE KEYS
 * (deterministic, public, never real custody):
 *
 *   1. Key material ONLY via the packages/vault AES-256-GCM store — the
 *      signer never receives raw seeds; every signature flows through
 *      vault.withKey (scoped unseal → use → zero-fill).
 *   2. Steem-family signing = packages/chains primitives: digest =
 *      sha256(chain_id ‖ serialized_tx) (steem: 32 zero bytes; blurt:
 *      EXPLICIT 64-hex env, fail-closed — never guessed), signature =
 *      65-byte secp256k1 compact ([31+recid, r, s]) via packages/crypto,
 *      wire = digest ‖ varint(count) ‖ sig.
 *   3. Signature VERIFIABILITY: every Steem receipt's signature must recover
 *      (recoverFromCompact) to the fixture key's own public key; ed25519
 *      receipts verify against the vault's derived public key.
 *   4. Receipts: signed-transaction receipts with WIRE DIGESTS — digest hex,
 *      wireSha256 (sha256 over the full signed wire), txId (steem-family),
 *      receiptId = sha256(canonical JSON body), mode "SIGN-ONLY",
 *      broadcast:false — structural, not a flag.
 *   5. Role policy (fail-closed): funds-class ops REQUIRE an active/owner
 *      role key; posting-class ops accept posting/active/owner; a key
 *      without role meta signs NOTHING (HSM_E_ROLE_POLICY).
 *   6. Zero material leakage: receipts and every error path carry no seed
 *      hex, no WIF, no master key — sentinel-scanned here.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { PrivateKey, recoverFromCompact } from "../../crypto/src/index";
import { appendSignatures, transactionDigest, transactionId, STEEM_CHAIN_ID, type SteemTransaction } from "../../chains/steem/src/transaction";
import type { Asset } from "../../chains/steem/src/serializer";
import { BLURT_OP_IDS, OP_IDS } from "../../chains/steem/src/operations";

import { blurtChainIdFromHex } from "../../chains/blurt/src/adapter";
// eslint-disable-next-line
import { openVault, ed25519Verify } from "../../vault/src/index";

import { HsmError } from "../src/errors";
import { HsmSigner } from "../src/sign";
import { canonicalJson, sha256Hex } from "../src/receipt";

// -------------------------------------------------------------- fixtures ----
// Deterministic PUBLIC fixture keys (self-generated, zero custody value).

const MASTER = "77".repeat(32); // 64 hex chars — public test vector
const FIXTURE_ACCOUNT = "fixture.alice";

const activeKey = PrivateKey.fromSeed(`hsm-fixture-active-G77d`);
const postingKey = PrivateKey.fromSeed(`hsm-fixture-posting-G77d`);
const edSeed = createHash("sha256").update("hsm-fixture-ed25519-G77d").digest(); // 32 bytes

const SENTINELS = [
  activeKey.toWif(),
  postingKey.toWif(),
  Buffer.from(activeKey.bytes).toString("hex"),
  Buffer.from(postingKey.bytes).toString("hex"),
  edSeed.toString("hex"),
  MASTER,
];

const NOW = 1_893_455_600_000; // inside the fixture tx expiration window

let dir = "";
let signer: HsmSigner;

const FIXTURE_TX: SteemTransaction = {
  refBlockNum: 45678,
  refBlockPrefix: 3_131_354_253,
  expiration: 1_893_456_000,
  operations: [
    {
      name: "vote",
      body: { voter: FIXTURE_ACCOUNT, author: "fixture.bob", permlink: "g77d-proof", weight: 5000 },
    },
  ],
};

const FIXTURE_ASSET: Asset = { amount: 1000n, precision: 3, symbol: "STEEM" };

const FUNDS_TX: SteemTransaction = {
  refBlockNum: 45678,
  refBlockPrefix: 3_131_354_253,
  expiration: 1_893_456_000,
  operations: [
    {
      name: "transfer",
      body: { from: FIXTURE_ACCOUNT, to: "fixture.bob", amount: FIXTURE_ASSET, memo: "" },
    },
  ],
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsm-sign-test-"));
  process.env.SAOS_VAULT_MASTER_KEY = MASTER;
  const vault = await openVault({ dir });
  await vault.sealKey({
    id: `${FIXTURE_ACCOUNT}/active`,
    type: "secp256k1-wif",
    material: activeKey.toWif(),
    meta: { account: FIXTURE_ACCOUNT, role: "active" },
  });
  await vault.sealKey({
    id: `${FIXTURE_ACCOUNT}/posting`,
    type: "secp256k1-wif",
    material: postingKey.toWif(),
    meta: { account: FIXTURE_ACCOUNT, role: "posting" },
  });
  await vault.sealKey({
    id: "fixture.ed/proof",
    type: "ed25519",
    material: Buffer.from(edSeed),
    meta: null,
  });
  await vault.sealKey({
    id: "fixture.norole",
    type: "secp256k1-wif",
    material: PrivateKey.fromSeed("hsm-fixture-norole-G77d").toWif(),
    meta: { account: "fixture.norole" },
  });
  // The signer opens AFTER all seals — a single-writer session over the store.
  signer = await HsmSigner.open({ vaultDir: dir });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SAOS_VAULT_MASTER_KEY;
});

describe("hsm-runtime signing — steem-family (posting-class)", () => {
  test("receipt carries digest, wire digests, txId, SIGN-ONLY posture", async () => {
    const r = await signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW });
    expect(r.kind).toBe("steem-family");
    expect(r.chain).toBe("steem");
    expect(r.mode).toBe("SIGN-ONLY");
    expect(r.broadcast).toBe("DISABLED");
    expect(r.policy.broadcast).toBe(false);
    expect(r.signatureCount).toBe(1);
    expect(r.keyId).toBe(`${FIXTURE_ACCOUNT}/active`);
    expect(r.txId).toBe(transactionId(FIXTURE_TX));
    // digest = the exact bytes signed
    const digest = transactionDigest(FIXTURE_TX, STEEM_CHAIN_ID, OP_IDS);
    expect(r.digest).toBe(Buffer.from(digest).toString("hex"));
    // wire = digest ‖ varint(1) ‖ sig(65); wireSha256 pins the full wire
    const wire = appendSignatures(digest, [r.wireSignatures![0]]);
    expect(r.wireSha256).toBe(sha256Hex(wire));
    expect(r.wireHex).toBe(Buffer.from(wire).toString("hex"));
    // receipt id = sha256 over the canonical body without the id
    const { receiptId, ...body } = r;
    expect(receiptId).toBe(sha256Hex(Buffer.from(canonicalJson(body), "utf8")));
    expect(r.at).toBe(new Date(NOW).toISOString());
  });

  test("signature RECOVERS to the fixture key's own public key (verifiability)", async () => {
    const r = await signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW });
    const digest = transactionDigest(FIXTURE_TX, STEEM_CHAIN_ID, OP_IDS);
    const recovered = recoverFromCompact(
      Buffer.from(r.wireSignatures![0], "hex"),
      digest,
    );
    expect(Buffer.from(recovered).equals(Buffer.from(activeKey.publicKey.bytes))).toBe(true);
  });

  test("posting key may sign posting-class ops", async () => {
    const r = await signer.signSteemFamily({
      chain: "steem",
      tx: FIXTURE_TX,
      keyId: `${FIXTURE_ACCOUNT}/posting`,
      now: NOW,
    });
    expect(r.policy.role).toBe("posting");
    const digest = transactionDigest(FIXTURE_TX, STEEM_CHAIN_ID, OP_IDS);
    const recovered = recoverFromCompact(Buffer.from(r.wireSignatures![0], "hex"), digest);
    expect(Buffer.from(recovered).equals(Buffer.from(postingKey.publicKey.bytes))).toBe(true);
  });

  test("FUNDS op with a posting key is REFUSED (role policy, fail-closed)", async () => {
    try {
      await signer.signSteemFamily({
        chain: "steem",
        tx: FUNDS_TX,
        keyId: `${FIXTURE_ACCOUNT}/posting`,
        now: NOW,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_ROLE_POLICY");
    }
  });

  test("FUNDS op with an active key is signed", async () => {
    const r = await signer.signSteemFamily({ chain: "steem", tx: FUNDS_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW });
    expect(r.policy.role).toBe("active");
    expect(r.signatureCount).toBe(1);
  });

  test("key WITHOUT role meta signs NOTHING (fail-closed, no implicit roles)", async () => {
    try {
      await signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: "fixture.norole", now: NOW });
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_ROLE_POLICY");
    }
  });

  test("unknown key id ⇒ HSM_E_UNKNOWN_KEY (no material in the error)", async () => {
    try {
      await signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: "ghost/active", now: NOW });
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_UNKNOWN_KEY");
    }
  });

  test("determinism: same tx + fixed clock ⇒ byte-identical receipt", async () => {
    const a = await signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW });
    const b = await signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("blurt: EXPLICIT chain id required (fail-closed) and honored when present", async () => {
    try {
      await signer.signSteemFamily({ chain: "blurt", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW });
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_CHAIN_ID");
    }
    const blurtIdHex = "bb".repeat(32);
    const r = await signer.signSteemFamily({
      chain: "blurt",
      tx: FIXTURE_TX,
      keyId: `${FIXTURE_ACCOUNT}/active`,
      blurtChainIdHex: blurtIdHex,
      now: NOW,
    });
    const digest = transactionDigest(FIXTURE_TX, blurtChainIdFromHex(blurtIdHex), BLURT_OP_IDS);
    expect(r.digest).toBe(Buffer.from(digest).toString("hex"));
    const recovered = recoverFromCompact(Buffer.from(r.wireSignatures![0], "hex"), digest);
    expect(Buffer.from(recovered).equals(Buffer.from(activeKey.publicKey.bytes))).toBe(true);
  });

  test("malformed blurt chain id (not 64 hex) is refused", async () => {
    try {
      await signer.signSteemFamily({
        chain: "blurt",
        tx: FIXTURE_TX,
        keyId: `${FIXTURE_ACCOUNT}/active`,
        blurtChainIdHex: "zz".repeat(32),
        now: NOW,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_CHAIN_ID");
    }
  });
});

describe("hsm-runtime signing — ed25519 bytes", () => {
  test("sign/verify roundtrip against the vault-derived public key", async () => {
    const msg = Buffer.from("hsm-runtime-ci-proof/v1", "utf8");
    const r = await signer.signBytes({ keyId: "fixture.ed/proof", message: msg, now: NOW });
    expect(r.kind).toBe("ed25519");
    expect(r.mode).toBe("SIGN-ONLY");
    expect(r.broadcast).toBe("DISABLED");
    expect(r.policy.broadcast).toBe(false);
    const pub = await signer.publicKeyEd25519("fixture.ed/proof");
    expect(ed25519Verify(pub, msg, Buffer.from(r.signatureHex!, "hex"))).toBe(true);
    // wire digest covers message ‖ signature
    expect(r.wireSha256).toBe(
      sha256Hex(Buffer.concat([msg, Buffer.from(r.signatureHex!, "hex")])),
    );
    const { receiptId, ...body } = r;
    expect(receiptId).toBe(sha256Hex(Buffer.from(canonicalJson(body), "utf8")));
  });

  test("secp256k1 key refuses the ed25519 route (key-type law)", async () => {
    try {
      await signer.signBytes({ keyId: `${FIXTURE_ACCOUNT}/active`, message: Buffer.from("x"), now: NOW });
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_KEY_TYPE");
    }
  });

  test("oversized message is refused (bounded input)", async () => {
    try {
      await signer.signBytes({
        keyId: "fixture.ed/proof",
        message: Buffer.alloc(65 * 1024, 1),
        now: NOW,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as HsmError).code).toBe("HSM_E_BAD_INPUT");
    }
  });
});

describe("hsm-runtime — zero material leakage (sentinel law)", () => {
  test("no receipt or error path ever carries fixture material", async () => {
    const outputs: string[] = [];
    const r1 = await signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW });
    const r2 = await signer.signBytes({ keyId: "fixture.ed/proof", message: Buffer.from("m"), now: NOW });
    outputs.push(JSON.stringify(r1), JSON.stringify(r2));
    for (const failing of [
      () => signer.signSteemFamily({ chain: "steem", tx: FIXTURE_TX, keyId: "ghost", now: NOW }),
      () => signer.signSteemFamily({ chain: "blurt", tx: FIXTURE_TX, keyId: `${FIXTURE_ACCOUNT}/active`, now: NOW }),
    ]) {
      try {
        await failing();
      } catch (e) {
        outputs.push(String((e as Error).message));
      }
    }
    for (const out of outputs) {
      for (const s of SENTINELS) {
        expect(out.includes(s)).toBe(false);
      }
    }
  });

  test("metadata listing carries ids/types only — no envelopes, no material", () => {
    const listing = signer.metadata();
    const body = JSON.stringify(listing);
    expect(body.includes("ciphertext")).toBe(false);
    expect(body.includes("authTag")).toBe(false);
    for (const s of SENTINELS) expect(body.includes(s)).toBe(false);
    expect(listing.map((k) => k.id).sort()).toEqual([
      "fixture.alice/active",
      "fixture.alice/posting",
      "fixture.ed/proof",
      "fixture.norole",
    ]);
  });
});
