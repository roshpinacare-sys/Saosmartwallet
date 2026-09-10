/** Is my serialization byte-identical to blurt's wire format? (r10) */
import { serializeTransaction, type SteemTransaction } from "../packages/chains/steem/src/transaction";

const NODE = "https://blurt-rpc.saboin.com";

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result as T;
}

function toUnix(exp: string): number {
  const compact = /^\d{8}T\d{6}$/;
  let iso = exp;
  if (compact.test(exp)) iso = `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}T${exp.slice(9, 11)}:${exp.slice(11, 13)}:${exp.slice(13, 15)}Z`;
  return Math.floor(Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`) / 1000);
}

const dgp = await rpc<{ head_block_number: number }>("condenser_api.get_dynamic_global_properties", []);
const head = dgp.head_block_number;

for (let n = head - 2; n > head - 100; n--) {
  const block = await rpc<{ transactions: Array<Record<string, unknown>> }>("condenser_api.get_block", [n]);
  for (const tx of block.transactions ?? []) {
    const ops = (tx.operations as Array<[string, Record<string, unknown>]>) ?? [];
    if (!ops.length || !(tx.signatures as string[])?.length) continue;
    if (!ops.every(([nm]) => ["vote", "comment", "custom_json"].includes(nm))) continue;
    const steemTx: SteemTransaction = {
      refBlockNum: Number(tx.ref_block_num),
      refBlockPrefix: Number(tx.ref_block_prefix),
      expiration: toUnix(String(tx.expiration)),
      operations: ops.map(([name, body]) => ({ name, body })) as unknown as SteemTransaction["operations"],
    };
    let mine = "";
    try {
      mine = Buffer.from(serializeTransaction(steemTx)).toString("hex");
    } catch (e) {
      console.log(`blk ${n} pack fail: ${ops.map((o) => o[0]).join("+")} → ${(e as Error).message}`);
      continue;
    }
    let wire = "";
    try {
      const r = await rpc<string | { hex: string }>("condenser_api.get_transaction_hex", [tx]);
      wire = typeof r === "string" ? r : String((r as { hex: string }).hex ?? "");
    } catch {
      continue;
    }
    if (!wire) continue;
    const sig = String((tx.signatures as string[])[0]);
    console.log(`blk ${n} ops=${ops.map((o) => o[0]).join("+")}`);
    console.log(`  mine=${mine}`);
    console.log(`  wire=${wire.slice(0, mine.length)}`);
    console.log(`  bodyMatch=${wire.startsWith(mine)} (sig ${(sig.length / 2) | 0}B → expected wire ${(mine.length + sig.length) / 2}B vs actual ${wire.length / 2}B)`);
    process.exit(0);
  }
}
console.log("no comparable tx found in last 100 blocks");
