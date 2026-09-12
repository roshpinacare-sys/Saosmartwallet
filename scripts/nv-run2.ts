/**
 * nv-run2 — calibrated goal-loop: strictly within the vault stats/map tools'
 * real capabilities (the previous run taught the boundary). Polls to verdict.
 */
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const token = readFileSync("/tmp/.gate_token_28", "utf8").trim();
const headers = { "Content-Type": "application/json", "x-gate-token": token };

const res = await fetch(`${BASE}/api/gate/run`, {
  method: "POST", headers,
  body: JSON.stringify({
    agentName: "vault-rider",
    goal: "בעזרת vault.stats ו-vault.map בלבד: דווח על מצב-הכספת — סה\"כ רשומות, כמה verified, כמה imported. ציין גם את המספרים ש-vault.map מציג ואת הפער בינו לבין vault.stats (אם קיים פער), וסיים בהמלצת-תחזוקה אחת קונקרטית",
    doneMeans: [
      "הדוח מציג סה\"כ רשומות, verified ו-imported כפי ש-vault.stats מדווח",
      "הדוח מציג את מספרי vault.map ומציין את הפער בינו לבין vault.stats אם קיים",
      "הדוח נגמר בהמלצת-תחזוקה אחת קונקרטית",
    ],
    brain: "nvidia:openai/gpt-oss-20b",
    budget: 3,
  }),
  signal: AbortSignal.timeout(60_000),
});
const j = (await res.json()) as { ok: boolean; run?: { id: string; brain?: string }; error?: string };
if (!j.ok || !j.run) { console.log("LAUNCH FAILED:", j.error ?? res.status); process.exit(2); }
console.log(`RUN2 id=${j.run.id} brain=${j.run.brain}`);
const id = j.run.id;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 12_000));
  const p = await fetch(`${BASE}/api/gate/run?id=${id}`, { headers, signal: AbortSignal.timeout(30_000) });
  const pj = (await p.json()) as { ok: boolean; run?: { status?: string; verdict?: string; report?: string } };
  const r = pj.run ?? {};
  console.log(`poll ${i + 1}: status=${r.status ?? "?"}`);
  if (r.status && !["running", "pending", "queued"].includes(r.status)) {
    const rep = (r.report ?? "").slice(0, 700);
    console.log("FINAL:", r.status, "|", rep);
    process.exit(0);
  }
}
console.log("TIMEOUT (run continues)");
