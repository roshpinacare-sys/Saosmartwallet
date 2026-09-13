import { db } from "@/lib/db";
import { masterReady, setMaster } from "@/lib/gate/crypto";
import { requireOperator, openSessionMaster } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { verifyAll } from "@/lib/gate/verify";
import { rotationStatus } from "@/lib/gate/rotation";
import { readAnchorHistory, verifyAnchorOnChain } from "@/lib/gate/anchor";

export const runtime = "nodejs";

/**
 * GET /api/gate/inventory — operator.
 *
 * r34 bug-hunt fix (2026-09-13): this endpoint used to run verifyAll() INLINE
 * on every load — a live chain sweep of all 248 secrets (STEEM/HIVE/BLURT RPC,
 * a GitHub PAT check, per-entry DB updates) — so the vault grid sat on
 * "הכול (0)" for minutes or hung entirely, and the memory-threshold restart
 * killed the whole portal mid-sweep. Now there are two honest modes:
 *
 *   · GET (default)            — instant. Last-known status straight from the
 *     DB (no decryption, works even while the master is sealed), anchors shown
 *     unverified ("?"), rotation null (the banner omits it honestly).
 *   · GET ?verify=1            — the full live sweep, exactly as before.
 *     Concurrent callers share one in-flight sweep instead of stacking.
 *
 * A 10-minute in-memory cache of the last full sweep gives the fast path the
 * freshest possible data on cold loads without touching the chains.
 */

type EntryV = Awaited<ReturnType<typeof verifyAll>>["entries"][number];
type Summaries = {
  total: number; verified: number; failed: number; rotatedOut: number; noLive: number;
  rails: Record<string, number>;
};
type SteemautoProposal = { status: string; decidedBy: string | null; createdAt: Date; runId: string | null; runStatus: string | null } | null;
type AnchorLine = { chain: string; txId: string; blockNum: number | null; round: string | null; at: string; onChain: boolean | null; digest: string | null };
type FullPayload = {
  locked: boolean;
  entries: EntryV[];
  summary: Summaries;
  chains: { steemOk: boolean; hiveOk: boolean; blurtOk: boolean; githubOk: boolean | null };
  steemautoProposal: SteemautoProposal;
  rotation: Awaited<ReturnType<typeof rotationStatus>> | null;
  anchors: AnchorLine[];
  mode: "full";
  lastVerifiedAt: string | null;
};
type SnapshotPayload = Omit<FullPayload, "mode" | "chains" | "anchors"> & {
  mode: "snapshot";
  chains: { steemOk: null; hiveOk: null; blurtOk: null; githubOk: null };
  anchors: AnchorLine[];
};

const FULL_TTL_MS = 10 * 60_000;
let fullCache: { at: number; payload: FullPayload } | null = null;
let verifyInFlight: Promise<FullPayload> | null = null;

/** Map a stored row to the EntryVerify shape WITHOUT any live call. */
function storedEntry(e: {
  id: string; kind: string; chain: string | null; account: string | null; role: string | null;
  pub: string | null; status: string; verifyNote: string | null;
}) {
  // honest mapping of the STORED status: only "verified" claims a live pass;
  // rotated-out rows are known-dead on chain (false); everything else = no
  // live claim (null) until a real sweep re-marks them.
  const liveOk = e.status === "verified" ? true : e.status === "rotated-out" ? false : null;
  return {
    id: e.id,
    kind: e.kind,
    chain: e.chain,
    account: e.account,
    role: e.role,
    pub: e.pub,
    status: e.status,
    verifyNote: e.verifyNote,
    liveOk,
    chains: e.chain ? [e.chain] : [],
    detail: e.verifyNote || "",
  };
}

function summarize(entries: Array<{ liveOk: boolean | null; chains: string[]; status: string }>): Summaries {
  return {
    total: entries.length,
    verified: entries.filter((e) => e.liveOk === true).length,
    failed: entries.filter((e) => e.liveOk === false && e.status !== "rotated-out").length,
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
}

async function steemautoBlock(): Promise<SteemautoProposal> {
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
  return steemauto ? { ...steemauto, runStatus: steemautoRunStatus } : null;
}

async function buildFull(): Promise<FullPayload> {
  const { entries, steemOk, hiveOk, blurtOk, githubOk } = await verifyAll();
  // r16 — the rotation plane's readiness, computed live (sealed owner keys ×
  // sealed P5 roots vs the CURRENT chain authorities). The custody banner and
  // the rotation panel render from this — never from stored assumptions.
  let rotation: Awaited<ReturnType<typeof rotationStatus>> | null = null;
  try { rotation = await rotationStatus(); } catch { rotation = null; }
  // r20 — the multi-rail anchor plane, verified LIVE (get_transaction →
  // get_block scan) — the banner renders from this, never from a stored era.
  const anchorHist = await readAnchorHistory();
  const anchors = await Promise.all(anchorHist.slice(0, 3).map(async (a) => {
    const v = await verifyAnchorOnChain(a.chain as never, a.txId, undefined, a.blockNum).catch(() => ({ onChain: false, digest: null as string | null, blockNum: null as number | null }));
    return { chain: a.chain, txId: a.txId, blockNum: v.blockNum ?? a.blockNum, round: a.round, at: a.at, onChain: v.onChain, digest: v.digest };
  }));
  const lastVerifiedAt = entries.map((e) => e).length ? new Date().toISOString() : null;
  return {
    locked: false,
    entries,
    summary: summarize(entries),
    chains: { steemOk, hiveOk, blurtOk, githubOk },
    steemautoProposal: await steemautoBlock(),
    rotation,
    anchors,
    mode: "full",
    lastVerifiedAt,
  };
}

async function buildSnapshot(): Promise<SnapshotPayload> {
  const rows = await db.vaultEntry.findMany({
    orderBy: [{ chain: "asc" }, { account: "asc" }, { role: "asc" }],
    select: { id: true, kind: true, chain: true, account: true, role: true, pub: true, status: true, verifyNote: true },
  });
  const entries = rows.map(storedEntry);
  const anchorHist = await readAnchorHistory();
  const anchors = anchorHist.slice(0, 3).map((a) => ({
    chain: a.chain, txId: a.txId, blockNum: a.blockNum ?? null, round: a.round, at: a.at,
    // snapshot mode: no chain verification happened — honest "?" in the banner
    onChain: null as boolean | null, digest: null as string | null,
  }));
  const lastVerifiedAt = (await db.vaultEntry.findFirst({
    where: { verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
    select: { verifiedAt: true },
  }))?.verifiedAt?.toISOString() ?? null;
  return {
    locked: false,
    entries,
    summary: summarize(entries),
    chains: { steemOk: null, hiveOk: null, blurtOk: null, githubOk: null },
    steemautoProposal: await steemautoBlock(),
    rotation: null,
    anchors,
    mode: "snapshot",
    lastVerifiedAt,
  };
}

export async function GET(req: Request) {
  try {
    await requireOperator();
    const verify = new URL(req.url).searchParams.get("verify") === "1";

    if (verify) {
      if (!masterReady()) {
        // wake from the session's sealed master (server restarted mid-session)
        const m = await openSessionMaster();
        if (m) setMaster(m);
      }
      if (!masterReady()) {
        const count = await db.vaultEntry.count();
        return ok({ locked: true, entries: [], counts: { total: count }, note: "הכספת נעולה — פתח כדי לאמת live" });
      }
      // r34 — concurrent callers share one sweep instead of stacking 248-entry
      // chain verifications on top of each other
      if (!verifyInFlight) {
        verifyInFlight = buildFull().finally(() => { verifyInFlight = null; });
      }
      const payload = await verifyInFlight;
      fullCache = { at: Date.now(), payload };
      return ok(payload);
    }

    // fast path: freshest full sweep if it is young, else the honest snapshot
    if (fullCache && Date.now() - fullCache.at < FULL_TTL_MS) {
      return ok({ ...fullCache.payload, mode: "full" as const, cached: true, cachedAt: new Date(fullCache.at).toISOString() });
    }
    return ok(await buildSnapshot());
  } catch (e) {
    return fail(e);
  }
}
