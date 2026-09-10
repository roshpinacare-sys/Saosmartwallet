/** r10 — map the tx_id formula on steem (control) and blurt (target). */
import crypto from "crypto";
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const r160 = (b: Buffer) => crypto.createHash("ripemd160").update(b).digest();

async function rpc<T>(node: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result as T;
}

async function probe(label: string, node: string) {
  const dgp = await rpc<{ head_block_number: number }>(node, "condenser_api.get_dynamic_global_properties", []);
  const head = dgp.head_block_number;
  for (let n = head - 2; n > head - 40; n--) {
    const block = await rpc<{ transactions: Array<any> }>(node, "condenser_api.get_block", [n]);
    for (const tx of block.transactions ?? []) {
      const sigs: string[] = tx.signatures ?? [];
      if (sigs.length !== 1) continue;
      const fullHex = await rpc<string | { hex: string }>(node, "condenser_api.get_transaction_hex", [tx]);
      const hexs = typeof fullHex === "string" ? fullHex : String((fullHex as { hex: string }).hex ?? "");
      if (!hexs) continue;
      const full = Buffer.from(hexs, "hex");
      if (full.length < 66) continue;
      const noCount = full.subarray(0, full.length - 66);
      const withCount = full.subarray(0, full.length - 65);
      const variants: Array<[string, string]> = [
        ["r160(s256(full))", r160(sha256(full)).subarray(0, 20).toString("hex")],
        ["r160(s256(withCount))", r160(sha256(withCount)).subarray(0, 20).toString("hex")],
        ["r160(s256(noCount))", r160(sha256(noCount)).subarray(0, 20).toString("hex")],
        ["s256(full)[:20]", sha256(full).subarray(0, 20).toString("hex")],
        ["r160(full)[:20]", r160(full).subarray(0, 20).toString("hex")],
      ];
      const claimed = String(tx.transaction_id);
      const hit = variants.find(([, v]) => v === claimed);
      console.log(`[${label}] blk ${n} claimed=${claimed}`);
      for (const [vl, v] of variants) console.log(`   ${vl} = ${v}${v === claimed ? "   ← MATCH" : ""}`);
      if (!hit) console.log("   *** NO VARIANT MATCHED ***");
      return;
    }
  }
}

await probe("STEEM", "https://api.steemit.com");
await probe("BLURT", "https://blurt-rpc.saboin.com");
