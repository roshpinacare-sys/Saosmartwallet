import { githubToken } from "../src/lib/github-token";
async function main() {
  const token = await githubToken();
  const gh = (p: string) => fetch(`https://api.github.com${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "r49" }, signal: AbortSignal.timeout(30_000) });
  const r = await gh("/repos/roshpinacare-sys/adsmarket/contents/");
  const j = (await r.json()) as { name: string; type: string; size: number }[];
  for (const e of j) console.log(`${e.type === "dir" ? "d" : "f"} ${e.size}\t${e.name}`);
}
main().catch(e => { console.log("FATAL:", e.message); process.exit(1); });
