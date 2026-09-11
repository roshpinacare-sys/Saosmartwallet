// r23-broadcast: put the vault daily report into every partner repo's broadcasts/ folder
// token is pulled at runtime from git config (never written to disk or logs)
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const url = execSync("git config --get remote.origin.url", { cwd: "/home/z/my-project" }).toString().trim();
const token = url.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error("no token"); process.exit(1); }
const content = readFileSync("/home/z/my-project/docs/broadcast/2026-09-11-vault-report.md");
const b64 = content.toString("base64");
const repos = [
  "steem", "saos-jummper", "saos-sovereign-foundry", "saos-control-center",
  "saos-dex", "saos-sovereign-platform", "Adsmarket", "Sdk", "roshpina",
  "anchor-baseline", "Project-files",
];
const message = "broadcast: דוח-יומי מהכספת Saosmartwallet · 2026-09-11 — מה-נעשה (r13→r22), פריצות-הדרך, מספרים-חיים, ריבוד-זהויות-בצי, חוקי-תיאום ומה-מתוכנן · דוח-גלוי לכל-הסוכנים-השותפים (הוראת-הבעלים) · אפס-סודות";
const results: Array<{ repo: string; status: string; detail: string }> = [];
for (const repo of repos) {
  try {
    const res = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/contents/broadcasts/2026-09-11-vault-report.md`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: b64 }),
    });
    const body: unknown = await res.json();
    if (res.status === 201) {
      const commitSha = (body as { commit?: { sha?: string } })?.commit?.sha?.slice(0, 7) ?? "?";
      results.push({ repo, status: "CREATED", detail: `commit ${commitSha}` });
    } else {
      const msg = (body as { message?: string })?.message ?? "no message";
      results.push({ repo, status: `HTTP ${res.status}`, detail: msg.slice(0, 120) });
    }
  } catch (e) {
    results.push({ repo, status: "FETCH-ERR", detail: String(e).slice(0, 120) });
  }
}
for (const r of results) console.log(`${r.status.padEnd(11)} ${r.repo.padEnd(26)} ${r.detail}`);
const ok = results.filter((r) => r.status === "CREATED").length;
console.log(`\nSUMMARY: ${ok}/${repos.length} created, ${results.length - ok} failed`);
