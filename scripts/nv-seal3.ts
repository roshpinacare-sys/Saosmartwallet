/**
 * nv-seal3 — combined scan+seal PER BATCH: each batch is scanned, then sealed
 * with take = (batch candidates ∩ still-missing list). No cross-run ordering
 * assumptions. Prints one line per sealed item, public data only.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3000";
const UP = "/home/z/my-project/upload";
const BATCH_BYTES = 1_400_000;
const MISSING = new Set(["b8ebfbe7", "cdfd3a1a", "070f4802", "4bb323e6", "02e112f6"]);

interface UnlockResp { ok: boolean; token?: string }
interface Item { hash: string; kind: string; preview: string; dupOf?: string | null }
interface Resp { ok: boolean; found?: number; items?: Item[]; created?: number; sealed?: { hash: string; id: string; chain: string | null; account: string | null; role: string | null; status: string }[]; error?: string }

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
  let batch: string[] = [], bytes = 0;
  const flush = async () => {
    if (!batch.length || MISSING.size === 0) { batch = []; bytes = 0; return; }
    const text = batch.join("\n");
    const head = batch[0]?.split("\n")[0] ?? "?";
    const scan = await fetch(`${BASE}/api/gate/keys-batch`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-gate-token": token },
      body: JSON.stringify({ mode: "scan", text }), signal: AbortSignal.timeout(120_000),
    });
    const sj = (await scan.json()) as Resp;
    if (!sj.ok) { console.log(`batch[${head}] scan failed: ${sj.error}`); batch = []; bytes = 0; return; }
    const take = (sj.items ?? []).filter((it) => MISSING.has(it.hash)).map((it) => it.hash);
    if (!take.length) { batch = []; bytes = 0; return; }
    const seal = await fetch(`${BASE}/api/gate/keys-batch`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-gate-token": token },
      body: JSON.stringify({ mode: "seal", text, take }), signal: AbortSignal.timeout(180_000),
    });
    const ej = (await seal.json()) as Resp;
    if (ej.ok && ej.created) {
      for (const s of ej.sealed ?? []) {
        MISSING.delete(s.hash);
        console.log(`SEALED ${s.hash} (${head}) → ${s.chain ?? "-"}/${s.account ?? "-"}/${s.role ?? "-"} ${s.status}`);
      }
    } else console.log(`batch[${head}] seal failed: ${ej.error ?? seal.status}`);
    batch = []; bytes = 0;
  };
  for (const p of files) {
    const blob = `@@FILE ${p.replace(UP + "/", "")}\n${readFileSync(p, "utf8")}`;
    if (bytes + blob.length > BATCH_BYTES) await flush();
    batch.push(blob); bytes += blob.length;
  }
  await flush();
  console.log(`still missing: ${[...MISSING].join(",") || "NONE — all sealed"}`);
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
