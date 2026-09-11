// r33-broadcast: deliver the pulse-comes-home report to every partner repo's
// broadcasts/ folder + our own door (public record). Token pulled at runtime
// from git config. Zero secrets in code.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const url = execSync("git config --get remote.origin.url", { cwd: "/home/z/my-project" }).toString().trim();
const token = url.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error("no token"); process.exit(1); }
const content = readFileSync("/home/z/my-project/docs/broadcast/2026-09-11-pulse-home-r33.md");
const b64 = content.toString("base64");
const message = "broadcast: r33 הפעימה-חוזרת-הביתה · הפקודה-האחת (h19 סעיף 4) נמסרה: runPulseCycle — דיגסט-אחד על כל-המסילות מהשער עצמו · h21 המחזור-השישי: STEEM 08c92bde blk109490011 / BLURT cb12acff blk63552575 / SOLANA 4KQNxG6A slot446193459 memo נושא-השורש-המלא (ראשון-מהשער, אומת-RPC-בלתי-תלוי) · שערי-כנות: HIVE RC 44.4M/411M, ETH 0.00000386<0.0000177 עלות, TRON סריקה-כנה · תקרת-פעימה-יומית הוכחה-חי (1/1) · ריפוי-הזומבים: מוות-שקט-לפני-צעד-ראשון הופך-לווידוי-כן-בשורה · הלכת-SQLITE-READONLY השישית: kill לפי-PID-מוצהר · Hebrew, public txids only, zero secrets";
const repos = [
  "steem", "saos-jummper", "saos-sovereign-foundry", "saos-control-center",
  "saos-dex", "saos-sovereign-platform", "Adsmarket", "Sdk", "roshpina",
  "anchor-baseline", "Project-files", "Saosmartwallet",
];
const results: Array<{ repo: string; status: string; detail: string }> = [];
for (const repo of repos) {
  try {
    const res = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/contents/broadcasts/2026-09-11-pulse-home-r33.md`, {
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
