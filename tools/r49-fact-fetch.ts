/**
 * r49 — fetch the public fact-sheet files from the private adsmarket repo
 * for a full claims audit. Token comes from the GitGate vault only
 * (src/lib/github-token.ts). Nothing secret is printed or saved.
 */
import { githubToken } from "../src/lib/github-token";
import { writeFile } from "node:fs/promises";

const REPO = "roshpinacare-sys/adsmarket";
const FILES = ["fact-sheet.md", "fact-sheet-english.md"];

async function main() {
  const token = await githubToken();
  if (!token) {
    console.log("NO TOKEN (vault sealed?)");
    process.exit(2);
  }
  const gh = (path: string, accept: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        "User-Agent": "r49-claims-audit",
      },
      signal: AbortSignal.timeout(30_000),
    });

  const meta = await gh(`/repos/${REPO}`, "application/vnd.github+json");
  console.log("repo:", meta.status, meta.ok ? "" : await meta.text().then(t => t.slice(0, 200)));
  if (!meta.ok) process.exit(2);
  const mj = (await meta.json()) as { default_branch: string; pushed_at: string };
  console.log("default_branch:", mj.default_branch, "pushed_at:", mj.pushed_at);

  for (const f of FILES) {
    const r = await gh(`/repos/${REPO}/contents/${f}`, "application/vnd.github+json");
    if (!r.ok) {
      console.log(`${f}: HTTP ${r.status}`);
      continue;
    }
    const j = (await r.json()) as { content?: string; encoding?: string; sha: string; size: number };
    const text = j.content && j.encoding === "base64" ? Buffer.from(j.content, "base64").toString("utf8") : "";
    const out = `/tmp/r49-${f}`;
    await writeFile(out, text);
    console.log(`${f}: ${text.length} chars · sha ${j.sha.slice(0, 8)} · saved ${out}`);
  }
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
