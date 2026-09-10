/** r16 probe: node's account_update binary contract — memo absent + account_auths pair. */
const NODES = ["https://api.steemit.com", "https://api.justyy.com"];
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of NODES) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = (await res.json()) as any;
      if (j.error) { last = j.error.message; continue; }
      return j.result as T;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`rpc down: ${last}`);
}
async function main() {
  const proto = await rpc<any>("condenser_api.get_dynamic_global_properties", []);
  const env = {
    ref_block_num: proto.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(proto.head_block_id.slice(8, 16), "hex").readUInt32LE(0),
    expiration: new Date((Math.floor(new Date(proto.time).getTime() / 1000) + 300) * 1000).toISOString().slice(0, 19),
  };
  const [acct] = await rpc<any[]>("condenser_api.get_accounts", [["headcorner"]]);

  // B: memo ABSENT — does the node emit a flag byte / error?
  const opB = {
    account: "headcorner",
    owner: { weight_threshold: 1, account_auths: [], key_auths: [[String(acct.owner.key_auths[0][0]), 1]] },
    json_metadata: "",
  };
  try {
    const hexB = await rpc<string>("condenser_api.get_transaction_hex", [{ ...env, operations: [["account_update", opB]], signatures: [] }]);
    console.log(`B (memo absent): ${hexB}`);
  } catch (e) { console.log(`B (memo absent): ERROR ${(e as Error).message}`); }

  // C: memo null
  try {
    const hexC = await rpc<string>("condenser_api.get_transaction_hex", [{ ...env, operations: [["account_update", { ...opB, memo_key: null }]], signatures: [] }]);
    console.log(`C (memo null):   ${hexC}`);
  } catch (e) { console.log(`C (memo null):   ERROR ${(e as Error).message}`); }

  // D: owner authority with account_auths pair + json_metadata string
  const opD = {
    account: "headcorner",
    owner: { weight_threshold: 2, account_auths: [["ynet", 1]], key_auths: [[String(acct.owner.key_auths[0][0]), 1]] },
    memo_key: String(acct.memo_key),
    json_metadata: '{"app":"saos"}',
  };
  try {
    const hexD = await rpc<string>("condenser_api.get_transaction_hex", [{ ...env, operations: [["account_update", opD]], signatures: [] }]);
    console.log(`D (acct_auths+json): ${hexD}`);
  } catch (e) { console.log(`D: ERROR ${(e as Error).message}`); }
}
main();

export {};
