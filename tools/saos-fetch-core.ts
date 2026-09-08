/**
 * tools/saos-fetch-core.ts — fetch core SAOS files from the org (read-only)
 * Usage: bun tools/saos-fetch-core.ts
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OWNER = "roshpinacare-sys";

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

async function raw(repo: string, filePath: string, ref = "main"): Promise<string | null> {
  const token = await githubToken();
  const res = await fetch(`https://raw.githubusercontent.com/${OWNER}/${repo}/${ref}/${filePath}`, {
    headers: { Authorization: `token ${token}` },
    cache: "no-store",
  });
  return res.ok ? res.text() : null;
}

async function tree(repo: string, prefix: string): Promise<string[]> {
  const t = (await gh(`/repos/${OWNER}/${repo}/git/trees/main?recursive=1`)) as { tree: { path: string; type: string; size?: number }[] };
  return t.tree.filter((e) => e.type === "blob" && e.path.startsWith(prefix)).map((e) => `${e.path} (${e.size ?? 0}B)`);
}

async function main() {
  await mkdir("/tmp/saos", { recursive: true });
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(s); };

  say("=== steem:sovereign/node/ tree ===");
  say((await tree("steem", "sovereign/node/")).join("\n"));

  say("\n=== steem:agent/ top 2 levels ===");
  const agentTree = (await gh(`/repos/${OWNER}/steem/git/trees/main?recursive=1`)) as { tree: { path: string; type: string; size?: number }[] };
  const agentFiles = agentTree.tree.filter((e) => e.type === "blob" && e.path.startsWith("agent/") && !e.path.includes("download/"));
  say(`${agentFiles.length} agent files; sample:`);
  say(agentFiles.slice(0, 60).map((e) => `${e.path} (${e.size ?? 0}B)`).join("\n"));

  // Core code fetches
  const fetches: [string, string, number][] = [
    ["steem", "sovereign/node/grid98.cjs", 300],
    ["steem", "agent/oracle106.cjs", 200],
    ["steem", "src/app/api/ops/vault/delegated/route.ts", 150],
    ["saos-dex", "src/lib/dex/amm.ts", 200],
    ["saos-dex", "state/anchors.json", 60],
    ["saos-sovereign-platform", "src/lib/saos/anchor-evm.ts", 150],
    ["saos-sovereign-platform", "agent/keys/fleet_keys.meta.json", 60],
    ["roshpina", "kernel/agent-identity/delegation.ts", 150],
  ];
  for (const [repo, p, lines] of fetches) {
    const content = await raw(repo, p);
    if (content == null) { say(`\n=== FETCH FAIL ${repo}:${p}`); continue; }
    const head = content.split("\n").slice(0, lines).join("\n");
    say(`\n=== ${repo}:${p} (total ${content.length}B, first ${lines} lines) ===\n${head}`);
    const safe = p.replace(/\//g, "__");
    await writeFile(`/tmp/saos/${repo}__${safe}`, content);
  }

  await writeFile("/tmp/saos/fetch-log.txt", log.join("\n"));
  console.log("\n→ /tmp/saos/ written");
}

import { readFile } from "node:fs/promises";
main().catch((e) => { console.error(e); process.exit(1); });
