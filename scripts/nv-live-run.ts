/**
 * nv-live-run — launch ONE real goal-loop on an armed agent with the NVIDIA
 * maker brain and poll it to verdict. Prints public run data only.
 */
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const TOKEN_FILE = "/tmp/.gate_token_28";

async function main() {
  const token = readFileSync(TOKEN_FILE, "utf8").trim();
  const headers = { "Content-Type": "application/json", "x-gate-token": token };

  const res = await fetch(`${BASE}/api/gate/run`, {
    method: "POST", headers,
    body: JSON.stringify({
      agentName: "vault-rider",
      goal: "ספור את רכוש-הכספת העדכני לפי-סוג אחרי קליטת r28 (249 רשומות, 4 מפתחות NVIDIA, 7 מנטרות, 16 ארנקי-EVM) ובדוק עקביות: רשומות verified מול imported, ותן 2 המלצות-תחזוקה קונקרטיות",
      doneMeans: [
        "הדוח מציג ספירת-רכוש עדכנית לפי-סוג (token/wallet/steem-key/evm-key/mnemonic)",
        "הדוח מבחין בין verified ל-imported ומסביר את הפער",
        "קיימות 2 המלצות-תחזוקה קונקרטיות וברות-ביצוע",
      ],
      brain: "nvidia:openai/gpt-oss-20b",
      budget: 3,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json()) as { ok: boolean; run?: { id: string; brain?: string; checkerBrain?: string }; error?: string };
  if (!j.ok || !j.run) { console.log("RUN LAUNCH FAILED:", j.error ?? res.status); process.exit(2); }
  const id = j.run.id;
  console.log(`RUN LAUNCHED id=${id} brain=${j.run.brain} checker=${j.run.checkerBrain}`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 12_000));
    const p = await fetch(`${BASE}/api/gate/run?id=${id}`, { headers, signal: AbortSignal.timeout(30_000) });
    const pj = (await p.json()) as { ok: boolean; run?: { status?: string; verdict?: string; trace?: unknown[]; tokenUsage?: unknown; note?: string; error?: string } };
    const r = pj.run ?? {};
    const steps = Array.isArray(r.trace) ? r.trace.length : 0;
    console.log(`poll ${i + 1}: status=${r.status} steps=${steps} verdict=${r.verdict ?? "-"}`);
    if (r.status && !["running", "pending", "queued"].includes(r.status)) {
      console.log("FINAL:", JSON.stringify({ status: r.status, verdict: r.verdict, usage: r.tokenUsage, note: r.note }, null, 1).slice(0, 900));
      return;
    }
  }
  console.log("TIMEOUT waiting for run completion (run continues in background)");
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
