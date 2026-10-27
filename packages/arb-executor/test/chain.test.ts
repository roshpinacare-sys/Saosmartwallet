/**
 * arb-executor — chain reads (injected rpc, zero network)
 * Fixture shapes = live node measurements (api.steemit.com, 2026-10-27):
 * head_block_id 8-byte hex; balances "0.327 STEEM"; rc_api manabar integers.
 */
import { describe, expect, test } from "bun:test";

import { ChainReader } from "../src/chain";

const HEAD_ID = "00e3f2b94d2c1a7b8c9d0e1f2a3b4c5d6e7f8091"; // 20-byte hex, bytes 4..8 = 4d2c1a7b
const HEAD = 0x00e3f2b9;

function rpcFor(routes: Record<string, unknown>) {
  return async (_endpoint: string, method: string, _params: unknown) => {
    const r = routes[method];
    if (r === undefined) throw new Error(`no fixture for ${method}`);
    return r;
  };
}

describe("ChainReader.refBlock (graphene tapos derivation)", () => {
  test("refBlockNum = head & 0xffff; prefix = block-id bytes 4..8 LE", async () => {
    const r = new ChainReader({
      endpoint: "https://api.steemit.com",
      rpc: rpcFor({
        "condenser_api.get_dynamic_global_properties": { head_block_number: HEAD, head_block_id: HEAD_ID, time: "2026-10-27T12:40:00" },
      }),
    });
    const rb = await r.refBlock();
    expect(rb.refBlockNum).toBe(HEAD & 0xffff);
    expect(rb.refBlockPrefix).toBe(0x7b1a2c4d); // LE read of 4d2c1a7b
  });

  test("missing head data is an honest throw", async () => {
    const r = new ChainReader({
      endpoint: "e",
      rpc: rpcFor({ "condenser_api.get_dynamic_global_properties": { head_block_number: 0, head_block_id: "short" } }),
    });
    await expect(r.refBlock()).rejects.toThrow(/CHAIN_E_REF_BLOCK/);
  });
});

describe("ChainReader.accountState", () => {
  test("parses the measured balance/authority/RC shapes", async () => {
    const r = new ChainReader({
      endpoint: "e",
      rpc: rpcFor({
        "condenser_api.get_accounts": [
          {
            name: "fixture.alice",
            balance: "12.345 STEEM",
            sbd_balance: "6.780 SBD",
            active: { key_auths: [["STM5fixture", 1], ["STM6fixture", 1]], weight_threshold: 1 },
          },
        ],
        "rc_api.find_rc_accounts": {
          rc_accounts: [{ account: "fixture.alice", max_rc: "1000000", rc_manabar: { current_mana: "923456" } }],
        },
      }),
    });
    const s = await r.accountState("fixture.alice");
    expect(s.steemSatoshis).toBe(12345);
    expect(s.sbdSatoshis).toBe(6780);
    expect(s.activePubkeys).toEqual(["STM5fixture", "STM6fixture"]);
    expect(s.rcPercent).toBeCloseTo(92.35, 1);
  });

  test("RC unreadable → honest null (planner treats as unknown)", async () => {
    const r = new ChainReader({
      endpoint: "e",
      rpc: rpcFor({
        "condenser_api.get_accounts": [{ name: "fixture.alice", balance: "1.000 STEEM", sbd_balance: "0.000 SBD", active: { key_auths: [] } }],
      }),
    });
    const s = await r.accountState("fixture.alice");
    expect(s.rcPercent).toBeNull();
  });
});

describe("ChainReader.verifyActiveAuthority (custody vs chain)", () => {
  const routes = {
    "condenser_api.get_accounts": [
      {
        name: "fixture.alice",
        balance: "1.000 STEEM",
        sbd_balance: "0.000 SBD",
        active: { key_auths: [["STMGood", 1]], weight_threshold: 1 },
      },
    ],
  };

  test("present pubkey → ok verdict", async () => {
    const r = new ChainReader({ endpoint: "e", rpc: rpcFor(routes) });
    const v = await r.verifyActiveAuthority("fixture.alice", "STMGood");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.matchedKeys).toBe(1);
  });

  test("absent pubkey → honest mismatch (the custody-wound class)", async () => {
    const r = new ChainReader({ endpoint: "e", rpc: rpcFor(routes) });
    const v = await r.verifyActiveAuthority("fixture.alice", "STMRotated");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("drifted off-vault");
  });
});
