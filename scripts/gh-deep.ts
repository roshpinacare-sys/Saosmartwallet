/**
 * gh-deep — README + root tree of the most promising old repos (public data only).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const token = readFileSync("/tmp/.gate_token_28", "utf8").trim();
const TARGETS = ["saos-jummper", "saos-dex", "roshpina", "saos-sovereign-foundry", "saos-control-center", "saos-sovereign-platform"];

async function main() {
  const db = new PrismaClient();
  const row = await db.vaultEntry.findFirst({ where: { chain: "github", account: "roshpinacare-sys", kind: "token" }, select: { id: true } });
  await db.$disconnect();
  const res = await fetch(`${BASE}/api/gate/reveal`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-gate-token": token },
    body: JSON.stringify({ id: row?.id }), signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { ok: boolean; priv?: string };
  if (!j.ok || !j.priv) { console.log("REVEAL FAILED"); process.exit(2); }
  const gh = (path: string) => fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${j.priv}`, Accept: "application/vnd.github+json", "User-Agent": "gate-r28-deep" },
    signal: AbortSignal.timeout(30_000),
  });
  for (const repo of TARGETS) {
    console.log(`\n########## ${repo} ##########`);
    const readme = await gh(`/repos/roshpinacare-sys/${repo}/readme`);
    if (readme.ok) {
      const rj = (await readme.json()) as { content?: string; encoding?: string };
      const text = rj.content && rj.encoding === "base64" ? Buffer.from(rj.content, "base64").toString("utf8") : "";
      console.log(text.slice(0, 1400));
    } else console.log(`(no readme: ${readme.status})`);
    const tree = await gh(`/repos/roshpinacare-sys/${repo}/contents`);
    if (tree.ok) {
      const tj = (await tree.json()) as { name: string; type: string; size: number }[];
      console.log(`-- root (${tj.length}): ${tj.slice(0, 24).map((e) => e.name + (e.type === "dir" ? "/" : "")).join("  ")}`);
    }
  }
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
