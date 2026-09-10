/**
 * r10 — PURE blurt chain-id oracle: no re-serialization at all.
 * digest = sha256(chain_id || unsigned_tx_wire) directly from the node's own
 * get_transaction_hex output (strip sig-count + signatures). Recover each
 * on-chain signature and compare to the signer's live authority keys.
 */
import crypto from "crypto";
import { recoverFromCompact, steemPublicKeyDecode } from "../packages/crypto/src/index";

const NODE = "https://blurt-rpc.saboin.com";
const CANDIDATES: Array<{ label: string; hex: string }> = [
  { label: "zeros", hex: "0".repeat(64) },
  { label: "hive beeab0de", hex: "beeab0de00000000000000000000000000000000000000000000000000000000" },
  { label: "cd8d90f2 (letsblurt)", hex: "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f" },
  { label: "79276aea (blurtpy)", hex: "79276aea5d4877d9a25892eaa01b0adf019d3e5cb12a97478df3298ccdd01674" },
];

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result as T;
}

const dgp = await rpc<{ head_block_number: number }>("condenser_api.get_dynamic_global_properties", []);
const head = dgp.head_block_number;
console.log("blurt head:", head);

const tallies = new Map<string, { match: number; total: number }>();
let tested = 0;

for (let n = head - 2; n > head - 40 && tested < 5; n--) {
  const block = await rpc<{ transactions: Array<any> }>("condenser_api.get_block", [n]);
  for (const tx of block.transactions ?? []) {
    if (tested >= 5) break;
    const sigs: string[] = tx.signatures ?? [];
    if (!sigs.length) continue;
    const fullHex = await rpc<string | { hex: string }>("condenser_api.get_transaction_hex", [tx]);
    const hexs = typeof fullHex === "string" ? fullHex : String((fullHex as { hex: string }).hex ?? "");
    if (!hexs) continue;
    const full = Buffer.from(hexs, "hex");
    if (full.length < 66) continue;
    // strip the 65B signature; the byte just before it should be the sig-count varint
    const sig = full.subarray(full.length - 65);
    const beforeSig = full.subarray(0, full.length - 65);
    const unsigned = beforeSig.subarray(0, beforeSig.length - 1); // drop sig-count byte
    // signer guess from first op
    const [opName, body] = (tx.operations as Array<[string, Record<string, unknown>]>, tx.operations?.[0] ?? []) as [string, Record<string, unknown>];
    const signer = String(body?.voter ?? body?.author ?? (body?.required_posting_auths as string[])?.[0] ?? body?.from ?? "");
    if (!signer) continue;
    const accs = await rpc<Array<{ posting?: { key_auths?: Array<[string, number]> }; active?: { key_auths?: Array<[string, number]> }; owner?: { key_auths?: Array<[string, number]> } }>>("condenser_api.get_accounts", [[signer]]);
    const acc = accs?.[0] ?? {};
    const pubs: Uint8Array[] = [];
    for (const role of ["posting", "active", "owner"] as const) {
      for (const [k] of acc[role]?.key_auths ?? []) {
        try { pubs.push(steemPublicKeyDecode(String(k), ["STM", "TST", "HIVE", "BLURT", "BLT"])); } catch { /* skip */ }
      }
    }
    for (const cand of CANDIDATES) {
      const t = tallies.get(cand.label) ?? { match: 0, total: 0 };
      t.total++;
      try {
        const digest = crypto.createHash("sha256").update(Buffer.from(cand.hex, "hex")).update(unsigned).digest();
        const rec = recoverFromCompact(new Uint8Array(sig), new Uint8Array(digest));
        const match = pubs.some((p) => Buffer.from(p).equals(Buffer.from(rec)));
        if (match) t.match++;
        console.log(`blk ${n} ${opName} @${signer} ${cand.label}: match=${match}`);
      } catch (e) {
        console.log(`blk ${n} ${opName} @${signer} ${cand.label}: recover fail ${(e as Error).message}`);
      }
      tallies.set(cand.label, t);
    }
    tested++;
  }
}
console.log("\nTALLY (unsigned-wire digest):");
for (const [label, t] of tallies) console.log(`  ${label}: ${t.match}/${t.total}`);
