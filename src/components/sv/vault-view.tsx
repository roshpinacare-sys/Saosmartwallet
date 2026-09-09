'use client';

// ─── vault — the monospace key matrix ──────────────────────────────────────
// 12+ accounts × chains × roles. Never renders raw material — masked
// fingerprints only, hover to inspect. Filters are reversible.

import { useState } from 'react';
import { RefreshCw, Search, ChevronDown, Archive, Lock } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { CHAIN_KEYS, CHAIN_META, BalLine, RoleChip } from './shared';
import type { StatusData, ChainId } from './shared';

type ChainFilter = 'all' | ChainId;

export function VaultView({ status, verifying, onVerifyAll }: {
  status: StatusData | null;
  verifying: boolean;
  onVerifyAll: () => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ChainFilter>('all');

  const entries = Object.entries(status?.byAccount || {});
  const chainAccounts = entries.filter(([a]) => !a.includes(':') && !a.includes('archive') && !['saos-rot1', 'sovereign', 'tron', 'tron-legacy'].includes(a));
  const materialAccounts = entries.filter(([a]) => a.includes(':') && !a.includes('archive') || ['saos-rot1', 'sovereign', 'tron', 'tron-legacy'].includes(a));
  const archiveAccounts = entries.filter(([a]) => a.includes('archive'));

  const match = (acct: string) => !q || acct.toLowerCase().includes(q.toLowerCase());
  const chainVisible = (key: string) => filter === 'all' || key.startsWith(`${filter}:`);

  const filtered = chainAccounts.filter(([a]) => match(a));
  const fullyControlled = filtered.filter(([, chains]) =>
    CHAIN_KEYS.some(c => Object.keys(chains).some(k => k.startsWith(`${c}:`))) &&
    CHAIN_KEYS.every(c => Object.entries(chains).filter(([k]) => k.startsWith(`${c}:`)).every(([, k]) => k.verified)) &&
    Object.keys(chains).length > 0
  ).length;

  return (
    <div className="space-y-4">
      {/* header + controls */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight leading-tight">כספת המפתחות</h1>
          <p className="text-[12px] text-zinc-600 mt-0.5">
            מטריצת שליטה חיה · {status?.totals.accounts} ישויות · {status?.totals.verified} מאומתות-חי מול השרשרת · אימות-אוטומטי כל 5 דק׳
          </p>
        </div>
        <button onClick={onVerifyAll} disabled={verifying} className="h-9 px-3.5 rounded-lg border border-[#34343c] bg-[#17171c] hover:bg-[#1d1d22] text-[12px] text-zinc-300 transition-colors inline-flex items-center gap-2 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />אמת הכל עכשיו
        </button>
      </div>

      {/* filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-44 max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש חשבון..." className="bg-[#0c0c0e] border-[#26262c] h-9 pr-9 text-[12px]" />
        </div>
        <div className="flex gap-1" role="group" aria-label="סינון שרשרת">
          {(['all', ...CHAIN_KEYS] as const).map(c => (
            <button
              key={c}
              onClick={() => setFilter(c as ChainFilter)}
              aria-pressed={filter === c}
              className={`h-9 px-3 rounded-lg text-[11px] font-data border transition-colors ${filter === c ? 'bg-[#17171c] border-[#d4a94e]/50 text-[#ecd28b]' : 'bg-[#0c0c0e] border-[#26262c] text-zinc-500 hover:text-zinc-300'}`}
              dir="ltr"
            >
              {c === 'all' ? 'ALL' : CHAIN_META[c as ChainId].label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-zinc-600 font-data" dir="ltr">{filtered.length} accts · {fullyControlled} full-control</span>
      </div>

      {/* the matrix */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map(([acct, chains]) => (
          <div key={acct} className="sv-card p-4">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-data font-semibold text-[13px] text-zinc-100" dir="ltr">{acct}</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/90">
                <Lock className="w-3 h-3" />בשליטה מלאה
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(['steem', 'hive', 'blurt'] as const).map(c => ['owner', 'active', 'posting', 'memo'].map(r => {
                const key = `${c}:${r}`;
                const k = chains[key];
                return k && chainVisible(key) ? <RoleChip key={key} k={k} chain={c} /> : null;
              }))}
            </div>
            {(filter === 'all' || filter === 'steem') && <BalLine b={status?.balances?.[`${acct}@steem`]} chain="steem" />}
            {(filter === 'all' || filter === 'hive') && <BalLine b={status?.balances?.[`${acct}@hive`]} chain="hive" />}
            {(filter === 'all' || filter === 'blurt') && <BalLine b={status?.balances?.[`${acct}@blurt`]} chain="blurt" />}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="sv-card p-8 text-center text-[12px] text-zinc-600 col-span-full">לא נמצאו חשבונות לחיפוש זה</div>
        )}
      </div>

      {/* material + archive */}
      {(materialAccounts.length > 0 || archiveAccounts.length > 0) && (
        <Collapsible>
          <CollapsibleTrigger className="sv-well w-full px-4 py-2.5 flex items-center justify-between text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
            <span className="inline-flex items-center gap-2"><Archive className="w-3.5 h-3.5" />חומר נוסף בכספת ({materialAccounts.length + archiveAccounts.length}) — גנזך מוצפן</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {materialAccounts.filter(([a]) => match(a)).map(([acct, chains]) => (
                <div key={acct} className="sv-well p-3">
                  <div className="font-data text-[11px] text-zinc-300 mb-1.5" dir="ltr">{acct}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(chains).map(([key, k]) => {
                      const [c] = key.split(':');
                      return chainVisible(key) ? <RoleChip key={key} k={k} chain={c} /> : null;
                    })}
                  </div>
                </div>
              ))}
              {archiveAccounts.filter(([a]) => match(a)).map(([acct, chains]) => (
                <div key={acct} className="rounded-[10px] border border-amber-500/20 bg-amber-500/[0.04] p-3">
                  <div className="font-data text-[11px] text-amber-300/80 mb-1.5" dir="ltr">{acct}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(chains).map(([key, k]) => {
                      const [c] = key.split(':');
                      return chainVisible(key) ? <RoleChip key={key} k={k} chain={c} /> : null;
                    })}
                  </div>
                  <div className="text-[10px] text-amber-400/50 mt-1.5">מפתחות-היסטוריה (recent-owner-authority)</div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
