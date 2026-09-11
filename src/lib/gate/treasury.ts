/**
 * TREASURY TRUTH (r21) — "יש לי קצת כסף במערכת" as a measured fact.
 * ══════════════════════════════════════════════════════════════════════
 * One snapshot, three rails: every fleet account's liquid + debt + vesting
 * balance read LIVE from the chains (condenser get_accounts via the
 * rails-server transport). The fleet roster is DERIVED FROM THE VAULT —
 * the accounts the vault knows about, never a hardcoded list. Every rail
 * fails honestly and independently: one dead node never fakes another
 * rail's truth (law 2 — live truth; law 4 — double proof happens at the
 * verification layer, not by wishful display).
 */
import { db } from "@/lib/db";
import { railAccounts, RAIL_ASSETS, type Rail } from "@/lib/social/rails-server";

export interface TreasuryRow {
  account: string;
  liquid: string; // raw chain string, e.g. "12.345 STEEM"
  debt: string; // raw chain string, e.g. "0.000 SBD"
  vesting: string | null; // raw chain string or null when the rail omits it
  liquidNum: number;
  debtNum: number;
}

export interface TreasuryRail {
  rail: Rail;
  ok: boolean;
  liquidSymbol: string;
  debtSymbol: string;
  accounts: TreasuryRow[];
  totals: { liquid: number; debt: number };
  error?: string;
}

export interface TreasurySnapshot {
  measuredAt: string;
  rails: TreasuryRail[];
  fleet: Record<string, number>; // rail → roster size
  cached: boolean;
}

const CACHE_MS = 30_000;
let cache: { at: number; snap: TreasurySnapshot } | null = null;

function assetNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.trim().split(/\s+/)[0]);
  return Number.isFinite(n) ? n : 0;
}

/** The fleet roster per rail — derived from the vault, never hardcoded.
 *  r21 honesty: material-label rows ("headcorner-legacy", "tron-legacy",
 *  "unknown") are not chain accounts — excluded so the count speaks truth
 *  (12 fleet accounts on steem, not 14). */
const ROSTER_EXCLUDE = /(^unknown$|-legacy$)/;
async function fleetRoster(rail: Rail): Promise<string[]> {
  const rows = await db.vaultEntry.findMany({
    where: { chain: rail },
    select: { account: true },
    distinct: ["account"],
  });
  return [...new Set(rows.map((r) => r.account).filter((x): x is string => x !== null && !ROSTER_EXCLUDE.test(x)))].sort();
}

async function measureRail(rail: Rail): Promise<TreasuryRail> {
  const assets = RAIL_ASSETS[rail];
  try {
    const roster = await fleetRoster(rail);
    if (roster.length === 0) {
      return { rail, ok: true, liquidSymbol: assets.liquid, debtSymbol: assets.debt, accounts: [], totals: { liquid: 0, debt: 0 } };
    }
    const raw = await railAccounts(rail, roster);
    const byName = new Map(raw.map((a) => [a.name, a]));
    const accounts: TreasuryRow[] = roster.map((name) => {
      const a = byName.get(name);
      const liquid = a?.balance ?? `0.000 ${assets.liquid}`;
      // steem/blurt expose sbd_balance; hive exposes hbd_balance — same debt slot
      const debt = (a?.sbd_balance ?? a?.hbd_balance) ?? `0.000 ${assets.debt}`;
      return {
        account: name,
        liquid,
        debt,
        vesting: a?.vesting_shares ?? null,
        liquidNum: assetNum(liquid),
        debtNum: assetNum(debt),
      };
    });
    const totals = {
      liquid: Math.round(accounts.reduce((s, a) => s + a.liquidNum, 0) * 1000) / 1000,
      debt: Math.round(accounts.reduce((s, a) => s + a.debtNum, 0) * 1000) / 1000,
    };
    return { rail, ok: true, liquidSymbol: assets.liquid, debtSymbol: assets.debt, accounts, totals };
  } catch (e) {
    // honest per-rail failure — never mask one dead node with another rail's data
    const msg = e instanceof Error ? e.message : String(e);
    return { rail, ok: false, liquidSymbol: assets.liquid, debtSymbol: assets.debt, accounts: [], totals: { liquid: 0, debt: 0 }, error: msg.slice(0, 200) };
  }
}

/** The live treasury snapshot (30s in-process cache; force=true re-measures). */
export async function getTreasurySnapshot(force = false): Promise<TreasurySnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.snap, cached: true };
  }
  const rails = await Promise.all((["steem", "hive", "blurt"] as Rail[]).map((r) => measureRail(r)));
  const fleet: Record<string, number> = {};
  for (const r of rails) fleet[r.rail] = r.accounts.length;
  const snap: TreasurySnapshot = { measuredAt: new Date().toISOString(), rails, fleet, cached: false };
  cache = { at: Date.now(), snap };
  return snap;
}
