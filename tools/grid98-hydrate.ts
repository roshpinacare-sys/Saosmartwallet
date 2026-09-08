/**
 * tools/grid98-hydrate.ts — rehydrate the grid98 lab (read-only setup)
 * ====================================================================
 * The /api/saos/grid98-bench route spawns the REAL production engine
 * (sovereign/node/grid98.cjs + chain-archive.jsonl) sparse-cloned from the
 * org's `steem` repo into .grid98-lab/ (gitignored). A fresh sandbox starts
 * without the lab — the bench route then honestly answers ok:false
 * ("grid98-lab not hydrated"). This tool restores that documented setup:
 *
 *   bun tools/grid98-hydrate.ts
 *
 * It mirrors sovereign/node/ from the org repo (engine .cjs modules, chain
 * archive, state ledgers) READ-ONLY — no engine logic is re-implemented or
 * modified here. Historical debris (poisoned/quarantine snapshots) is skipped
 * to keep the lab clean. Token: upload/Roshcaregt.txt (gitignored) or
 * $GITHUB_TOKEN.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const OWNER = "roshpinacare-sys";
const REPO = "steem";
const REF = "main";
const PREFIX = "sovereign/node/";
/** Engine modules beyond node/ (kernel is required by saosnet.cjs). */
const EXTRA_FILES = ["sovereign/core/kernel.cjs", "sovereign/core/merkle.cjs", "sovereign/genesis/genesis.json"];
const LAB = path.join(process.cwd(), ".grid98-lab", "steem");
/** Historical incident debris — not needed to boot the engine. */
const SKIP = [/poisoned-/, /quarantine-/];

interface TreeEntry { path: string; type: string; size?: number }

async function githubToken(): Promise<string> {
  const env = process.env.GITHUB_TOKEN;
  if (env && env.trim().length > 10) return env.trim();
  const { readFile } = await import("node:fs/promises");
  return (await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8")).trim();
}

async function ghJson<T>(pathname: string): Promise<T> {
  const token = await githubToken();
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GH ${res.status} ${pathname}`);
  return (await res.json()) as T;
}

async function download(repoPath: string, dest: string): Promise<number> {
  const token = await githubToken();
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${repoPath}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `token ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

async function main() {
  const destDir = path.join(LAB, "sovereign", "node");
  await mkdir(destDir, { recursive: true });
  const tree = await ghJson<{ tree: TreeEntry[] }>(`/repos/${OWNER}/${REPO}/git/trees/${REF}?recursive=1`);
  const files = tree.tree.filter(
    (e) => e.type === "blob" && e.path.startsWith(PREFIX) && !SKIP.some((r) => r.test(e.path)),
  );
  console.log(`hydrating ${files.length} files → ${destDir}`);
  let total = 0;
  let fetched = 0;
  for (const f of files) {
    const name = f.path.slice(PREFIX.length);
    const dest = path.join(destDir, name);
    const expected = f.size ?? 0;
    try {
      const s = await stat(dest);
      if (s.size === expected) {
        total += s.size;
        continue;
      }
    } catch {
      // not present → download
    }
    const bytes = await download(f.path, dest);
    total += bytes;
    fetched += 1;
    if (expected > 1_000_000 || fetched % 10 === 0) console.log(`  ✓ ${name} (${bytes.toLocaleString("en-US")}B)`);
  }
  console.log(`lab ready — ${fetched} fetched, ${total.toLocaleString("en-US")}B total`);

  // 2. sovereign/core + genesis (kernel.cjs is required by saosnet.cjs)
  for (const p of EXTRA_FILES) {
    const dest = path.join(LAB, p);
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      const s = await stat(dest);
      if (s.size > 0) continue;
    } catch {
      // not present → download
    }
    const bytes = await download(p, dest);
    console.log(`  ✓ ${p} (${bytes.toLocaleString("en-US")}B)`);
  }

  // 3. the engine's documented cloud fallback: agent/node_modules/steem
  //    (saosnet.cjs: require('steem') → require('<root>/agent/node_modules/steem'))
  const agentDir = path.join(LAB, "agent");
  const steemLib = path.join(agentDir, "node_modules", "steem");
  try {
    await stat(steemLib);
  } catch {
    await mkdir(agentDir, { recursive: true });
    const { spawnSync } = await import("node:child_process");
    console.log("installing agent dep: steem@0.7.10 (engine cloud fallback path)…");
    const r = spawnSync("bun", ["add", "steem@0.7.10"], { cwd: agentDir, stdio: "inherit" });
    if (r.status !== 0) throw new Error("bun add steem failed in lab agent dir");
  }
  console.log("run: curl 'http://localhost:3000/api/saos/grid98-bench?benchMs=10000'");
}

main().catch((e) => {
  console.error("hydrate failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
