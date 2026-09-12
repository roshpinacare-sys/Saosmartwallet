/**
 * nv-intake v2 — unlock + per-file keys-batch SCAN (batched under the 2MB cap).
 * Zero secrets on stdout — the API never echoes them and we print public data only.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3000";
const UP = "/home/z/my-project/upload";
const TOKEN_FILE = "/tmp/.gate_token_28";
const BATCH_BYTES = 1_400_000;

interface UnlockResp { ok: boolean; token?: string; identity?: { chain: string; account: string; role: string; pub: string } }

async function unlock(): Promise<string> {
  const cands: { label: string; key: string }[] = [];
  const dk = readFileSync(join(UP, "הדקור.txt"), "utf8");
  for (const line of dk.split(/\r?\n/)) {
    const m = line.match(/^\s*(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/i);
    if (m) cands.push({ label: `hedkor:${m[1].toUpperCase()}`, key: m[2] });
  }
  readFileSync(join(UP, "headcorner.txt"), "utf8").split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l.length >= 40).forEach((k, i) => cands.push({ label: `headcorner.txt#${i + 1}`, key: k }));

  for (const c of cands) {
    try {
      const res = await fetch(`${BASE}/api/gate/unlock-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: c.key }), signal: AbortSignal.timeout(45_000),
      });
      const j = (await res.json()) as UnlockResp;
      if (res.ok && j.ok && j.token) {
        console.log(`UNLOCK OK via ${c.label} → ${j.identity?.chain}/${j.identity?.account}@${j.identity?.role}`);
        return j.token;
      }
    } catch { /* try next candidate */ }
  }
  console.log("UNLOCK FAILED (all candidates)");
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

interface ScanItem { hash: string; kind: string; preview: string; from: string; liveChecked?: boolean; label?: string; dupOf?: string | null; controls?: { chain?: string; account?: string; role?: string; pub?: string }[] }

async function main() {
  const token = await unlock();
  const files = listFiles();
  console.log(`scanning ${files.length} files in size-batches…`);

  const all: ScanItem[] = [];
  let batch: string[] = [], bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const text = batch.join("\n");
    const res = await fetch(`${BASE}/api/gate/keys-batch`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-gate-token": token },
      body: JSON.stringify({ mode: "scan", text }), signal: AbortSignal.timeout(120_000),
    });
    const j = (await res.json()) as { ok: boolean; found?: number; items?: ScanItem[]; error?: string };
    if (!j.ok) console.log(`  batch failed: ${j.error ?? res.status} (${batch.length} files)`);
    else all.push(...(j.items ?? []));
    batch = []; bytes = 0;
  };
  for (const p of files) {
    const blob = `@@FILE ${p.replace(UP + "/", "")}\n${readFileSync(p, "utf8")}`;
    if (bytes + blob.length > BATCH_BYTES) await flush();
    batch.push(blob); bytes += blob.length;
  }
  await flush();

  const seen = new Set<string>();
  console.log(`SCAN OK — ${all.length} candidates:`);
  for (const it of all) {
    if (seen.has(it.hash)) continue;
    seen.add(it.hash);
    const ctrl = (it.controls ?? []).map((c) => `${c.chain ?? "?"}/${c.account ?? "?"}@${c.role ?? "?"}${c.pub ? " pub:" + String(c.pub).slice(0, 10) + "…" : ""}`).join(" | ");
    console.log(`  ${it.hash} · ${it.kind} · ${it.preview} · live=${it.liveChecked ? "Y" : "n"} · dupOf=${it.dupOf ?? "-"} · ${it.label ?? "?"}${ctrl ? " · " + ctrl : ""} · from=${it.from}`);
  }
  console.log(`unique: ${seen.size}`);
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
