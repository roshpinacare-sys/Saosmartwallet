/**
 * tools/saos-deep-scan.ts — SAOS Deep Dive (Breakthrough Proof, Step 1)
 * =====================================================================
 * Scans the roshpinacare-sys org repos LIVE for every SAOS component:
 *   · sovereign/node/ state + grid98
 *   · soldiers / agent loops / fleet code
 *   · bridge_state.json + anchor code
 *   · saos-dex order book / AMM / soldier wallet
 * Reads the token the same way the app does (env GITHUB_TOKEN, else
 * upload/Roshcaregt.txt) and NEVER prints it.
 *
 * Output: docs/saos-scan.json + stdout summary.
 *
 * Usage: bun tools/saos-deep-scan.ts
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OWNER = "roshpinacare-sys";
const REPOS = ["steem", "saos-dex", "saos-sovereign-platform", "saos-sovereign-foundry", "roshpina", "Project-files"];

async function githubToken(): Promise<string> {
  const env = process.env.GITHUB_TOKEN;
  if (env && env.trim().length > 10) return env.trim();
  const raw = await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8");
  return raw.trim();
}

async function gh(pathname: string): Promise<unknown> {
  const token = await githubToken();
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GH ${res.status} ${pathname}`);
  return res.json();
}

interface TreeEntry { path: string; type: string; size?: number }

function match(path: string): string | null {
  const p = path.toLowerCase();
  if (p.includes("soldier")) return "soldier";
  if (p.includes("grid98")) return "grid98";
  if (p.includes("anchor")) return "anchor";
  if (p.includes("bridge")) return "bridge";
  if (p.includes("fleet") || p.includes("loop")) return "fleet/loop";
  if (p.includes("oracle")) return "oracle";
  if (p.includes("pool") || p.includes("amm")) return "pool/amm";
  if (p.includes("delegate") || p.includes("delegation")) return "delegation";
  if (p.includes("sovereign")) return "sovereign";
  if (p.includes("vault") || p.includes("wallet")) return "vault/wallet";
  if (p.includes("checkpoint")) return "checkpoint";
  if (p.includes("agent")) return "agent";
  if (p.includes("attest") || p.includes("passport")) return "attestation";
  return null;
}

async function main() {
  const out: Record<string, unknown> = { scannedAt: new Date().toISOString(), owner: OWNER, repos: {} };

  for (const repo of REPOS) {
    try {
      const info = (await gh(`/repos/${OWNER}/${repo}`)) as { default_branch: string; size: number; description: string | null };
      const branch = info.default_branch || "main";
      const tree = (await gh(`/repos/${OWNER}/${repo}/git/trees/${branch}?recursive=1`)) as { tree: TreeEntry[]; truncated?: boolean };
      const entries = tree.tree.filter((e) => e.type === "blob");
      const hits: Record<string, { path: string; size: number }[]> = {};
      for (const e of entries) {
        const m = match(e.path);
        if (m) {
          (hits[m] ||= []).push({ path: e.path, size: e.size ?? 0 });
        }
      }
      const topDirs = new Set(entries.map((e) => e.path.split("/")[0]));
      (out.repos as Record<string, unknown>)[repo] = {
        description: info.description,
        sizeKB: info.size,
        branch,
        truncated: tree.truncated === true,
        fileCount: entries.length,
        topDirs: [...topDirs].sort(),
        hits: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.sort((a, b) => b.size - a.size).slice(0, 40)])),
      };
      console.log(`[${repo}] files=${entries.length} truncated=${tree.truncated === true}`);
      for (const [k, v] of Object.entries(hits)) console.log(`   ${k}: ${v.length} paths (top: ${v.sort((a, b) => b.size - a.size).slice(0, 3).map((x) => x.path).join(", ")})`);
    } catch (e) {
      console.error(`[${repo}] ERROR: ${(e as Error).message}`);
      (out.repos as Record<string, unknown>)[repo] = { error: (e as Error).message };
    }
  }

  await mkdir(path.join(process.cwd(), "docs"), { recursive: true });
  await writeFile(path.join(process.cwd(), "docs", "saos-scan.json"), JSON.stringify(out, null, 2));
  console.log("→ docs/saos-scan.json written");
}

main().catch((e) => { console.error(e); process.exit(1); });
