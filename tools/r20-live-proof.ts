/**
 * r20 — live end-to-end proof of the ANCHOR-PLANE employment:
 * mint a session, check the fleet is idle (the operator's standing rule:
 * never stack on a working agent), launch ONE real budget-3 run on
 * anchor-agent whose doneMeans demand the NEW anchor.integrity module
 * (multi-rail chain verification + digest unity), poll to terminal state,
 * print the evidence, then REVOKE the session (hygiene).
 */
const BASE = "http://localhost:3000";

interface RunRow { id: string; status: string; brain: string; checker: string; report: string | null; error: string | null; steps: unknown; verdict: unknown; durationMs: number | null; meta: string | null }

async function main() {
  const s = await fetch(`${BASE}/api/gate/session`, { method: "POST" });
  const sj = (await s.json()) as { ok: boolean; token?: string };
  if (!sj.ok || !sj.token) throw new Error(`session mint failed: ${JSON.stringify(sj)}`);
  const H = { Authorization: `Bearer ${sj.token}`, "Content-Type": "application/json" };

  try {
    // 0. fleet idleness pre-check — never stack on a working agent
    const hRes = await fetch(`${BASE}/api/gate/heart`, { headers: H });
    const hj = (await hRes.json()) as { pulse?: { beats?: number; boot?: { codeSha: string }; counts?: { queued: number; running: number }; counters?: Record<string, number> }; counts?: { queued: number; running: number }; schedules?: Array<{ label: string }> };
    const counts = hj.counts ?? hj.pulse?.counts ?? { queued: 0, running: 0 };
    console.log(`PULSE: beats=${hj.pulse?.beats} codeSha=${hj.pulse?.boot?.codeSha} busy(q+running)=${counts.queued + counts.running}`);
    if ((counts.queued ?? 0) + (counts.running ?? 0) > 0) {
      console.log("FLEET BUSY — the proof run is skipped honestly (the operator's rule: agents are never blocked)");
      return;
    }
    const scheds = (hj.schedules ?? []).filter((x) => x.label.startsWith("anchor-watch")).map((x) => x.label);
    console.log(`ANCHOR-WATCH SCHEDULES: ${scheds.join(", ") || "none"}`);

    // 1. launch the real proof run
    const r = await fetch(`${BASE}/api/gate/run`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        agentName: "anchor-agent",
        goal: "בדיקת-תעסוקה חיה (r20): הפעל anchor.integrity והוכח מכנית שהעוגנים חיים על המסילות — אילו עוגנים על-השרשרת, האם יש אחדות-דיגסט, והאם יש סטייה; דווח לגשר בעברית בשורה-אחת עם המספרים",
        doneMeans: [
          "anchor.integrity הופעל והחזיר rails עם עוגן-חי או כשל-כן לכל מסילה",
          "שורת-דיווח עברית לגשר עם אחדות-הדיגסט והסטייה שנמדדו",
        ],
        budget: 3,
      }),
    });
    const rj = (await r.json()) as { ok: boolean; run?: { id: string }; runId?: string; error?: string };
    const runId = rj.runId || rj.run?.id;
    if (!rj.ok || !runId) throw new Error(`run launch failed: ${JSON.stringify(rj).slice(0, 300)}`);
    console.log(`RUN LAUNCHED: ${runId}`);

    // 2. poll to terminal
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
    if (row.report) console.log(`REPORT: ${row.report.slice(0, 600)}`);
    if (row.verdict) {
      try {
        const v = (typeof row.verdict === "string" ? JSON.parse(row.verdict) : row.verdict) as { done?: boolean; checks?: { criterion: string; pass: boolean }[]; gaps?: string };
        console.log(`VERDICT: done=${v.done} checks=${(v.checks || []).map((c) => `${c.pass ? "✓" : "✗"} ${c.criterion.slice(0, 60)}`).join(" | ")}`);
      } catch { /* raw below */ }
    }
    if (Array.isArray(row.steps)) {
      for (const st of row.steps as Array<{ side: string; tool?: string; ok?: boolean; result?: unknown; ms?: number }>) {
        if (st.tool === "anchor.integrity") {
          const res = st.result as { meaning?: string; unity?: boolean; drift?: boolean; rails?: unknown[] } | null;
          console.log(`EVIDENCE anchor.integrity: ok=${st.ok} ms=${st.ms} unity=${res?.unity} drift=${res?.drift}`);
          if (res?.meaning) console.log(`  meaning: ${res.meaning}`);
          if (Array.isArray(res?.rails)) console.log(`  rails: ${JSON.stringify(res.rails).slice(0, 600)}`);
        } else if (st.tool) {
          console.log(`STEP ${st.side}:${st.tool} ok=${st.ok} ms=${st.ms ?? "-"}`);
        }
      }
    }
  } finally {
    const l = await fetch(`${BASE}/api/gate/lock`, { method: "POST", headers: { Authorization: `Bearer ${sj.token}` } });
    console.log(`SESSION REVOKED: ${l.status}`);
  }
}

main().catch((e) => { console.error("PROOF FAILED:", e instanceof Error ? e.message : e); process.exit(1); });

export {};
