/**
 * CONVERSION PLANE (r21) — "להמיר מה שצריך" as an engineered rail.
 * ══════════════════════════════════════════════════════════════════════
 * Until r21 the sovereign-hand DEX was ONE account (headcorner) on ONE rail
 * (steem). The fleet's money lives across 12 accounts and three chains, so
 * the plane generalizes BOTH axes while keeping every sovereignty rail:
 *
 *   · rail axis   — steem (STEEM/SBD) + hive (HIVE/HBD). Blurt is honestly
 *     EXCLUDED: its debt asset book (BBD) was never live-proven, and an
 *     unproven market is not a conversion path (doctrine: measure, then ship).
 *   · account axis — any account whose ACTIVE key sits VERIFIED in the vault.
 *     The vault is the only key source; agent input can never widen it.
 *   · signing     — the vault signs ONLY on an explicit operator decision
 *     (unchanged); building stays key-free (unchanged); the chain remains
 *     the final judge.
 *
 * Division of labor (mirrors the SOVEREIGN-HAND doctrine):
 *   dex-rail.ts  — rails, assets, fleet roster, vault keys, RC honesty.
 *   orders.ts    — the GateOrder queue: agent builds → operator decides →
 *                  the vault signs with THE ORDER'S OWN account key.
 */
import { db } from "@/lib/db";
import { GateError } from "@/lib/gate/crypto";
import { vaultActiveKey } from "@/lib/gate/signing-key";
import { steemAdapter, steemBroadcastAdapter } from "@/lib/steem-server";
import { hiveAdapter, hiveBroadcastAdapter, railRpc, HIVE_CHAIN_ID } from "@/lib/social/rails-server";
import type { SteemAdapter } from "../../../packages/chains/steem/src/adapter";

export type ConversionRail = "steem" | "hive";

/**
 * The rail asset pairs — WIRE vs DISPLAY, and why they differ (r21 discovery,
 * node-proven): hive's JSON layer accepts "HIVE"/"HBD" spellings but its wire
 * serializer (get_transaction_hex) emits the INTERNAL graphene symbols —
 * real block 92644300 (deepcrypto8, 200.000 @@000000021 = "HIVE") carries the
 * wire symbol "STEEM"; "5.000 HBD" echoes back with symbol "SBD". The local
 * serializer must produce the INTERNAL bytes or the digest diverges and the
 * chain answers "missing active authority". Display names stay HIVE/HBD.
 * (steemit.com REJECTS the "HBD" spelling outright — assert — so the wire
 * names are the only safe build currency on both rails.)
 */
export const CONVERSION_RAILS: Record<
  ConversionRail,
  { wire: { liquid: string; debt: string }; display: { liquid: string; debt: string } }
> = {
  steem: { wire: { liquid: "STEEM", debt: "SBD" }, display: { liquid: "STEEM", debt: "SBD" } },
  hive: { wire: { liquid: "STEEM", debt: "SBD" }, display: { liquid: "HIVE", debt: "HBD" } },
};

/** The rail signing domains (informational digest fields; the adapter re-signs authoritatively). */
const ZEROS_CHAIN_ID = new Uint8Array(32);
export function railChainId(rail: ConversionRail): Uint8Array {
  return rail === "hive" ? HIVE_CHAIN_ID : ZEROS_CHAIN_ID;
}

/** Why blurt is not a conversion rail — the honest reason, in one string. */
export const BLURT_EXCLUSION =
  "blurt מוצא כנות מחוץ למישור-ההמרות: ספר-BBD מעולם לא נמדד חי (שוק ללא הוכחת-חיים אינו נתיב-המרה) — ייפתח רק אחרי מדידה";

/** Parse + validate a rail from agent/operator input. Fails honestly. */
export function conversionRailOf(x: unknown): ConversionRail {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "steem" || s === "") return "steem"; // default preserves the r18 behavior
  if (s === "hive") return "hive";
  throw new GateError("bad-input", `מסילת-המרה: "steem"|"hive" בלבד (${BLURT_EXCLUSION})`);
}

/** Read + broadcast adapter pair per rail — every endpoint live-verified. */
export function railAdapters(rail: ConversionRail): { read: SteemAdapter; broadcast: SteemAdapter } {
  if (rail === "hive") return { read: hiveAdapter(), broadcast: hiveBroadcastAdapter() };
  return { read: steemAdapter(), broadcast: steemBroadcastAdapter() };
}

/**
 * The fleet roster the vault can actually sign for on this rail: accounts
 * with a VERIFIED active key row. Derived from the vault — never hardcoded,
 * never widened by agent input. (ynet appears as an account but holds no
 * vault active key ⇒ honestly absent from every signing roster.)
 */
export async function fleetAccountsForRail(rail: ConversionRail): Promise<string[]> {
  const rows = await db.vaultEntry.findMany({
    where: { chain: rail, role: "active", status: "verified" },
    select: { account: true },
    distinct: ["account"],
  });
  return rows.map((r) => r.account).filter((x): x is string => Boolean(x)).sort();
}

/** Can the vault sign for this account on this rail? (used at BUILD time — fail closed, loudly). */
export async function assertRailSigner(account: string, rail: ConversionRail): Promise<void> {
  const fleet = await fleetAccountsForRail(rail);
  if (!fleet.includes(account)) {
    throw new GateError(
      "not-a-signer",
      `אין מפתח-active מאומת של ${account}@${rail} בכספת — אי אפשר להכין פקודה על חשבון שהכספת אינה שולטת בו (צי-החתימה: ${fleet.length})`,
    );
  }
}

/** The order's own ACTIVE key from the vault (the caller must hold requireMaster). */
export async function railActiveKey(account: string, rail: ConversionRail) {
  return vaultActiveKey(account, rail);
}

/**
 * RC honesty for hive (r19 lesson: the chain itself refused ops on RC-starved
 * accounts — burned broadcasts teach nothing). We MEASURE the manabar and
 * refuse BELOW a floor that the r19 measurements already falsified, instead
 * of spending a doomed broadcast. The chain remains the final judge — this
 * is a guardrail, not a verdict on mana above the floor.
 */
export const RC_MIN_CURRENT_MANA = 10_000_000; // 10M — below the smallest r19 max_rc (8.7M) that the chain starved

export async function rcGuardHive(account: string): Promise<{ current: number; max: number }> {
  const res = await railRpc<{ result?: Array<{ account: string; max_rc?: string; rc_manabar?: { current_mana?: string } }> }>(
    "hive",
    "condenser_api.find_rc_accounts",
    [[{ accounts: [account] }]],
  ).catch(() => null);
  const row = res?.result?.[0];
  const current = Number(row?.rc_manabar?.current_mana ?? "0");
  const max = Number(row?.max_rc ?? "0");
  if (!row || !Number.isFinite(current)) {
    // measurement unavailable — do NOT fabricate; let the chain judge
    return { current: NaN, max: NaN };
  }
  if (current < RC_MIN_CURRENT_MANA) {
    throw new GateError(
      "blocked-rc",
      `RC נמדד חי על ${account}@hive: ${current.toLocaleString("en-US")} מול רף-זהירות ${RC_MIN_CURRENT_MANA.toLocaleString("en-US")} — השרשרת תדחה כלכלית (שיעור-r19); הזרמת HP פותחת`,
    );
  }
  return { current, max };
}
