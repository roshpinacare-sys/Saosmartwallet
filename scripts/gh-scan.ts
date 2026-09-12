/**
 * gh-scan — old-projects recon (operator-delegated).
 * Reveals the roshpinacare-sys PAT through the gate (in memory ONLY — the
 * secret is never printed, never written), then asks GitHub for:
 *   · the authenticated identity (login only)
 *   · every repo in the org with public metadata
 * Prints public metadata exclusively.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const token = readFileSync("/tmp/.gate_token_28", "utf8").trim();

async function main() {
  const db = new PrismaClient();
  const row = await db.vaultEntry.findFirst({
    where: { chain: "github", account: "roshpinacare-sys", kind: "token", status: "verified" },
    select: { id: true, pub: true },
  });
  await db.$disconnect();
  if (!row) { console.log("PAT row not found in vault"); process.exit(2); }
  console.log(`revealing vault row ${row.id.slice(0, 8)}… (${row.pub}) — audited`);

  const res = await fetch(`${BASE}/api/gate/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-gate-token": token },
    body: JSON.stringify({ id: row.id }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { ok: boolean; priv?: string; error?: string };
  const pat = j.priv;
  if (!j.ok || !pat) { console.log("REVEAL FAILED:", j.error ?? res.status); process.exit(3); }

  const gh = (path: string) => fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "gate-r28-recon" },
    signal: AbortSignal.timeout(30_000),
  });

  const me = await gh("/user");
  const meJ = (await me.json()) as { login?: string; message?: string };
  console.log(`github identity: ${meJ.login ?? meJ.message ?? "?"}`);

  const orgs = await gh("/user/orgs");
  const orgsJ = (await orgs.json()) as { login?: string }[];
  console.log(`orgs: ${orgsJ.map((o) => o.login).join(", ") || "-"}`);

  const targets = ["user", "users/roshpinacare-sys"];
  for (const t of targets) {
    const r = await gh(`/${t === "user" ? "user/repos?per_page=100&sort=pushed&affiliation=owner" : "repos?per_page=100&sort=pushed"}`);
    if (!r.ok) { console.log(`${t}: HTTP ${r.status}`); continue; }
    const repos = (await r.json()) as { name: string; description: string | null; language: string | null; pushed_at: string; size: number; archived: boolean; default_branch: string; fork: boolean; owner?: { login?: string } }[];
    console.log(`\n== ${t}: ${repos.length} repos ==`);
    for (const repo of repos) {
      console.log(`  ${repo.owner?.login ?? ""}/${repo.name}${repo.fork ? " (fork)" : ""}${repo.archived ? " [ARCHIVED]" : ""} · ${repo.language ?? "?"} · ${(repo.size / 1024).toFixed(1)}MB · pushed ${repo.pushed_at.slice(0, 10)} · ${repo.description?.slice(0, 70) ?? ""}`);
    }
  }
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
