/** r10 — digest formula hunt: validate tx_id formula, then test digest variants × chain ids. */
import crypto from "crypto";
import { recoverFromCompact, steemPublicKeyDecode } from "../packages/crypto/src/index";

const NODE = "https://blurt-rpc.saboin.com";
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result as T;
}
const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest();

const dgp = await rpc<{ head_block_number: number }>("condenser_api.get_dynamic_global_properties", []);
const head = dgp.head_block_number;

const IDS = new Map<string, Buffer>([
  ["zeros", Buffer.alloc(32)],
  ["hive", Buffer.from("beeab0de00000000000000000000000000000000000000000000000000000000", "hex")],
  ["letsblurt", Buffer.from("cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f", "hex")],
  ["blurtpy", Buffer.from("79276aea5d4877d9a25892eaa01b0adf019d3e5cb12a97478df3298ccdd01674", "hex")],
]);

let done = 0;
for (let n = head - 2; n > head - 40 && done < 3; n--) {
  const block = await rpc<{ transactions: Array<any> }>("condenser_api.get_block", [n]);
  for (const tx of block.transactions ?? []) {
    if (done >= 3) break;
    const sigs: string[] = tx.signatures ?? [];
    if (sigs.length !== 1) continue;
    const fullHex = await rpc<string | { hex: string }>("condenser_api.get_transaction_hex", [tx]);
    const hexs = typeof fullHex === "string" ? fullHex : String((fullHex as { hex: string }).hex ?? "");
    if (!hexs) continue;
    const full = Buffer.from(hexs, "hex");
    if (full.length < 66) continue;
    // 1) validate wire understanding: tx_id = ripemd160(sha256(full))[:20]?
    const idFromFull = crypto.createHash("ripemd160").update(sha256(full)).digest().subarray(0, 20).toString("hex");
    console.log(`tx_id formula (full wire): claimed=${tx.transaction_id} computed=${idFromFull} ${tx.transaction_id === idFromFull ? "MATCH" : "differs"}`);
    const sig = full.subarray(full.length - 65);
    const noCount = full.subarray(0, full.length - 66); // without sig + sigcount
    const withCount = full.subarray(0, full.length - 65); // without sig, with sigcount
    const [opName, body] = (tx.operations?.[0] ?? []) as [string, Record<string, unknown>];
    const signer = String(body?.voter ?? body?.author ?? (body?.required_posting_auths as string[])?.[0] ?? body?.from ?? "");
    if (!signer) continue;
    const accs = await rpc<Array<{ posting?: { key_auths?: Array<[string, number]> }; active?: { key_auths?: Array<[string, number]> }; owner?: { key_auths?: Array<[string, number]> } }>>("condenser_api.get_accounts", [[signer]]);
    const pubs: Uint8Array[] = [];
    for (const role of ["posting", "active", "owner"] as const) {
      for (const [k] of accs?.[0]?.[role]?.key_auths ?? []) { try { pubs.push(steemPublicKeyDecode(String(k), ["STM","TST","HIVE","BLURT"])); } catch { /* */ } }
    }
    const forms: Array<[string, Buffer]> = [
      ["wire(noCount)", noCount],
      ["wire(withCount)", withCount],
    ];
    for (const [fl, payload] of forms) {
      // variant A: sha256(id || payload)
      for (const [il, iv] of IDS) {
        const digest = sha256(Buffer.concat([iv, payload]));
        let m = false;
        try { const rec = recoverFromCompact(new Uint8Array(sig), new Uint8Array(digest)); m = pubs.some((p) => Buffer.from(p).equals(Buffer.from(rec))); } catch { /* */ }
        console.log(`  ${fl} + id[${il}]: match=${m}`);
      }
      // variant B: sha256(payload) — no chain id at all
      let m = false;
      try { const rec = recoverFromCompact(new Uint8Array(sig), new Uint8Array(sha256(payload))); m = pubs.some((p) => Buffer.from(p).equals(Buffer.from(rec))); } catch { /* */ }
      console.log(`  ${fl} + NO-id: match=${m}`);
    }
    done++;
  }
}
