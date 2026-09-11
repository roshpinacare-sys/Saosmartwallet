// r35-broadcast: deliver the r35 report to every partner repo's broadcasts/
// folder + our own door (public record). Token pulled at runtime from git
// config. Zero secrets in code.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const url = execSync("git config --get remote.origin.url", { cwd: "/home/z/my-project" }).toString().trim();
const token = url.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error("no token"); process.exit(1); }
const content = readFileSync("/home/z/my-project/docs/broadcast/2026-09-11-channel-truth-r35.md");
const b64 = content.toString("base64");
const message = "broadcast: r35 תעלה-נקייה-מזבל · PNG-של-שותף (roast-79-economy-live.png) נשלף-כטקסט וכמעט-הרעיל-טיוטת-תגובה-בזבל-בינארי — תוקן בשלוש-שכבות: רק-.md-נבחר-במישור-המצב · דופק-לא-טקסטואלי-נספר-בכנות-ולא-מפוענח · classify-מוריד-תוכן-פגום-בכנות · חוק-הראש-הרביעי: governance.scan (summary+meaning-ראשונים) — הבודק-רואה-את-הראייה · חוזי-אמת ל-10 משמרות-שומר: רשת-כבויה-שנמדדה היא ממצא-כנה, לא פער · הלכת-SQLITE: kill-לכל-העץ, לא רק-בעל-הנמל · אומת-חי: שער-נפתח · 10 סוכנים · דלת 12-דופקים-7-הדים · אפס-שגיאות · Hebrew, zero secrets";
const repos = [
  "steem", "saos-jummper", "saos-sovereign-foundry", "saos-control-center",
  "saos-dex", "saos-sovereign-platform", "Adsmarket", "Sdk", "roshpina",
  "anchor-baseline", "Project-files", "Saosmartwallet",
];
const results: Array<{ repo: string; status: string; detail: string }> = [];
for (const repo of repos) {
  try {
    const res = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/contents/broadcasts/2026-09-11-channel-truth-r35.md`, {
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
