/**
 * BLURT chain-id oracle — empirical, zero assumption (r10).
 * Reuses the hive oracle pipeline: recover on-chain signatures under each
 * candidate chain id and compare to the signer's live authority keys.
 */
import { transactionDigest, type SteemTransaction } from "../packages/chains/steem/src/transaction";
import { recoverFromCompact, steemPublicKeyDecode } from "../packages/crypto/src/index";

const NODE = "https://blurt-rpc.saboin.com";
const SUPPORTED = new Set(["vote", "comment", "custom_json", "transfer", "limit_order_create", "limit_order_cancel"]);

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NODE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result as T;
}

function toUnix(exp: string): number {
  const compact = /^\d{8}T\d{6}$/;
  let iso = exp;
  if (compact.test(exp)) iso = `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}T${exp.slice(9, 11)}:${exp.slice(11, 13)}:${exp.slice(13, 15)}Z`;
  const ms = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Math.floor(ms / 1000);
}

function signerOf(opName: string, body: Record<string, unknown>): string {
  if (opName === "vote") return String(body.voter);
  if (opName === "comment") return String(body.author);
  if (opName === "custom_json") return String(((body.required_posting_auths as string[]) ?? [])[0] ?? "");
  return String(body.from ?? body.owner ?? "");
}

async function main(): Promise<void> {
  const dgp = await rpc<{ head_block_number: number }>("condenser_api.get_dynamic_global_properties", []);
  const head = dgp.head_block_number;
  console.log("blurt head block:", head);

  const picked: Array<{ tx: Record<string, unknown>; opName: string; signer: string }> = [];
  for (let n = head - 1; n > head - 120 && picked.length < 6; n--) {
    const block = await rpc<{ transactions: Array<Record<string, unknown>> }>("condenser_api.get_block", [n]);
    for (const tx of block.transactions ?? []) {
      const ops = (tx.operations as Array<[string, Record<string, unknown>]>) ?? [];
      if (!ops.length || !Array.isArray(tx.signatures) || !(tx.signatures as string[]).length) continue;
      if (!ops.every(([name]) => SUPPORTED.has(name))) continue;
      const [name, body] = ops[0];
      const signer = signerOf(name, body);
      if (!signer) continue;
      picked.push({ tx, opName: name, signer });
      if (picked.length >= 6) break;
    }
  }
  if (!picked.length) throw new Error("no supported tx in last 120 blocks");

  const candidates: Array<{ label: string; hex: string }> = [
    { label: "zeros", hex: "0".repeat(64) },
    { label: "beeab0de (hive)", hex: "beeab0de00000000000000000000000000000000000000000000000000000000" },
    { label: "cd8d90f2 (letsblurt mainnet)", hex: "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f" },
    { label: "79276aea (blurtpy/MTN)", hex: "79276aea5d4877d9a25892eaa01b0adf019d3e5cb12a97478df3298ccdd01674" },
  ].filter((c) => c.hex.length === 64);

  const tallies = new Map<string, { match: number; total: number }>();
  for (const { tx, opName, signer } of picked) {
    const accounts = await rpc<Array<{
      posting?: { key_auths?: Array<[string, number]> };
      active?: { key_auths?: Array<[string, number]> };
      owner?: { key_auths?: Array<[string, number]> };
    }>>("condenser_api.get_accounts", [[signer]]);
    const acc = accounts?.[0] ?? {};
    const pubs: Uint8Array[] = [];
    for (const role of ["posting", "active", "owner"] as const) {
      for (const [k] of acc[role]?.key_auths ?? []) {
        try { pubs.push(steemPublicKeyDecode(String(k), ["STM", "TST", "HIVE", "BLURT"])); } catch { /* skip */ }
      }
    }
    const steemTx: SteemTransaction = {
      refBlockNum: Number(tx.ref_block_num),
      refBlockPrefix: Number(tx.ref_block_prefix),
      expiration: toUnix(String(tx.expiration)),
      operations: ((tx.operations as Array<[string, Record<string, unknown>]>)).map(([name, body]) => ({ name, body })) as unknown as SteemTransaction["operations"],
    };
    const sig65 = new Uint8Array(Buffer.from(String((tx.signatures as string[])[0]), "hex"));
    for (const cand of candidates) {
      const t = tallies.get(cand.label) ?? { match: 0, total: 0 };
      t.total++;
      try {
        const digest = transactionDigest(steemTx, new Uint8Array(Buffer.from(cand.hex, "hex")));
        const recovered = recoverFromCompact(sig65, digest);
        const match = pubs.some((p) => Buffer.from(p).equals(Buffer.from(recovered)));
        if (match) t.match++;
        console.log(`[${opName} @${signer}] ${cand.label}: match=${match}`);
      } catch (e) {
        console.log(`[${opName} @${signer}] ${cand.label}: recovery failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      tallies.set(cand.label, t);
    }
  }
  console.log("\nTALLY:");
  for (const [label, t] of tallies) console.log(`  ${label}: ${t.match}/${t.total}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("ORACLE FAIL:", e.message); process.exit(1); });
