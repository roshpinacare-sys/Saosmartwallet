/**
 * HIVE chain-id oracle — empirical, zero assumption.
 *
 * Takes REAL recent hive transactions (vote/comment/custom_json/transfer
 * family), rebuilds each with our wire-exact packer, and checks under WHICH
 * 32-byte chain id the on-chain signature recovers to one of the signer's
 * on-chain authority keys (posting/active/owner). The chain's own signatures
 * are the oracle. Steem control (zeros) already passed with this pipeline.
 */
import { transactionDigest, type SteemTransaction } from "../packages/chains/steem/src/transaction";
import { recoverFromCompact, steemPublicKeyDecode } from "../packages/crypto/src/index";

const NODE = process.env.RAIL_URL || "https://api.hive.blog";
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

interface Picked {
  tx: Record<string, unknown>;
  opName: string;
  signer: string;
}

async function main(): Promise<void> {
  const dgp = await rpc<{ head_block_number: number }>("condenser_api.get_dynamic_global_properties", []);
  const head = dgp.head_block_number;

  const pickedList: Picked[] = [];
  for (let n = head - 1; n > head - 60 && pickedList.length < 6; n--) {
    const block = await rpc<{ transactions: Array<Record<string, unknown>> }>("condenser_api.get_block", [n]);
    for (const tx of block.transactions ?? []) {
      const ops = (tx.operations as Array<[string, Record<string, unknown>]>) ?? [];
      if (!ops.length || !Array.isArray(tx.signatures) || !(tx.signatures as string[]).length) continue;
      if (!ops.every(([name]) => SUPPORTED.has(name))) continue;
      const [name, body] = ops[0];
      const signer = signerOf(name, body);
      if (!signer) continue;
      pickedList.push({ tx, opName: name, signer });
      if (pickedList.length >= 6) break;
    }
  }
  if (!pickedList.length) throw new Error("לא נמצאה טרנזקציה נתמכת ב-60 הבלוקים האחרונים");

  const candidates: Array<{ label: string; hex: string }> = [
    { label: "zeros", hex: "0".repeat(64) },
    { label: "beeab0de (dhive DEFAULT_CHAIN_ID)", hex: "beeab0de00000000000000000000000000000000000000000000000000000000" },
  ];

  for (const { tx, opName, signer } of pickedList) {
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
      try {
        const digest = transactionDigest(steemTx, new Uint8Array(Buffer.from(cand.hex, "hex")));
        const recovered = recoverFromCompact(sig65, digest);
        const match = pubs.some((p) => Buffer.from(p).equals(Buffer.from(recovered)));
        console.log(`[${opName} @${signer}] ${cand.label}: match=${match}`);
      } catch (e) {
        console.log(`[${opName} @${signer}] ${cand.label}: recovery failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ORACLE FAIL:", e.message); process.exit(1); });
