/**
 * nv-seal2 — seal the 5 remaining candidates by replicating the EXACT batched
 * text assembly of the scan (same file walk, same batching) and passing the
 * full take list to every batch (hashes absent from a batch are ignored).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3000";
const UP = "/home/z/my-project/upload";
const BATCH_BYTES = 1_400_000;
const TAKE = ["b8ebfbe7", "cdfd3a1a", "070f4802", "4bb323e6", "02e112f6"];

interface UnlockResp { ok: boolean; token?: string }
interface SealResp { ok: boolean; created?: number; sealed?: { hash: string; id: string; chain: string | null; account: string | null; role: string | null; status: string }[]; error?: string; note?: string }

async function unlock(): Promise<string> {
  const dk = readFileSync(join(UP, "הדקור.txt"), "utf8");
  const cands: string[] = [];
  for (const line of dk.split(/\r?\n/)) {
    const m = line.match(/^\s*(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/i);
    if (m) cands.push(m[2]);
  }
  for (const key of cands) {
    try {
      const res = await fetch(`${BASE}/api/gate/unlock-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }), signal: AbortSignal.timeout(45_000),
      });
      const j = (await res.json()) as UnlockResp;
      if (res.ok && j.ok && j.token) return j.token;
    } catch { /* next */ }
  }
  console.log("UNLOCK FAILED");
  process.exit(2);
}

function listFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2 && !e.name.startsWith(".") && e.name !== "node_modules") walk(p, depth + 1); continue; }
      try {
        const buf = readFileSync(p);
        if (buf.byteLength > 2 * 1024 * 1024 || buf.slice(0, 512).includes(0)) continue;
        files.push(p);
      } catch { /* skip */ }
    }
  };
  walk(UP, 0);
  return files;
}

async function main() {
  const token = await unlock();
  const files = listFiles();
  const sealedAll: NonNullable<SealResp["sealed"]> = [];
  let created = 0;
  let batch: string[] = [], bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const res = await fetch(`${BASE}/api/gate/keys-batch`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-gate-token": token },
      body: JSON.stringify({ mode: "seal", text: batch.join("\n"), take: TAKE }),
      signal: AbortSignal.timeout(180_000),
    });
    const j = (await res.json()) as SealResp;
    if (j.ok && j.created) { created += j.created; sealedAll.push(...(j.sealed ?? [])); }
    batch = []; bytes = 0;
  };
  for (const p of files) {
    const blob = `@@FILE ${p.replace(UP + "/", "")}\n${readFileSync(p, "utf8")}`;
    if (bytes + blob.length > BATCH_BYTES) await flush();
    batch.push(blob); bytes += blob.length;
  }
  await flush();
  console.log(`SEAL2 OK — created ${created}`);
  for (const s of sealedAll) console.log(`  ${s.hash} → ${s.chain ?? "-"}/${s.account ?? "-"}/${s.role ?? "-"} status=${s.status}`);
  console.log(`note: ${"see gate"}`);
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
