/** tools/saos-fetch-round2.ts — fleet docs + engine state + loop census */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OWNER = "roshpinacare-sys";

async function githubToken(): Promise<string> {
  const env = process.env.GITHUB_TOKEN;
  if (env && env.trim().length > 10) return env.trim();
  const raw = await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8");
  return raw.trim();
}

async function raw(repo: string, filePath: string, ref = "main"): Promise<string | null> {
  const token = await githubToken();
  const res = await fetch(`https://raw.githubusercontent.com/${OWNER}/${repo}/${ref}/${filePath}`, {
    headers: { Authorization: `token ${token}` },
    cache: "no-store",
  });
  return res.ok ? res.text() : null;
}

async function main() {
  await mkdir("/tmp/saos", { recursive: true });
  const fetches: [string, string, number][] = [
    ["steem", "agent/README.md", 220],
    ["steem", "agent/army_seen.json", 120],
    ["steem", "agent/fleet_state.json", 40],
    ["steem", "agent/fleet_rc.json", 60],
    ["steem", "agent/bridge_state.json", 20],
    ["steem", "agent/anchor.cjs", 120],
    ["steem", "sovereign/node/grid98-state.json", 400],
    ["steem", "sovereign/node/dex-facts.json", 120],
    ["steem", "sovereign/node/tron-bridge-state.json", 80],
    ["steem", "sovereign/node/state.json", 1],
  ];
  for (const [repo, p, lines] of fetches) {
    const content = await raw(repo, p);
    if (content == null) { console.log(`\n=== FETCH FAIL ${repo}:${p}`); continue; }
    const head = content.split("\n").slice(0, lines).join("\n");
    console.log(`\n=== ${repo}:${p} (total ${content.length}B) ===\n${head.slice(0, 9000)}`);
    const safe = p.replace(/\//g, "__");
    await writeFile(`/tmp/saos/${repo}__${safe}`, content);
  }

  // Loop census: download agent.cjs once and grep loop definitions + soldiers
  const agent = await raw("steem", "agent/agent.cjs");
  if (agent) {
    await writeFile("/tmp/saos/steem__agent.cjs", agent);
    const lines = agent.split("\n");
    console.log(`\n=== agent.cjs: ${lines.length} lines total ===`);
    const loopLines: string[] = [];
    lines.forEach((l, i) => {
      if (/loop|LOOPS|soldier|SOLDIER|army|ARMY|guardian|GUARDIAN/i.test(l) && l.trim().length < 160) loopLines.push(`${i + 1}: ${l.trim()}`);
    });
    console.log(loopLines.slice(0, 80).join("\n"));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
