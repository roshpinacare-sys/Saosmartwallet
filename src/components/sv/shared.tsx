'use client';

// ─── shared primitives — types · auth carriers · data formatting ───────────

import { Badge } from '@/components/ui/badge';

export type RoleKey = { role: string; verified: boolean; lastVerifiedAt: string | null; pubKey: string | null; fingerprint: string; source: string; lastError: string | null };
export type StatusData = {
  me: string | null;
  totals: { keys: number; verified: number; accounts: number };
  byAccount: Record<string, Record<string, RoleKey>>;
  balances: Record<string, Record<string, string>>;
  guard: { ownerLock: boolean; note: string; updatedAt: string | null };
  agents: Array<{ name: string; capabilities: string; status: string; lastSeenAt: string | null }>;
  sessions: number | null;
  tasksOpen: number | null;
};
export type ChatMsg = { id: string; author: string; role: string; content: string; createdAt: string };
export type TaskT = { id: string; title: string; detail: string; createdBy: string; assignedTo: string; status: string; result: string; createdAt: string };
export type AuditRow = { id: string; action: string; detail: string; createdAt: string };

export const ROLES = ['owner', 'active', 'posting', 'memo'] as const;
export const CHAIN_KEYS = ['steem', 'hive', 'blurt'] as const;
export type ChainId = (typeof CHAIN_KEYS)[number];

export const CHAIN_META: Record<ChainId, { label: string; dot: string; text: string; soft: string }> = {
  steem: { label: 'STEEM', dot: 'bg-emerald-500', text: 'text-emerald-700', soft: 'bg-emerald-50' },
  hive: { label: 'HIVE', dot: 'bg-amber-500', text: 'text-amber-700', soft: 'bg-amber-50' },
  blurt: { label: 'BLURT', dot: 'bg-rose-500', text: 'text-rose-700', soft: 'bg-rose-50' },
};

// ── SAOS tower types (from /api/saos/*) ──
export type SaosMatrixRow = { network: string; status: string; gate: string | null; detail: string; recovery: string | null };
export type SaosSeal = { id: string; height: number; root: string; stateRoot: string; leaves: number; gasUsed: number; createdAt: string; anchors: Array<{ network?: string; txRef?: string; state?: string } | string> };
export type SaosReceipt = { kind: string; digest: string; prevDigest: string; at: string };
export type SaosStatus = {
  ok: boolean;
  motto: string;
  matrix: SaosMatrixRow[];
  historic: Array<{ network: string; txRef: string; state: string; note: string }>;
  seals: SaosSeal[];
  receipts: SaosReceipt[];
  opsLogged: number;
};
export type SaosKernelCheck = { name: string; pass: boolean; detail: string };

// ── session persistence (dual-carrier) ─────────────────────────────────────
// The token lives BOTH in an httpOnly cookie (server-set) AND in localStorage
// (sent as Bearer on every request). Cross-origin iframe previews block
// third-party cookies — the Bearer carrier is what keeps you logged in there.
const TOKEN_KEY = 'sv_session_token';
export function getToken(): string { try { return window.localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
export function storeToken(t: string) { try { if (t) window.localStorage.setItem(TOKEN_KEY, t); else window.localStorage.removeItem(TOKEN_KEY); } catch { /* */ } }
export function authHeaders(): Record<string, string> { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }

// ── relative time (Hebrew) ──
export function fmtAgo(iso?: string | null): string {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 0) return 'עכשיו';
  const m = Math.floor(d / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return `לפני ${Math.floor(h / 24)} ימ׳`;
}

export function fmtNum(n: number, digits = 3): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

// ── balance parsing — per-chain aggregates for the hero band ──
export type ChainTotals = { liquid: number; debt: number; vests: number; savings: number };
export function perChainTotals(balances?: StatusData['balances']): Record<string, ChainTotals> {
  const res: Record<string, ChainTotals> = {};
  const num = (s?: string) => (s ? parseFloat(s.split(' ')[0]) || 0 : 0);
  for (const [key, row] of Object.entries(balances || {})) {
    const chain = key.split('@')[1];
    if (!chain || !row) continue;
    const t = (res[chain] ||= { liquid: 0, debt: 0, vests: 0, savings: 0 });
    t.liquid += num(row.liquid);
    t.debt += num(row.debt);
    t.vests += num(row.vests);
    t.savings += num(row.savings);
  }
  return res;
}

// ── live balance line under each account ──
export function BalLine({ b, chain }: { b?: Record<string, string>; chain?: string }) {
  if (!b || !b.liquid) return null;
  const isDebtZero = b.debt === '0.000 SBD' || b.debt === '0.000 HBD';
  const savingsZero = b.savings === '0.000 STEEM' || b.savings === '0.000 HIVE' || b.savings === '0.000 BLURT';
  return (
    <div className="mt-2 pt-2 border-t border-[#eeeeea] flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-data" dir="ltr">
      {chain && <span className="inline-flex items-center gap-1 text-zinc-400"><span className={`w-1 h-1 rounded-full ${CHAIN_META[chain as ChainId]?.dot || 'bg-zinc-400'}`} />{chain.toUpperCase()}</span>}
      <span className="text-emerald-700 font-medium">{b.liquid}</span>
      {b.debt && !isDebtZero && <span className="text-amber-700">{b.debt}</span>}
      {b.vests && <span className="text-zinc-400">{Number(b.vests.replace(' VESTS', '')).toLocaleString('en-US', { maximumFractionDigits: 0 })} VESTS</span>}
      {b.savings && !savingsZero && <span className="text-zinc-400">savings {b.savings}</span>}
    </div>
  );
}

// ── role chip — verified state is the ONLY color signal ──
export function RoleChip({ k, chain }: { k: RoleKey; chain: string }) {
  const isChain = chain === 'steem' || chain === 'hive' || chain === 'blurt';
  const cls = !isChain
    ? 'bg-zinc-100 text-zinc-600 border-zinc-200'
    : k.verified
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-rose-50 text-rose-700 border-rose-200';
  return (
    <Badge variant="outline" className={`${cls} inline-flex items-center gap-1.5 px-1.5 py-0`} title={`${k.fingerprint} · ${k.lastError || (isChain ? (k.verified ? 'חי מול השרשרת' : 'לא חי') : 'חומר מוצפן')}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CHAIN_META[chain as ChainId]?.dot || 'bg-zinc-400'}`} />
      <span className="font-data text-[10px]" dir="ltr">{chain}:{k.role}{isChain ? (k.verified ? ' ✓' : ' ✗') : ''}</span>
    </Badge>
  );
}
