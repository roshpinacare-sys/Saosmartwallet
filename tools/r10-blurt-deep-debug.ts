/** r10 deep-debug: local vote serialization vs blurt wire + all-recid recovery. */
import crypto from "crypto";
import { serializeTransaction, type SteemTransaction } from "../packages/chains/steem/src/transaction";
import { recoverFromCompact, steemPublicKeyDecode } from "../packages/crypto/src/index";
const NODE = "https://blurt-rpc.saboin.com";
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result as T;
}
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
function toUnix(exp: string): number { return Math.floor(Date.parse(exp.endsWith("Z") ? exp : `${exp}Z`) / 1000); }

const head = (await rpc<{ head_block_number: number }>("condenser_api.get_dynamic_global_properties", [])).head_block_number;
outer: for (let n = head - 2; n > head - 60; n--) {
  const block = await rpc<{ transactions: Array<any> }>("condenser_api.get_block", [n]);
  for (const tx of block.transactions ?? []) {
    const sigs: string[] = tx.signatures ?? [];
    if (sigs.length !== 1) continue;
    const ops = (tx.operations as Array<[string, Record<string, unknown>]>) ?? [];
    if (ops.length !== 1 || ops[0][0] !== "vote") continue;
    const fullHex = await rpc<string | { hex: string }>("condenser_api.get_transaction_hex", [tx]);
    const hexs = typeof fullHex === "string" ? fullHex : String((fullHex as { hex: string }).hex ?? "");
    const full = Buffer.from(hexs, "hex");
    const noCount = full.subarray(0, full.length - 66);
    // local serialization of the same vote
    const steemTx: SteemTransaction = {
      refBlockNum: Number(tx.ref_block_num), refBlockPrefix: Number(tx.ref_block_prefix),
      expiration: toUnix(String(tx.expiration)),
      operations: [{ name: "vote", body: ops[0][1] }] as unknown as SteemTransaction["operations"],
    };
    const mine = Buffer.from(serializeTransaction(steemTx));
    console.log("local vote wire :", mine.toString("hex"));
    console.log("node  vote wire :", noCount.toString("hex"));
    console.log("identical:", mine.equals(noCount), "| lens:", mine.length, noCount.length);
    // sig header
    const sig = full.subarray(full.length - 65);
    console.log("sig header byte:", sig[0]);
    // digest with official id, try all recids via header overrides
    const ID = Buffer.from("cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f", "hex");
    const digest = sha256(Buffer.concat([ID, noCount]));
    const signer = String(ops[0][1]?.voter ?? "");
    const accs = await rpc<Array<{ posting?: { key_auths?: Array<[string, number]> }; active?: { key_auths?: Array<[string, number]> }; owner?: { key_auths?: Array<[string, number]> } }>>("condenser_api.get_accounts", [[signer]]);
    const pubs: Uint8Array[] = [];
    for (const role of ["posting", "active", "owner"] as const) {
      for (const [k] of accs?.[0]?.[role]?.key_auths ?? []) { try { pubs.push(steemPublicKeyDecode(String(k), ["STM","TST","HIVE","BLURT"])); } catch { /* */ } }
    }
    console.log("authority pubs:", pubs.length);
    for (const base of [27, 31]) {
      for (let recid = 0; recid < 4; recid++) {
        const s2 = Buffer.from(sig);
        s2[0] = base + recid;
        try {
          const rec = recoverFromCompact(new Uint8Array(s2), new Uint8Array(digest));
          const match = pubs.some((p) => Buffer.from(p).equals(Buffer.from(rec)));
          console.log(`  base=${base} recid=${recid}: ${match ? "*** MATCH ***" : "no"}`);
          if (match) break outer;
        } catch (e) { console.log(`  base=${base} recid=${recid}: err ${(e as Error).message.slice(0, 40)}`); }
      }
    }
    process.exit(0);
  }
}
