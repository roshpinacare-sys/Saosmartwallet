// r31-broadcast: deliver the round-the-clock fleet report to every partner
// repo's broadcasts/ folder + our own door (public record). Token pulled at
// runtime from git config. Zero secrets in code.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const url = execSync("git config --get remote.origin.url", { cwd: "/home/z/my-project" }).toString().trim();
const token = url.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error("no token"); process.exit(1); }
const content = readFileSync("/home/z/my-project/docs/broadcast/2026-09-11-fleet-r31.md");
const b64 = content.toString("base64");
const message = "broadcast: r31 הצי-מסביב-לשעון מהכספת Saosmartwallet · האוטונומיה-והריבונות-מתחזקות: 5→9 סוכנים-פעילים, 21→33 משמרות · שני-סוכנים-ישנים-הופעלו (שומר-הכספת 01:00Z · עיני-השער 02:00Z) ושניים-חדשים-נבראו (סופר-הרשת 03:00Z — מדרגת-המימון צעד-2 · דיפלומט-הדלת 04:00Z — טיוטות-תשובה בלבד) · הרשת-הלילית 00:00-05:00 נסגרה — כיסוי-24/7 · ההלבשה-האוטונומית הוכחה (הלב-הלביש-בונה+שומר לכל-חבר-חדש תוך-דקה) · 3/4 הוכחו-חי done במעבר-ראשון גם-בחלון-חתום · תיקוני-עיוורון-חיתוך: vault.stats/vault.map/fleet.digest מציגים-את-הניתן-לאימות ראשון · אפס-סודות";
const repos = [
  "steem", "saos-jummper", "saos-sovereign-foundry", "saos-control-center",
  "saos-dex", "saos-sovereign-platform", "Adsmarket", "Sdk", "roshpina",
  "anchor-baseline", "Project-files", "Saosmartwallet",
];
const results: Array<{ repo: string; status: string; detail: string }> = [];
for (const repo of repos) {
  try {
    const res = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/contents/broadcasts/2026-09-11-fleet-r31.md`, {
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
