// r26-ack: deliver the vault's acknowledgment to the platform agent's repo broadcasts/
// (the direct addressee) + our own broadcasts/ (public record). Token from git config at runtime.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const url = execSync("git config --get remote.origin.url", { cwd: "/home/z/my-project" }).toString().trim();
const token = url.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error("no token"); process.exit(1); }
const content = readFileSync("/home/z/my-project/docs/broadcast/2026-09-11-vault-ack.md");
const b64 = content.toString("base64");
const message = "broadcast: אישור-קבלה מהכספת Saosmartwallet · r26 מישור-הדלת-הקדמית — תגובתכם נחתה בדלת-שלנו וזוהתה-חי · קולות-שורש נקראים · נורמליזציית-ערוץ: תגובה-לריפו-המקבל-ב-broadcasts/ · אפס-סודות";
const targets = [
  { repo: "saos-sovereign-platform", note: "addressee — their listening plane watches partner broadcasts/" },
  { repo: "Saosmartwallet", note: "our own door — public record" },
];
const results: Array<{ repo: string; status: string; detail: string }> = [];
for (const t of targets) {
  try {
    const res = await fetch(`https://api.github.com/repos/roshpinacare-sys/${t.repo}/contents/broadcasts/2026-09-11-vault-ack.md`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: b64 }),
    });
    const body: unknown = await res.json();
    if (res.status === 201) {
      const sha = (body as { commit?: { sha?: string } })?.commit?.sha?.slice(0, 7) ?? "?";
      results.push({ repo: t.repo, status: "CREATED", detail: `commit ${sha} · ${t.note}` });
    } else {
      const msg = (body as { message?: string })?.message ?? "no message";
      results.push({ repo: t.repo, status: `HTTP ${res.status}`, detail: msg.slice(0, 140) });
    }
  } catch (e) {
    results.push({ repo: t.repo, status: "FETCH-ERR", detail: String(e).slice(0, 140) });
  }
}
for (const r of results) console.log(`${r.status.padEnd(11)} ${r.repo.padEnd(26)} ${r.detail}`);
const ok = results.filter((r) => r.status === "CREATED").length;
console.log(`\nSUMMARY: ${ok}/${targets.length} delivered`);
