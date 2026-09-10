/**
 * r15 — live end-to-end proof of the network-presence employment plane:
 * mint a session (opens the vault in-process → proven nvidia brain available),
 * launch ONE real budget-3 run on verifier-agent whose doneMeans demand the
 * NEW chain.pulse module (dual-sample block-production proof) + a Hebrew
 * bridge report, poll to terminal state, and print the evidence. Then REVOKE
 * the session (r10 hygiene — test sessions never outlive their proof).
 * Also reads the heart pulse: the idleCraft loop + idleFired counter must be
 * visible (stageIdle deployed), and the pulse boot stamp must show the NEW
 * code sha (the running process runs the fix — r8 doctrine).
 */
const BASE = "http://localhost:3000";
const RUN_ID_KEY = "";

interface RunRow { id: string; status: string; brain: string; checker: string; report: string | null; error: string | null; steps: unknown; verdict: unknown; durationMs: number | null; meta: string | null }

async function main() {
  const s = await fetch(`${BASE}/api/gate/session`, { method: "POST" });
  const sj = (await s.json()) as { ok: boolean; token?: string };
  if (!sj.ok || !sj.token) throw new Error(`session mint failed: ${JSON.stringify(sj)}`);
  const H = { Authorization: `Bearer ${sj.token}`, "Content-Type": "application/json" };

  try {
    // 1. pulse identity — the running heart must already execute r15 code
    const hRes = await fetch(`${BASE}/api/gate/heart`, { headers: H });
    const hj = (await hRes.json()) as { pulse?: { beats?: number; boot?: { codeSha: string }; counters?: Record<string, number>; loops?: Record<string, unknown> } };
    const pulse = hj.pulse;
    console.log(`PULSE: beats=${pulse?.beats} codeSha=${pulse?.boot?.codeSha} idleFired=${pulse?.counters?.idleFired ?? 0} idleCraftLoop=${pulse?.loops?.idleCraft ? "yes" : "no"}`);

    // 2. launch the real proof run
    const r = await fetch(`${BASE}/api/gate/run`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        agentName: "verifier-agent",
        goal: "בדיקת-תעסוקה חיה (r15): הפעל chain.pulse והוכח מכנית אילו מסילות מייצרות בלוקים עכשיו, ודווח לגשר בעברית בשורה-אחת עם הדלתאות שנמדדו",
        doneMeans: [
          "chain.pulse הופעל והחזיר headBefore/headAfter לכל מסילה שנענתה",
          "שורת-דיווח עברית לגשר עם הדלתאות שנמדדו",
        ],
        budget: 3,
      }),
    });
    const rj = (await r.json()) as { ok: boolean; run?: { id: string }; runId?: string; error?: string };
    const runId = rj.runId || rj.run?.id;
    if (!rj.ok || !runId) throw new Error(`run launch failed: ${JSON.stringify(rj).slice(0, 300)}`);
    console.log(`RUN LAUNCHED: ${runId}`);

    // 3. poll to terminal
    let row: RunRow | null = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const g = await fetch(`${BASE}/api/gate/run?id=${runId}`, { headers: H });
      const gj = (await g.json()) as { ok: boolean; run?: RunRow; runs?: RunRow[] };
      row = gj.run ?? gj.runs?.[0] ?? null;
      if (!row) continue;
      if (!["queued", "running"].includes(row.status)) break;
    }
    if (!row) throw new Error("run row never appeared");
    console.log(`\nRUN RESULT: status=${row.status} brain=${row.brain} checker=${row.checker} duration=${row.durationMs ?? "?"}ms`);
    if (row.error) console.log(`ERROR: ${row.error}`);
    if (row.report) console.log(`REPORT: ${row.report}`);
    if (row.verdict) {
      try {
        const v = (typeof row.verdict === "string" ? JSON.parse(row.verdict) : row.verdict) as { done?: boolean; checks?: { criterion: string; pass: boolean }[]; gaps?: string };
        console.log(`VERDICT: done=${v.done} checks=${(v.checks || []).map((c) => `${c.pass ? "✓" : "✗"} ${c.criterion.slice(0, 60)}`).join(" | ")}`);
      } catch { /* raw verdict printed below */ }
    }
    // 4. tool evidence from the trace
    if (Array.isArray(row.steps)) {
      for (const st of row.steps as Array<{ side: string; tool?: string; ok?: boolean; result?: unknown; ms?: number }>) {
        if (st.tool === "chain.pulse") {
          const res = st.result as { meaning?: string; rails?: unknown[] } | null;
          console.log(`EVIDENCE chain.pulse: ok=${st.ok} ms=${st.ms}`);
          if (res?.meaning) console.log(`  meaning: ${res.meaning}`);
          if (Array.isArray(res?.rails)) console.log(`  rails: ${JSON.stringify(res.rails).slice(0, 500)}`);
        } else if (st.tool) {
          console.log(`STEP ${st.side}:${st.tool} ok=${st.ok} ms=${st.ms ?? "-"}`);
        }
      }
    }

    // 5. pulse again — idleFired may have moved if the fleet was idle meanwhile
    const h2 = await fetch(`${BASE}/api/gate/heart`, { headers: H });
    const h2j = (await h2.json()) as { pulse?: { beats?: number; counters?: Record<string, number> } };
    console.log(`\nPULSE AFTER: beats=${h2j.pulse?.beats} idleFired=${h2j.pulse?.counters?.idleFired ?? 0}`);
    void RUN_ID_KEY;
  } finally {
    // 6. hygiene — revoke the proof session
    const l = await fetch(`${BASE}/api/gate/lock`, { method: "POST", headers: { Authorization: `Bearer ${sj.token}` } });
    console.log(`SESSION REVOKED: ${l.status} (401 expected after)`);
  }
}

main().catch((e) => { console.error("PROOF FAILED:", e instanceof Error ? e.message : e); process.exit(1); });

export {};
