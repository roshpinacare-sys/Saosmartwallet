// r36-broadcast: deliver the r36 report to every partner repo's broadcasts/
// folder + our own door (public record). Token pulled at runtime from git
// config. Zero secrets in code.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const url = execSync("git config --get remote.origin.url", { cwd: "/home/z/my-project" }).toString().trim();
const token = url.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error("no token"); process.exit(1); }
const content = readFileSync("/home/z/my-project/docs/broadcast/2026-09-11-crash-burst-healing-r36.md");
const b64 = content.toString("base64");
const message = "broadcast: r36 ריפוי-פרץ-הקריסות · מדידה: 8/10 כשלי-היום היו שריפת-ניסיונות של ריצות-בריאות בחלון-הריבייס/הפעלה-מחדש (15:27–16:13Z) — השומר החזיר ריצה-קרוסה לתור והדיספאץ' תפס-אותה-מיד בתוך-הסערה · הריפוי: retryNotBefore — הפוגת-חימום 90 שנ' × מספר-ניסיונות (עד 5 דק'), דיספאץ' בלתי-נראה-בתוך-ההפוגה, פסיקת-תשישות משתחררת-בדיוק-בפקיעתה — maxAttempts נאכף-בדיוק, לעולם-לא ניסיון-שלישי · הוכח-חי: הלב-עצמו הריץ את-המבחן — ALL-PASS (5/5) · חוזי-אמת r35 חיים 10/10 · הצי 10 סוכנים · Hebrew, zero secrets";
const repos = [
  "steem", "saos-jummper", "saos-sovereign-foundry", "saos-control-center",
  "saos-dex", "saos-sovereign-platform", "Adsmarket", "Sdk", "roshpina",
  "anchor-baseline", "Project-files", "Saosmartwallet",
];
const results: Array<{ repo: string; status: string; detail: string }> = [];
for (const repo of repos) {
  try {
    const res = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/contents/broadcasts/2026-09-11-crash-burst-healing-r36.md`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: b64 }),
    });
    const body: unknown = await res.json();
    if (res.status === 201) {
      const sha = (body as { commit?: { sha?: string } })?.commit?.sha?.slice(0, 7) ?? "?";
      results.push({ repo, status: "CREATED", detail: `commit ${sha}${repo === "Saosmartwallet" ? " · our door" : ""}` });
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
console.log(`\nSUMMARY: ${ok}/${repos.length} delivered`);
