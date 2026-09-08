import { NextResponse } from "next/server";

import { withCache } from "@/lib/eco-server";
import { saosHubCached } from "@/lib/saos-hub";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * fleet-status.ts — Demo 3: Soldiers Fleet live dashboard feed
 * ============================================================
 * The 13-account Steem army (commander + soldiers + reserve), measured
 * LIVE against Steem mainnet on every call:
 *   · SP / VP / RC — the same regen formulas used by steemd explorers
 *   · lastActivity — the account's newest operation straight from
 *     account_history (type + human summary + age), so the dashboard
 *     shows what each soldier is DOING right now, not a cached claim.
 *   · online — RC above the protocol floor (10%), the same rule the
 *     fleet's RC-heal loop enforces.
 * Anti-mock: any measurement that fails is null with the reason.
 */

const STEEM_RPC = "https://api.steemit.com";
const TRON_RING = new Set(["tron-s0", "tron-s1", "tron-s2", "tron-s3", "tron-s4", "tron-s5"]);
const RC_ONLINE_FLOOR = 10; // percent — fleet discipline floor

async function steemRpc<T>(method: string, params: unknown, timeoutMs = 9_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(STEEM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: controller.signal,
      cache: "no-store",
    });
    const j = (await res.json()) as { result?: T; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "rpc error");
    return j.result as T;
  } finally {
    clearTimeout(timer);
  }
}

interface HistoryEntry {
  trx_id: string;
  block: number;
  timestamp: string;
  op: { type: string; value?: Record<string, unknown> };
}

const NAI: Record<string, string> = { "@@000000021": "STEEM", "@@000000013": "SBD", "@@000000037": "VESTS" };

function assetStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as { amount?: string; nai?: string; precision?: number };
    const sym = o.nai ? (NAI[o.nai] ?? o.nai) : "";
    return `${o.amount ?? "?"}${sym ? " " + sym : ""}`;
  }
  return String(v ?? "");
}

function summarizeOp(entry: HistoryEntry): string {
  const v = entry.op.value ?? {};
  switch (entry.op.type) {
    case "transfer_operation":
      return `${assetStr(v.amount)} → ${String(v.to)}${v.memo ? ` — ${String(v.memo).slice(0, 60)}` : ""}`;
    case "delegate_vesting_shares_operation":
      return `${assetStr(v.vesting_shares)} → ${String(v.delegatee)}`;
    case "custom_json_operation":
      return `${String(v.id)} ${String(v.json ?? "").slice(0, 70)}`;
    case "comment_operation":
      return `post/comment ${String(v.permlink ?? "").slice(0, 60)}`;
    case "vote_operation":
      return `${String(v.weight)}% → ${String(v.author)}/${String(v.permlink ?? "").slice(0, 40)}`;
    case "claim_reward_balance_operation":
      return `claim ${assetStr(v.reward_steem)} · ${assetStr(v.reward_sbd)} · ${assetStr(v.reward_vests)}`;
    case "limit_order_create_operation":
      return `${assetStr(v.amount_to_sell)} → ${assetStr(v.min_to_receive)}`;
    default:
      return JSON.stringify(v).slice(0, 80);
  }
}

export interface FleetOp {
  time: string;
  type: string;
  summary: string;
  trxId: string;
  ageMinutes: number;
}

export interface FleetSoldier {
  name: string;
  role: string;
  scopes: string[];
  sp: number | null;
  vpPct: number | null;
  rcPct: number | null;
  created: string | null;
  lastActivity: { time: string; type: string; summary: string; trxId: string; ageMinutes: number } | null;
  recentOps: FleetOp[];
  isOnline: boolean | null;
  note?: string;
}

export interface FleetStatus {
  ok: boolean;
  measuredAt: string;
  error?: string;
  total: number;
  online: number;
  statusLine: string;
  soldiers: FleetSoldier[];
  liveAccounts: number;
  probeError?: string;
}

async function fleetStatus(): Promise<FleetStatus> {
  const measuredAt = new Date().toISOString();
  try {
    // Roster from the SAOS HUB aggregation (delegations ∪ fleet-voice, minus TRON ring).
    const hub = await saosHubCached();
    if (!hub.ok) {
      return {
        ok: false,
        measuredAt,
        error: `roster unavailable: ${hub.stateError ?? "saos-hub failed"}`,
        total: 0,
        online: 0,
        statusLine: "0/0 — roster unavailable",
        soldiers: [],
        liveAccounts: 0,
      };
    }
    const roster = hub.soldiers.filter((s) => !TRON_RING.has(s.name));
    const names = roster.map((s) => s.name);

    // Parallel probes: account states + RC + last-10-ops history per soldier.
    const [accRes, rcRes, ...histories] = await Promise.all([
      steemRpc<Array<Record<string, unknown>>>("condenser_api.get_accounts", [names]).catch((e) => {
        return null;
      }),
      steemRpc<{ rc_accounts?: Array<{ account: string; max_rc?: string; rc_manabar?: { current_mana?: string } }> }>(
        "rc_api.find_rc_accounts",
        { accounts: names },
      ).catch(() => null),
      ...names.map((n) =>
        steemRpc<{ history?: Array<[number, HistoryEntry]> }>("account_history_api.get_account_history", {
          account: n,
          start: -1,
          limit: 10,
        }).catch(() => null),
      ),
    ]);

    const accBy = new Map<string, Record<string, unknown>>();
    for (const a of accRes ?? []) if (a?.name) accBy.set(String(a.name), a);
    const rcBy = new Map<string, { current?: number; max?: number }>();
    for (const a of rcRes?.rc_accounts ?? []) {
      rcBy.set(a.account, {
        current: a.rc_manabar?.current_mana !== undefined ? parseFloat(a.rc_manabar.current_mana) : undefined,
        max: a.max_rc !== undefined ? parseFloat(a.max_rc) : undefined,
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const soldiers: FleetSoldier[] = roster.map((row, i) => {
      const a = accBy.get(row.name);
      const note = a ? undefined : (hub.armyLiveError ?? "account probe failed");
      let sp: number | null = null;
      let vpPct: number | null = null;
      let created: string | null = null;
      if (a) {
        const vests = parseFloat(String(a.vesting_shares ?? "0"));
        sp = vests / 1e6;
        created = String(a.created ?? "").slice(0, 10);
        const vm = (a.voting_manabar ?? {}) as { current_mana?: string; last_update_time?: number };
        const maxMana = vests * 1e6;
        if (maxMana > 0 && vm.current_mana !== undefined && typeof vm.last_update_time === "number") {
          const regen = ((nowSec - vm.last_update_time) * maxMana) / 432_000; // 5-day regen
          vpPct = Math.min(100, Math.max(0, ((parseFloat(vm.current_mana) + regen) / maxMana) * 100));
          vpPct = Number(vpPct.toFixed(2));
        }
      }
      const rc = rcBy.get(row.name);
      const rcPct =
        rc?.current !== undefined && rc?.max !== undefined && rc.max > 0
          ? Number(Math.min(100, Math.max(0, (rc.current / rc.max) * 100)).toFixed(4))
          : null;

      // last activity from this soldier's own history
      const hist = histories[i]?.history;
      const recentOps: FleetOp[] = (hist ?? []).map(([, entry]) => {
        const tSec = Math.floor(new Date(entry.timestamp + "Z").getTime() / 1000);
        return {
          time: entry.timestamp,
          type: entry.op.type.replace(/_operation$/, ""),
          summary: summarizeOp(entry),
          trxId: entry.trx_id,
          ageMinutes: Math.max(0, Math.round((nowSec - tSec) / 60)),
        };
      }).reverse(); // newest first
      const lastActivity = recentOps[0]
        ? {
            time: recentOps[0].time,
            type: recentOps[0].type,
            summary: recentOps[0].summary,
            trxId: recentOps[0].trxId,
            ageMinutes: recentOps[0].ageMinutes,
          }
        : null;
      return {
        name: row.name,
        role: row.role,
        scopes: row.scopes,
        sp,
        vpPct,
        rcPct,
        created,
        lastActivity,
        recentOps,
        isOnline: rcPct === null ? null : rcPct > RC_ONLINE_FLOOR,
        note,
      };
    });

    const online = soldiers.filter((s) => s.isOnline === true).length;
    return {
      ok: true,
      measuredAt,
      total: soldiers.length,
      online,
      statusLine: `${online}/${soldiers.length} soldiers above RC floor (>${RC_ONLINE_FLOOR}%)`,
      soldiers,
      liveAccounts: accBy.size,
    };
  } catch (e) {
    return {
      ok: false,
      measuredAt,
      error: e instanceof Error ? e.message : "fleet probe failed",
      total: 0,
      online: 0,
      statusLine: "0/0 — probe failed",
      soldiers: [],
      liveAccounts: 0,
    };
  }
}

export async function fleetStatusCached(): Promise<FleetStatus> {
  return withCache("saos-fleet-status", 8_000, () => fleetStatus());
}
