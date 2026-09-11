/**
 * THE SITUATION PLANE (r22) — the vault's single awareness snapshot.
 * ==================================================================
 * The operator's directive: "בתור כספת אתה צריך להיות מודע הרבה יותר
 * ממנו למתרחש — מה יש ומה אין, מה אנחנו, איך לעקוב אחרי הכל בקלות
 * בלי עומס" — one call that answers: what do we have, what is happening
 * everywhere (including the OTHER repos of the org, where other agents
 * work), and what can honestly be generated from what exists.
 *
 * Zero-load rules:
 *  · One in-process snapshot, cached 60s — every poller shares it.
 *  · Every section is bounded and independent (allSettled) — one dead
 *    node / dead chain / dead repo never kills the picture.
 *  · No secrets ever leave here: counts, totals, public addresses only.
 *  · The org-repos section serves a cached file + a light one-call GitHub
 *    refresh at most every 10 minutes (stale-while-revalidate, in-memory
 *    lock) — "בלי עומס" also means the org API is never hammered.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { getTreasurySnapshot, type TreasurySnapshot } from "@/lib/gate/treasury";
import { ethereumEyes, solanaEyes } from "@/lib/multichain-server";
import { fleetRewardsCensus } from "@/lib/gate/harness/social";
import { readAnchorHistory } from "@/lib/gate/anchor";

const CACHE_MS = 60_000;
const REPO_REFRESH_MS = 10 * 60_000;
const ORG = "roshpinacare-sys";
const OUR_REPO = "Saosmartwallet";
const ORG_SCAN_FILE = "docs/org-scan.json";

export interface SituationRepo {
  name: string;
  language: string | null;
  sizeKB: number;
  pushedAt: string;
  pushedMinutesAgo: number | null;
  ours: boolean;
  fresh: boolean; // pushed within the last 3 hours — another agent is active
}

export interface SituationSnapshot {
  measuredAt: string;
  cached: boolean;
  treasury: Pick<TreasurySnapshot, "rails" | "measuredAt"> & { error?: string };
  evm: {
    ethereum: { ok: boolean; wallets: number; okWallets: number; total: string; block: number | null; via?: string; error?: string };
    solana: { ok: boolean; wallets: number; okWallets: number; total: string; slot: number | null; via?: string; error?: string };
  };
  rewards: {
    ok: boolean;
    accounts: number;
    pendingAccounts: Array<{ account: string; steemEquiv: number }>;
    totalPendingSteemEquiv: number;
    error?: string;
  };
  repos: {
    ok: boolean;
    org: string;
    scannedAt: string | null;
    ageMinutes: number | null;
    count: number;
    freshCount: number; // repos pushed in the last 3h — the org is alive
    repos: SituationRepo[];
    error?: string;
  };
  vault: { ok: boolean; total: number; verified: number; unverified: number; imported: number; operatorCustody: number; rotatedOut: number; chains: Record<string, number>; error?: string };
  fleet: { ok: boolean; agents: number; autonomous: number; activeRuns: number; error?: string };
  anchors: { ok: boolean; count: number; latest: Array<{ chain: string; txId: string; blockNum: number | null; at: string; round: string; signedBy: string }>; error?: string };
}

/* ------------------------------------------------------------------ */
/* org repos — light scan, stale-while-revalidate, in-memory lock      */
/* ------------------------------------------------------------------ */

type RepoCache = { rows: SituationRepo[]; scannedAt: string; refreshing: boolean };
const g = globalThis as unknown as { __saosRepoCache?: RepoCache };

async function readOrgScanFile(): Promise<{ rows: SituationRepo[]; scannedAt: string } | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), ORG_SCAN_FILE), "utf8");
    const parsed = JSON.parse(raw) as { scannedAt?: string; repos?: Array<{ name: string; language?: string | null; sizeKB?: number; pushedAt: string }> };
    if (!parsed?.repos?.length || !parsed.scannedAt) return null;
    const rows = parsed.repos.map((r) => toSituationRepo(r.name, r.language ?? null, r.sizeKB ?? 0, r.pushedAt));
    return { rows, scannedAt: parsed.scannedAt };
  } catch {
    return null;
  }
}

function toSituationRepo(name: string, language: string | null, sizeKB: number, pushedAt: string): SituationRepo {
  const pushedMs = Date.parse(pushedAt);
  return {
    name,
    language,
    sizeKB,
    pushedAt,
    pushedMinutesAgo: Number.isFinite(pushedMs) ? Math.max(0, Math.round((Date.now() - pushedMs) / 60_000)) : null,
    ours: name === OUR_REPO,
    fresh: Number.isFinite(pushedMs) ? Date.now() - pushedMs < 3 * 3600_000 : false,
  };
}

function githubHeaders(token: string): HeadersInit {
  return { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "User-Agent": "saos-situation-plane" };
}

async function readGithubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  try {
    const raw = (await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8")).trim();
    const line = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => /^ghp_|^github_pat_/.test(l));
    return line ?? null;
  } catch {
    return null;
  }
}

async function fetchOrgReposLight(): Promise<{ rows: SituationRepo[]; scannedAt: string }> {
  const token = await readGithubToken();
  if (!token) throw new Error("no github token (env GITHUB_TOKEN / upload/Roshcaregt.txt)");
  // roshpinacare-sys is a USER account (not an org) — /user/repos returns
  // every repo the token's user can see, sorted by push (repo-scan.ts proven).
  const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=pushed", { headers: githubHeaders(token), cache: "no-store" });
  if (!res.ok) throw new Error(`user repos HTTP ${res.status}`);
  const list = (await res.json()) as Array<{ name: string; language: string | null; size: number; pushed_at: string; archived: boolean }>;
  const rows = list
    .filter((r) => !r.archived)
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .map((r) => toSituationRepo(r.name, r.language, r.size, r.pushed_at));
  return { rows, scannedAt: new Date().toISOString() };
}

async function persistOrgScan(fresh: { rows: SituationRepo[]; scannedAt: string }): Promise<void> {
  // persist for other agents + cold starts (best-effort, never fatal)
  try {
    await mkdir(path.join(process.cwd(), "docs"), { recursive: true });
    await writeFile(path.join(process.cwd(), ORG_SCAN_FILE), JSON.stringify({ org: ORG, scannedAt: fresh.scannedAt, repos: fresh.rows }, null, 1), "utf8");
  } catch { /* disk best-effort */ }
}

async function orgReposSection() {
  const now = Date.now();
  let cache = g.__saosRepoCache;
  const stale = !cache || now - Date.parse(cache.scannedAt) > REPO_REFRESH_MS;
  const empty = !cache || cache.rows.length === 0;

  if (stale && empty) {
    // FIRST fill (or after a failure with nothing to serve): block briefly —
    // a single API call, never an empty org served forever.
    try {
      const fresh = await fetchOrgReposLight();
      cache = { rows: fresh.rows, scannedAt: fresh.scannedAt, refreshing: false };
      g.__saosRepoCache = cache;
      void persistOrgScan(fresh);
    } catch {
      // fetch failed honestly — fall back to the last persisted scan, and
      // rate-limit retries (scannedAt = now) so the org API is never hammered.
      const fromFile = await readOrgScanFile();
      const scannedAt = new Date().toISOString();
      cache = { rows: fromFile?.rows ?? [], scannedAt: fromFile?.scannedAt ?? scannedAt, refreshing: false };
      g.__saosRepoCache = cache;
    }
  } else if (stale && cache && !cache.refreshing) {
    // stale-while-revalidate: serve what we have, refresh in background
    cache.refreshing = true;
    void fetchOrgReposLight()
      .then(async (fresh) => {
        g.__saosRepoCache = { rows: fresh.rows, scannedAt: fresh.scannedAt, refreshing: false };
        await persistOrgScan(fresh);
      })
      .catch(() => { if (g.__saosRepoCache) g.__saosRepoCache.refreshing = false; });
  }

  const served = g.__saosRepoCache;
  const rows = served?.rows ?? [];
  const scannedAt = served?.scannedAt ?? null;
  if (rows.length === 0) return { ok: false, org: ORG, scannedAt, ageMinutes: null, count: 0, freshCount: 0, repos: [] as SituationRepo[], error: "org repos unavailable (fetch failed + no persisted scan)" };
  return {
    ok: true,
    org: ORG,
    scannedAt,
    ageMinutes: scannedAt ? Math.round((now - Date.parse(scannedAt)) / 60_000) : null,
    count: rows.length,
    freshCount: rows.filter((r) => r.fresh).length,
    repos: rows,
  };
}

/* ------------------------------------------------------------------ */
/* the snapshot                                                        */
/* ------------------------------------------------------------------ */

let sitCache: { at: number; snap: SituationSnapshot } | null = null;

export async function getSituationSnapshot(force = false): Promise<SituationSnapshot> {
  if (!force && sitCache && Date.now() - sitCache.at < CACHE_MS) return { ...sitCache.snap, cached: true };

  const [treasuryRes, ethRes, solRes, censusRes, reposRes, vaultRes, fleetRes, anchorRes] = await Promise.allSettled([
    getTreasurySnapshot(),
    ethereumEyes(),
    solanaEyes(),
    fleetRewardsCensus(),
    orgReposSection(),
    db.vaultEntry.groupBy({ by: ["status"], _count: true }),
    db.vaultEntry.groupBy({ by: ["chain"], _count: true, where: { status: { not: "rotated-out" } } }).then(async (chains) => {
      const agents = await db.gateAgent.count({ where: { active: true } });
      const autonomous = await db.gateAgent.count({ where: { active: true, autonomy: true } });
      const activeRuns = await db.gateRun.count({ where: { status: { in: ["queued", "running"] } } });
      return { chains, agents, autonomous, activeRuns };
    }),
    readAnchorHistory(),
  ]);

  const t = treasuryRes.status === "fulfilled" ? treasuryRes.value : null;

  const ethOk = ethRes.status === "fulfilled";
  const e = ethOk ? ethRes.value : null;
  const solOk = solRes.status === "fulfilled";
  const s = solOk ? solRes.value : null;

  const c = censusRes.status === "fulfilled" ? censusRes.value : null;
  const pendingAccounts = c ? c.accounts.filter((a) => a.steemEquiv > 0).map((a) => ({ account: a.account, steemEquiv: a.steemEquiv })) : [];

  const statusCounts: Record<string, number> = {};
  if (vaultRes.status === "fulfilled") for (const r of vaultRes.value) statusCounts[r.status] = r._count;

  const chains: Record<string, number> = {};
  let fleet = { agents: 0, autonomous: 0, activeRuns: 0 };
  if (fleetRes.status === "fulfilled") {
    for (const r of fleetRes.value.chains) if (r.chain) chains[r.chain] = r._count;
    fleet = { agents: fleetRes.value.agents, autonomous: fleetRes.value.autonomous, activeRuns: fleetRes.value.activeRuns };
  }

  const anchorsAll = anchorRes.status === "fulfilled" ? anchorRes.value : [];

  const snap: SituationSnapshot = {
    measuredAt: new Date().toISOString(),
    cached: false,
    treasury: t ? { rails: t.rails, measuredAt: t.measuredAt } : { rails: [], measuredAt: new Date().toISOString(), error: "treasury failed honestly" },
    evm: {
      ethereum: e
        ? { ok: true, wallets: e.wallets.length, okWallets: e.totalOk, total: e.totalBalanceEth, block: e.chain?.blockHeight ?? null, via: e.chain?.via }
        : { ok: false, wallets: 0, okWallets: 0, total: "0", block: null, error: "ethereum eyes failed honestly" },
      solana: s
        ? { ok: true, wallets: s.wallets.length, okWallets: s.totalOk, total: s.totalBalanceSol, slot: s.chain?.blockHeight ?? null, via: s.chain?.via }
        : { ok: false, wallets: 0, okWallets: 0, total: "0", slot: null, error: "solana eyes failed honestly" },
    },
    rewards: c
      ? { ok: true, accounts: c.accounts.length, pendingAccounts, totalPendingSteemEquiv: c.totalSteemEquiv ?? pendingAccounts.reduce((acc, a) => acc + a.steemEquiv, 0) }
      : { ok: false, accounts: 0, pendingAccounts: [], totalPendingSteemEquiv: 0, error: "rewards census failed honestly" },
    repos: reposRes.status === "fulfilled" ? (reposRes.value as SituationSnapshot["repos"]) : { ok: false, org: ORG, scannedAt: null, ageMinutes: null, count: 0, freshCount: 0, repos: [], error: "org repos failed honestly" },
    vault: {
      ok: vaultRes.status === "fulfilled",
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      verified: statusCounts["verified"] ?? 0,
      unverified: statusCounts["unverified"] ?? 0,
      imported: statusCounts["imported"] ?? 0,
      operatorCustody: statusCounts["operator-custody"] ?? 0,
      rotatedOut: statusCounts["rotated-out"] ?? 0,
      chains,
    },
    fleet: { ok: fleetRes.status === "fulfilled", ...fleet },
    anchors: {
      ok: anchorRes.status === "fulfilled",
      count: anchorsAll.length,
      latest: anchorsAll.slice(0, 3).map((a) => ({
        chain: a.chain,
        txId: String(a.txId ?? "").slice(0, 14),
        blockNum: a.blockNum,
        at: String(a.at ?? ""),
        round: String(a.round ?? ""),
        signedBy: String(a.signedBy ?? ""),
      })),
    },
  };

  sitCache = { at: Date.now(), snap };
  return snap;
}
