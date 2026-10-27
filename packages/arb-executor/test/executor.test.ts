/**
 * arb-executor — signing rail cycle + structural side-effect law tests
 * (fixture keys, injected rpc, zero network). Pins:
 *   • EXECUTE verdicts → signed intents via hsm-runtime, receipts SIGN-ONLY;
 *   • receipts land in a hash-chained JSONL that verifies;
 *   • NO broadcast exists anywhere in the package (structural grep law);
 *   • the emitted op set is limit_order_create ONLY (allowTransfersOut=false
 *     is enforced structurally, not by convention);
 *   • ETH/SOL corridors report KEYS-ABSENT-honest in this runtime.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PrivateKey } from "../../crypto/src/index";
import { openVault } from "../../vault/src/index";
import { HsmSigner } from "../../hsm-runtime/src/sign";
import { HashChainAudit } from "../../hsm-runtime/src/audit";

import { parseArmedPolicy } from "../src/policy";
import { planCycle } from "../src/plan";
import { ArbExecutor, buildLimitOrderOp, deriveOrderId } from "../src/executor";
import { ChainReader } from "../src/chain";
import { ethSolReadiness } from "../src/corridors";
import type { OpportunityTable, Opportunity } from "../../arb-scanner/src/types";
import type { AccountState, AuthorityVerdict } from "../src/chain";

const MASTER = "99".repeat(32);
const NOW = 1_893_455_600_000;
const CYCLE_TS = 1_893_455_600;

const POLICY = parseArmedPolicy(
  {
    armed: true,
    maxOpsPerCycle: 60,
    maxAskSteemPerCycle: 320,
    maxBidSbdPerCycle: 100,
    bidReserveSbd: 0.5,
    minRcPct: 20,
    policy: { allowTransfersOut: false, arb: { minSpreadBps: 100, maxNotionalSbdPerOp: 50, orderTtlSec: 900 } },
  },
  "fixture-exec-armed.json",
);

const EDGE: Opportunity = {
  pair: "STEEM/SBD",
  buyVenue: "steem-internal",
  sellVenue: "steem-internal",
  spreadBps: 150,
  depthBaseSatoshis: 500_000,
  depthQuoteSatoshis: 50_000,
  buyPrice: 0.10241,
  sellPrice: 0.10206,
  basis: "same-book-cross",
  note: "fixture",
  at: new Date(NOW).toISOString(),
};

const TABLE: OpportunityTable = {
  schema: "arb-opportunities/1",
  at: new Date(NOW).toISOString(),
  scannerVersion: "1.0.0",
  corridors: [{ corridor: "STEEM_SBD_INTERNAL", opportunities: [EDGE], gaps: [], books: [] }],
  measured: [],
};

const STATE: AccountState = { account: "fixture.alice", steemSatoshis: 30_000, sbdSatoshis: 12_000, activePubkeys: ["STMGood"], rcPercent: 90 };
const AUTH: AuthorityVerdict = { account: "fixture.alice", ok: true, matchedKeys: 1 };

let dir = "";
let executor: ArbExecutor;
let receiptsPath: string;

const chain = new ChainReader({
  endpoint: "fixture",
  rpc: async (_e: string, method: string) => {
    if (method === "condenser_api.get_dynamic_global_properties") {
      return { head_block_number: 0x00e3f2b9, head_block_id: "00e3f2b94d2c1a7b8c9d0e1f2a3b4c5d6e7f8091", time: "2026-10-27T12:40:00" };
    }
    throw new Error(`no fixture for ${method}`);
  },
});

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "arb-exec-test-"));
  process.env.SAOS_VAULT_MASTER_KEY = MASTER;
  const vaultDir = path.join(dir, "vault");
  const vault = await openVault({ dir: vaultDir });
  const key = PrivateKey.fromSeed("arb-fixture-alice-active");
  await vault.sealKey({
    id: "army/fixture.alice/active",
    type: "secp256k1-wif",
    material: key.toWif(),
    meta: { role: "active", account: "fixture.alice", gen: "GEN-2" },
  });
  const signer = await HsmSigner.open({ vaultDir });
  receiptsPath = path.join(dir, "receipts.jsonl");
  executor = new ArbExecutor({
    policy: POLICY,
    chain,
    signer,
    keyIdFor: (account: string) => `army/${account}/active`,
    receiptsPath,
  });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SAOS_VAULT_MASTER_KEY;
});

describe("ArbExecutor.runCycle (SIGN-ONLY rail)", () => {
  test("EXECUTE decision → signed intent with honest receipt posture", async () => {
    const { decisions } = planCycle({
      table: TABLE,
      policy: POLICY,
      states: new Map([["fixture.alice", STATE]]),
      authorities: new Map([["fixture.alice", AUTH]]),
      roster: ["fixture.alice"],
      now: NOW,
    });
    const refBlock = await chain.refBlock();
    const run = await executor.runCycle({ decisions, refBlock, now: NOW, cycleTs: CYCLE_TS });

    expect(run.mode).toBe("SIGN-ONLY");
    expect(run.broadcast).toBe("DISABLED-owner-lever");
    expect(run.ledger.ops).toBe(2); // both sides executed under the fixture edge
    expect(run.intents.length).toBe(2);
    const buy = run.intents.find((i) => i.action === "BUY_STEEM_WITH_SBD")!;
    expect(buy.receipt.mode).toBe("SIGN-ONLY");
    expect(buy.receipt.broadcast).toBe("DISABLED");
    expect(buy.receipt.kind).toBe("steem-family");
    expect(buy.receipt.txId).toMatch(/^[0-9a-f]{40}$/);
    expect(buy.receipt.wireHex).toBeDefined();
    expect(run.receiptsChain.ok).toBe(true);
    expect(run.ethSol.status).toBe("KEYS-ABSENT-honest");
    // receipts file is hash-chained and public-data-only
    const audit = new HashChainAudit(receiptsPath);
    expect(audit.verify()).toEqual({ ok: true, entries: 2 });
    const raw = fs.readFileSync(receiptsPath, "utf8");
    expect(raw.includes(PrivateKey.fromSeed("arb-fixture-alice-active").toWif())).toBe(false);
    expect(raw).toContain("arb.intent");
  });

  test("HOLD decisions sign NOTHING (zero intents, honest ledger)", async () => {
    const lowEdge: Opportunity = { ...EDGE, spreadBps: 10 };
    const table: OpportunityTable = { ...TABLE, corridors: [{ corridor: "STEEM_SBD_INTERNAL", opportunities: [lowEdge], gaps: [], books: [] }] };
    const { decisions } = planCycle({
      table,
      policy: POLICY,
      states: new Map([["fixture.alice", STATE]]),
      authorities: new Map([["fixture.alice", AUTH]]),
      roster: ["fixture.alice"],
      now: NOW,
    });
    const refBlock = await chain.refBlock();
    const run = await executor.runCycle({ decisions, refBlock, now: NOW, cycleTs: CYCLE_TS + 1 });
    expect(run.intents.length).toBe(0);
    expect(run.ledger.ops).toBe(0);
  });

  test("signing refuses a key whose role is insufficient (hsm role policy active)", async () => {
    // a posting-role key must NOT be able to sign the conversion — the role
    // policy lives in hsm-runtime and the executor relies on it structurally.
    const vaultDir = path.join(dir, "vault2");
    const vault = await openVault({ dir: vaultDir });
    await vault.sealKey({
      id: "army/fixture.posting/active",
      type: "secp256k1-wif",
      material: PrivateKey.fromSeed("arb-fixture-posting-only").toWif(),
      meta: { role: "posting", account: "fixture.posting" },
    });
    const signer = await HsmSigner.open({ vaultDir });
    const exec2 = new ArbExecutor({ policy: POLICY, chain, signer, keyIdFor: () => "army/fixture.posting/active", receiptsPath: path.join(dir, "r2.jsonl") });
    const decision = {
      account: "fixture.posting",
      pair: "STEEM/SBD",
      action: "BUY_STEEM_WITH_SBD" as const,
      spreadBps: 150,
      thresholdBps: 100,
      thresholdSource: "owner-policy" as const,
      sellSatoshis: 1000,
      receiveSatoshis: 9700,
      limitPrice: 0.10241,
      verdict: { kind: "EXECUTE" } as const,
      at: new Date(NOW).toISOString(),
    };
    const refBlock = await chain.refBlock();
    await expect(exec2.runCycle({ decisions: [decision], refBlock, now: NOW, cycleTs: CYCLE_TS + 2 })).rejects.toThrow(/moves funds and cannot be signed with a posting key/);
  });
});

describe("structural side-effect law", () => {
  test("no broadcast path exists in the package source (grep law)", () => {
    const files = ["src/policy.ts", "src/keys.ts", "src/chain.ts", "src/plan.ts", "src/executor.ts", "src/corridors.ts", "src/index.ts"];
    for (const f of files) {
      const src = fs.readFileSync(path.join(import.meta.dir, "..", f), "utf8");
      expect(src.includes("broadcast_transaction")).toBe(false);
      expect(src.includes("broadcastTx")).toBe(false);
      expect(src.includes("network_broadcast")).toBe(false);
    }
  });

  test("buildLimitOrderOp only ever builds internal-market orders with wire-exact assets", () => {
    const op = buildLimitOrderOp({
      account: "fixture.alice",
      orderId: deriveOrderId("fixture.alice", "BUY_STEEM_WITH_SBD", CYCLE_TS),
      sellSatoshis: 5000,
      sellSymbol: "SBD",
      receiveSatoshis: 48823,
      receiveSymbol: "STEEM",
      expirationUnix: Math.floor(NOW / 1000) + 900,
    });
    expect(op.owner).toBe("fixture.alice");
    expect(op.fill_or_kill).toBe(true);
    expect(op.amount_to_sell).toEqual({ amount: 5000n, precision: 3, symbol: "SBD" });
    expect(op.min_to_receive).toEqual({ amount: 48823n, precision: 3, symbol: "STEEM" });
    expect(() => buildLimitOrderOp({ account: "a", orderId: 1, sellSatoshis: 0, sellSymbol: "SBD", receiveSatoshis: 1, receiveSymbol: "STEEM", expirationUnix: 1 })).toThrow(/EXECUTOR_E_ASSET/);
  });

  test("deriveOrderId is deterministic and within uint31", () => {
    const a = deriveOrderId("fixture.alice", "BUY_STEEM_WITH_SBD", CYCLE_TS);
    const b = deriveOrderId("fixture.alice", "BUY_STEEM_WITH_SBD", CYCLE_TS);
    const c = deriveOrderId("fixture.alice", "SELL_STEEM_FOR_SBD", CYCLE_TS);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0x7fffffff);
  });
});

describe("ETH/SOL honest gate (deliverable 3)", () => {
  test("no custody in this runtime → KEYS-ABSENT-honest, never READY", () => {
    const r = ethSolReadiness();
    expect(r.eth.status).toBe("KEYS-ABSENT-honest");
    expect(r.sol.status).toBe("KEYS-ABSENT-honest");
    expect(r.executable).toBe(false);
    expect(r.eth.detail).toContain("no custody directory");
  });
});
