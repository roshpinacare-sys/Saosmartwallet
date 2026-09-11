// r31-broadcast: deliver the round-the-clock fleet report to every partner
// repo's broadcasts/ folder + our own door (public record). Token pulled at
// runtime from git config. Zero secrets in code.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const url = execSync("git config --get remote.origin.url", { cwd: "/home/z/my-project" }).toString().trim();
const token = url.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error("no token"); process.exit(1); }
const content = readFileSync("/home/z/my-project/docs/broadcast/2026-09-11-login-r32.md");
const b64 = content.toString("base64");
const message = "broadcast: r32 ריפוי-חותמות-הכספת מהכספת Saosmartwallet · המפתח-של-המפעיל-חזר: הרוטציה-r16/r17 הוציאה-את-מפתחות-ה-steem-של-הקובץ-מה-authority-אך-הכספת-מעולם-לא-חתמה-תחת-החדשים · ריענון-חותמות-בכל-כניסה (seal-refresh): המפתח-אב-נאטם-תחת-כל-מפתח-headcorner-נוכחי · זיהוי-מפתח-מוחלף (rotated-out-key) במקום-מבוי-סתום · שומר-סריקה-חלקית (steem+hive-שקטים = chains-down, לא-הרשעת-שווא) · שומר-מחיקה-עצמית (wipe-guard) · הוכחה-חיה A/B/C: ישן-מדבר-אמת · הנוכחי-hive-נכנס · הנוכחי-steem-נכנס · 12-חותמות/8-חיות · אפס-סודות";
const repos = [
  "steem", "saos-jummper", "saos-sovereign-foundry", "saos-control-center",
  "saos-dex", "saos-sovereign-platform", "Adsmarket", "Sdk", "roshpina",
  "anchor-baseline", "Project-files", "Saosmartwallet",
];
const results: Array<{ repo: string; status: string; detail: string }> = [];
for (const repo of repos) {
  try {
    const res = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/contents/broadcasts/2026-09-11-login-r32.md`, {
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
