// follow-up: remove the 23 internal broadcast copies (missed in pass 1)
import fs from "fs";
const H = { Authorization: `Bearer ${fs.readFileSync("/tmp/gh_token_hidden", "utf8")}`, Accept: "application/vnd.github+json" };
const REPO = "repos/roshpinacare-sys/Adsmarket";
const api = async (p: string, init?: RequestInit) => {
  const r = await fetch(`https://api.github.com/${p}`, { headers: H, ...init });
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
};
const tree = await api(`${REPO}/git/trees/main?recursive=1`);
const kills = (tree.tree ?? []).filter((t: any) => t.type === "blob" && (t.path.startsWith("broadcasts/") || t.path.startsWith("docs/reports/"))).map((t: any) => t.path);
if (!kills.length) { console.log("nothing to delete"); process.exit(0); }
const ref = await api(`${REPO}/git/ref/heads/main`);
const base = await api(`${REPO}/git/commits/${ref.object.sha}`);
const nodes = kills.map((p: string) => ({ path: p, mode: "100644", type: "blob", sha: null }));
const t = await api(`${REPO}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: base.tree.sha, tree: nodes }) });
const c = await api(`${REPO}/git/commits`, { method: "POST", body: JSON.stringify({ message: "r33 pass 2: remove the internal broadcast/report copies too (missed in pass 1) — the command bridge stays home", tree: t.sha, parents: [ref.object.sha] }) });
await api(`${REPO}/git/refs/heads/main`, { method: "PATCH", body: JSON.stringify({ sha: c.sha, force: false }) });
console.log(`pass-2 commit: ${c.sha} · deleted=${kills.length}`);
process.exit(0);
