/**
 * r14 — live proof of the brain migration: enqueue a REAL budget-2 run for
 * zai-code (historically starved on zai:default: 2 failed / 1 blocked, zero
 * done) and watch it end-to-end. The run must complete with brain
 * "nvidia:openai/gpt-oss-20b", a real maker trace, an independent checker
 * verdict, and status done|blocked — proving the migrated brain plane works.
 */
const BASE = "http://localhost:3000";

async function main() {
  const s = await fetch(`${BASE}/api/gate/session`, { method: "POST" });
  const sj = await s.json() as { ok: boolean; token?: string };
  if (!sj.ok || !sj.token) throw new Error(`session mint failed: ${JSON.stringify(sj)}`);
  const H = { Authorization: `Bearer ${sj.token}`, "Content-Type": "application/json" };
  try {
    const r = await fetch(`${BASE}/api/gate/run`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        agentName: "zai-code",
        goal: "בדיקת-מוח חיה (r14): מדוד את ספירת-הכניסות בכספת עם vault.stats, וכתוב ממצא-זיכרון-צי אחד עם memory.write שמתעד את מספר הכניסות ואת תאריך המדידה",
        doneMeans: [
          "vault.stats הורץ והחזיר מספר-כניסות אמיתי",
          "memory.write רשם ממצא אחד עם המספר-שנמדד",
        ],
        modules: ["vault.stats", "memory.write"],
        budget: 2,
      }),
    });
    const j = await r.json() as { ok: boolean; run?: { id?: string }; runId?: string; error?: string };
    const runId = j.runId || j.run?.id; if (!j.ok || !runId) throw new Error(`enqueue failed: ${JSON.stringify(j)}`);
    console.log("RUN:", runId);
    for (let i = 0; i < 40; i++) {
      await new Promise((r2) => setTimeout(r2, 6000));
      const d = await fetch(`${BASE}/api/gate/run?id=${runId}`, { headers: H });
      const dj = await d.json() as any;
      const run = dj.run ?? dj;
      const status = run?.status;
      if (status && status !== "queued" && status !== "running") {
        console.log("FINAL:", status, "| brain:", run.brain, "| checker:", run.checker, "| makerSteps:", (run.steps || []).filter((x: any) => x.side === "maker").length, "| durationMs:", run.durationMs);
        console.log("REPORT:", String(run.report || "").slice(0, 700));
        break;
      }
      if (i % 5 === 0) console.log(`... ${status ?? "?"} (${i * 6}s)`);
    }
  } finally {
    await fetch(`${BASE}/api/gate/lock`, { method: "POST", headers: H }).catch(() => {});
  }
}
main().catch((e) => { console.error("PROBE FAILED:", e instanceof Error ? e.message : e); process.exit(1); });

export {};
