/**
 * r16 — account_update WIRE ORACLE (gap-58 ground work).
 * The strongest possible proof without broadcasting: the NODE'S OWN SERIALIZER
 * (condenser_api.get_transaction_hex) must accept our op shape and return the
 * BIT-EXACT bytes our engine produces. The tx carries the account's CURRENT
 * live owner authority (read-only from RPC) — nothing broadcast, zero keys.
 * Also proven: deserialize→serialize roundtrip + tamper-sensitivity.
 */
import { serializeTransaction, deserializeTransaction, transactionId, type SteemTransaction } from "@/lib/steem-engine";
import type { AccountUpdateOperation, SteemAuthority } from "@/lib/steem-engine";

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

function wireToApiAuth(a: SteemAuthority) {
  return {
    weight_threshold: a.weight_threshold,
    account_auths: a.account_auths.map((p) => [p.account, p.weight]),
    key_auths: a.key_auths.map((k) => [k.pub, k.weight]),
  };
}

async function main() {
  const [acct] = await rpc<any[]>("condenser_api.get_accounts", [["headcorner"]]);
  const owner: SteemAuthority = {
    weight_threshold: Number(acct.owner.weight_threshold),
    account_auths: (acct.owner.account_auths ?? []).map(([account, weight]: [string, number]) => ({ account, weight: Number(weight) })),
    key_auths: (acct.owner.key_auths ?? []).map(([pub, weight]: [string, number]) => ({ pub: String(pub), weight: Number(weight) })),
  };
  const op: AccountUpdateOperation = { account: "headcorner", owner, memo_key: String(acct.memo_key), json_metadata: "" };

  const proto = await rpc<any>("condenser_api.get_dynamic_global_properties", []);
  const refBlockNum = proto.head_block_number & 0xffff;
  const refBlockPrefix = Buffer.from(proto.head_block_id.slice(8, 16), "hex").readUInt32LE(0);
  const expiration = Math.floor(new Date(proto.time).getTime() / 1000) + 300;

  const ourTx: SteemTransaction = { refBlockNum, refBlockPrefix, expiration, operations: [{ name: "account_update", body: op }] };
  // Digest serializer = the tx MESSAGE struct (no signatures vector — chain-proven
  // in r7/r12 live broadcasts). get_transaction_hex returns the SIGNED_TRANSACTION
  // wire which appends extensions(0) + signatures(0); append the empty sigs byte
  // on our side to align the two representations before comparing.
  const ourHex = Buffer.from(serializeTransaction(ourTx)).toString("hex") + "00";

  const apiTx = {
    ref_block_num: refBlockNum, ref_block_prefix: refBlockPrefix,
    expiration: new Date(expiration * 1000).toISOString().slice(0, 19),
    operations: [["account_update", { account: op.account, owner: wireToApiAuth(owner), memo_key: op.memo_key, json_metadata: "" }]],
    signatures: [],
  };
  const nodeHex = await rpc<string>("condenser_api.get_transaction_hex", [apiTx]);

  console.log(`ours  (${ourHex.length / 2}B): ${ourHex}`);
  console.log(`node  (${nodeHex.length / 2}B): ${nodeHex}`);
  const bit = ourHex === nodeHex;
  console.log(`\nBIT-EXACT vs node serializer: ${bit ? "✅ PROVEN" : "❌ MISMATCH"}`);
  console.log(`txId (ours): ${transactionId(ourTx)}`);

  // roundtrip through OUR deserializer
  const rt = deserializeTransaction(Buffer.from(ourHex.slice(0, -2), "hex")); // roundtrip on the message struct (sans sigs byte)
  const rtHex = Buffer.from(serializeTransaction(rt)).toString("hex") + "00";
  console.log(`roundtrip (deserialize→serialize): ${rtHex === ourHex ? "✅" : "❌"}`);
  const rtOp = rt.operations[0].body as AccountUpdateOperation;
  console.log(`roundtrip body: account=${rtOp.account} ownerThreshold=${rtOp.owner?.weight_threshold} keyAuths=${rtOp.owner?.key_auths.length} memo=${rtOp.memo_key?.slice(0, 12)}…`);

  // tamper-sensitivity: payload change ⇒ different txId (evidence is live, not constant)
  const t2: SteemTransaction = { ...ourTx, operations: [{ name: "account_update", body: { ...op, json_metadata: "x" } }] };
  console.log(`tamper-sensitivity: ${transactionId(ourTx) !== transactionId(t2) ? "✅" : "❌"}`);

  if (!bit) process.exitCode = 1;
}
main();
