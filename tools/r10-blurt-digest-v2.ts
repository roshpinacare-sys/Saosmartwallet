/** r10 v2 — digest variants incl. empty-sig-vector placeholder byte. */
import crypto from "crypto";
import { recoverFromCompact, steemPublicKeyDecode } from "../packages/crypto/src/index";
const NODE = "https://blurt-rpc.saboin.com";
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result as T;
}
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const IDS: Array<[string, Buffer]> = [
  ["zeros", Buffer.alloc(32)],
  ["cd8d90f2", Buffer.from("cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f", "hex")],
  ["beeab0de", Buffer.from("beeab0de00000000000000000000000000000000000000000000000000000000", "hex")],
  ["79276aea", Buffer.from("79276aea5d4877d9a25892eaa01b0adf019d3e5cb12a97478df3298ccdd01674", "hex")],
];
const head = (await rpc<{ head_block_number: number }>("condenser_api.get_dynamic_global_properties", [])).head_block_number;
let done = 0;
for (let n = head - 2; n > head - 60 && done < 2; n--) {
  const block = await rpc<{ transactions: Array<any> }>("condenser_api.get_block", [n]);
  for (const tx of block.transactions ?? []) {
    if (done >= 2) break;
    const sigs: string[] = tx.signatures ?? [];
    if (sigs.length !== 1) continue;
    const ops = (tx.operations as Array<[string, Record<string, unknown>]>) ?? [];
    if (!ops.length || ops[0][0] !== "vote") continue; // vote: no op-id ambiguity
    const fullHex = await rpc<string | { hex: string }>("condenser_api.get_transaction_hex", [tx]);
    const hexs = typeof fullHex === "string" ? fullHex : String((fullHex as { hex: string }).hex ?? "");
    if (!hexs) continue;
    const full = Buffer.from(hexs, "hex");
    const sig = full.subarray(full.length - 65);
    const noCount = full.subarray(0, full.length - 66);
    const body = tx.operations[0][1];
    const signer = String(body?.voter ?? "");
    const accs = await rpc<Array<{ posting?: { key_auths?: Array<[string, number]> }; active?: { key_auths?: Array<[string, number]> }; owner?: { key_auths?: Array<[string, number]> } }>>("condenser_api.get_accounts", [[signer]]);
    const pubs: Uint8Array[] = [];
    for (const role of ["posting", "active", "owner"] as const) {
      for (const [k] of accs?.[0]?.[role]?.key_auths ?? []) { try { pubs.push(steemPublicKeyDecode(String(k), ["STM","TST","HIVE","BLURT","BLT"])); } catch { /* */ } }
    }
    const variants: Array<[string, Buffer]> = [
      ["noCount", noCount],
      ["noCount+0x00", Buffer.concat([noCount, Buffer.from([0])])],
      ["noCount+0x01", Buffer.concat([noCount, Buffer.from([1])])],
    ];
    console.log(`blk ${n} vote @${signer} wire=${full.length}B noCount=${noCount.length}B`);
    for (const [vl, payload] of variants) {
      for (const [il, iv] of IDS) {
        const digest = sha256(Buffer.concat([iv, payload]));
        let m = "fail";
        try { const rec = recoverFromCompact(new Uint8Array(sig), new Uint8Array(digest)); m = pubs.some((p) => Buffer.from(p).equals(Buffer.from(rec))) ? "MATCH" : "no"; } catch (e) { m = "err:" + (e as Error).message.slice(0, 20); }
        console.log(`   ${vl} × ${il}: ${m}`);
      }
    }
    done++;
  }
}
