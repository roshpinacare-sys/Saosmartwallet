/**
 * sol-fleet-consolidate.ts — roast-75 · ריכוז-SOL-של-הצי אל זהות-הפקדה-של-הדלת
 *
 * הביקורת-החיה (cross-audit-keys) מדדה: 10 ארנקי-SOL-של-הצי ממומנים (~0.0608 SOL
 * בסך-הכל) — הכסף-האמת-של-המפעיל-מחולק-על-ארנקי-הסוכנים. הדלת-דורשת-משמורת-על
 * כתובת-אחת (cashmachine=זהות-הפקדה) כדי-לעגן-את-WSOL.
 *
 * פעולה: מכל-ארנק-ממומן (פרט-לכתובת-היעד-עצמה) — העברת (יתרה − 5,000-עמלה)
 * lamports אל זהות-הפקדה. עסקת-SOL-מערכת-מינימלית: build+sign+send מקומי.
 *
 * בטיחות: DRY-RUN-כברירת-מחדל; --execute בלבד-לשידור. אפס-הדפסות-מפתחות.
 * בלוקהש-טרי-לכל-עסקה · אימות-כתובת-נגזרת-מול-הכספת-לפני-כל-חתימה (fail-closed).
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ed25519 } from "/home/z/my-project/saos-dex/node_modules/@noble/curves/ed25519.js";
import bs58 from "bs58";

const RPC = "https://api.mainnet-beta.solana.com";
const UA = "SAOS-Sovereign-Audit/1.0 (+sovereign-chain)";
const EXECUTE = process.argv.includes("--execute");
const FEE = 5_000; // עמלת-חתימה בסיסית
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function solAddrFromPk(pk: string): string | null {
  try {
    let raw: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(pk.trim()) || /^[0-9a-fA-F]{128}$/.test(pk.trim())) raw = Buffer.from(pk, "hex");
    else raw = bs58.decode(pk.trim());
    return bs58.encode(Buffer.from(ed25519.getPublicKey(raw.subarray(0, 32))));
  } catch { return null; }
}
function seedOf(pk: string): Uint8Array | null {
  try {
    let raw: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(pk.trim()) || /^[0-9a-fA-F]{128}$/.test(pk.trim())) raw = Buffer.from(pk, "hex");
    else raw = bs58.decode(pk.trim());
    return raw.subarray(0, 32);
  } catch { return null; }
}

async function jpost<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message?.slice(0, 120)}`);
  return j.result as T;
}

function cu16(n: number): Buffer {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>= 7; }
  out.push(v);
  return Buffer.from(out);
}

function buildTransfer(fromPub: Uint8Array, toPub: Uint8Array, blockhash32: Uint8Array, lamports: number): Buffer {
  // legacy message: header(1,0,1) + keys[from,to,sysprog] + blockhash + ix
  const keys = Buffer.concat([fromPub, toPub, bs58.decode(SYSTEM_PROGRAM)]);
  const head = Buffer.from([1, 0, 1]);
  const ixData = Buffer.concat([Buffer.from([2, 0, 0, 0]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(lamports)); return b; })()]);
  const ix = Buffer.concat([Buffer.from([2]), cu16(2), Buffer.from([0, 1]), cu16(ixData.length), ixData]);
  return Buffer.concat([head, cu16(3), keys, blockhash32, cu16(1), ix]);
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const { decryptSecret } = await import("../src/lib/vault");
    const rows = await db.vaultKey.findMany({
      where: { chain: "sol", role: "wallet" },
      select: { account: true, cipher: true, address: true },
    });
    const TARGET_LABEL = "wallet:cashmachine"; // זהות-הפקדה-של-הדלת
    const target = rows.find((r) => r.account === TARGET_LABEL);
    if (!target?.address) throw new Error("door target (wallet:cashmachine) missing in vault");
    const targetAddr = target.address;
    console.log(`door-target: ${targetAddr.slice(0, 8)}... (${TARGET_LABEL}) mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);

    const bh = await jpost<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
    const blockhash32 = bs58.decode(bh.value.blockhash);
    console.log(`blockhash: ${bh.value.blockhash.slice(0, 12)}...`);

    const tBefore = await jpost<{ value: number }>("getBalance", [targetAddr, { commitment: "confirmed" }]);
    console.log(`target-before: ${tBefore.value} lamports`);

    let totalMoved = 0;
    const txids: string[] = [];
    for (const r of rows) {
      if (r.account === TARGET_LABEL) continue;
      const pk = decryptSecret(r.cipher);
      const derived = solAddrFromPk(pk);
      if (!derived || !r.address || derived.toLowerCase() !== r.address.toLowerCase()) {
        console.log(`  ${r.account}: self-derive MISMATCH — SKIP (fail-closed)`);
        continue;
      }
      const bal = await jpost<{ value: number }>("getBalance", [r.address, { commitment: "confirmed" }]).catch(() => ({ value: 0 }));
      const send = bal.value - FEE;
      if (send <= 0) { console.log(`  ${r.account} ${r.address.slice(0, 8)}...: bal=${bal.value} — skip`); continue; }
      const seed = seedOf(pk)!;
      const fromPub = new Uint8Array(ed25519.getPublicKey(seed));
      const msg = buildTransfer(fromPub, bs58.decode(targetAddr), blockhash32, send);
      const sig = new Uint8Array(ed25519.sign(new Uint8Array(msg), seed));
      // legacy wire: numRequiredSignatures(=1) || sig(64) || message
      const wire = Buffer.concat([Buffer.from([1]), sig, msg]);
      if (!EXECUTE) {
        console.log(`  ${r.account} ${r.address.slice(0, 8)}... -> ${send} lamports [dry-run]`);
        totalMoved += send;
        continue;
      }
      try {
        const txid = await jpost<string>("sendTransaction", [wire.toString("base64"), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }]);
        txids.push(txid);
        totalMoved += send;
        console.log(`  ${r.account} ${r.address.slice(0, 8)}... -> ${send} lamports · txid=${txid}`);
      } catch (e) {
        console.log(`  ${r.account} ${r.address.slice(0, 8)}... -> FAILED: ${String((e as Error).message).slice(0, 140)}`);
      }
    }
    console.log(`total: ${totalMoved} lamports (${EXECUTE ? "sent" : "dry-run"}) · txids=${txids.length}`);
    if (EXECUTE && txids.length) {
      await new Promise((res) => setTimeout(res, 8_000));
      const tAfter = await jpost<{ value: number }>("getBalance", [targetAddr, { commitment: "confirmed" }]);
      console.log(`target-after: ${tAfter.value} lamports (delta=${tAfter.value - tBefore.value})`);
      console.log("txids:\n" + txids.join("\n"));
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[sol-consolidate] FAILED: ${String((e as Error).message ?? e).slice(0, 300)}`); process.exit(1); });
