import { db } from "@/lib/db";
import { masterReady, setMaster } from "@/lib/gate/crypto";
import { requireOperator, openSessionMaster } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { verifyAll } from "@/lib/gate/verify";
import { rotationStatus } from "@/lib/gate/rotation";

export const runtime = "nodejs";

/** GET /api/gate/inventory — operator. Live-verify the whole vault (fresh chain calls).
 *  r13: also ships the LIVE status of the steemauto door-closure proposal
 *  (the custody banner computes its claim from it — no hardcoded truths). */
export async function GET() {
  try {
    await requireOperator();
    if (!masterReady()) {
      // wake from the session's sealed master (server restarted mid-session)
      const m = await openSessionMaster();
      if (m) setMaster(m);
    }
    if (!masterReady()) {
      const count = await db.vaultEntry.count();
      return ok({ locked: true, entries: [], counts: { total: count }, note: "הכספת נעולה — פתח כדי לאמת live" });
    }
    const { entries, steemOk, hiveOk, blurtOk, githubOk } = await verifyAll();
    const summary = {
      total: entries.length,
      verified: entries.filter((e) => e.liveOk === true).length,
      failed: entries.filter((e) => e.liveOk === false).length,
      // r19 — rotated-out rows are EXPECTED to fail a live check (their keys
      // are no longer on chain by design); they are history, not failures.
      rotatedOut: entries.filter((e) => e.status === "rotated-out").length,
      noLive: entries.filter((e) => e.liveOk === null).length,
      rails: {
        steem: entries.filter((e) => e.chains.includes("steem")).length,
        hive: entries.filter((e) => e.chains.includes("hive")).length,
        blurt: entries.filter((e) => e.chains.includes("blurt")).length,
        ethereum: entries.filter((e) => e.chains.includes("ethereum")).length,
        tron: entries.filter((e) => e.chains.includes("tron")).length,
        solana: entries.filter((e) => e.chains.includes("solana")).length,
        bitcoin: entries.filter((e) => e.chains.includes("bitcoin")).length,
        github: entries.filter((e) => e.chains.includes("github")).length,
      },
    };
    // r13 gap-54 — the custody banner's "open proposal awaiting operator"
    // claim is computed LIVE from the proposal table, never hardcoded:
    // a hardcoded truth expired once already (the r12 filing died as
    // "expired" 16s in) and the page kept saying "open".
    // r15 gap-57 — "launched" alone still allowed the page to claim "the run
    // is alive right now" while the run had already blocked honestly (the
    // steemauto closure run died to a missing tool). The banner now reads the
    // RUN's terminal state too — a claim may never outlive its evidence.
    const steemauto = await db.gateProposal.findFirst({
      where: { goal: { contains: "steemauto" } },
      orderBy: { createdAt: "desc" },
      select: { status: true, decidedBy: true, createdAt: true, runId: true },
    });
    let steemautoRunStatus: string | null = null;
    if (steemauto?.runId) {
      steemautoRunStatus = await db.gateRun.findUnique({ where: { id: steemauto.runId }, select: { status: true } }).then((r) => r?.status ?? null);
    }
    // r16 — the rotation plane's readiness, computed live (sealed owner keys ×
    // sealed P5 roots vs the CURRENT chain authorities). The custody banner and
    // the rotation panel render from this — never from stored assumptions.
    let rotation: Awaited<ReturnType<typeof rotationStatus>> | null = null;
    try { rotation = await rotationStatus(); } catch { rotation = null; }
    return ok({ locked: false, entries, summary, chains: { steemOk, hiveOk, blurtOk, githubOk }, steemautoProposal: steemauto ? { ...steemauto, runStatus: steemautoRunStatus } : null, rotation });
  } catch (e) {
    return fail(e);
  }
}
