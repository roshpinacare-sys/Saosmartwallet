'use client';

// ─── vault — the key matrix (light ledger) ─────────────────────────────────
// Accounts × chains × roles. Never renders raw material — masked
// fingerprints only, hover to inspect. Filters are reversible.

import { useState } from 'react';
import { RefreshCw, Search, ChevronDown, Archive, Lock } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { CHAIN_KEYS, CHAIN_META, BalLine, RoleChip } from './shared';
import type { StatusData, ChainId, RoleKey } from './shared';

// FIX(Roast-65-e4 · F2): אותו-חישוב-שליטה-מלאה-פר-חשבון (משמש גם את ספירת-ה-header):
// תג "בשליטה מלאה" ניתן רק כשיש-מפתחות-שרשרת וכל-מפתחות-השרשרת-הקיימים מאומתים-חי.
function acctFullyControlled(chains: Record<string, RoleKey>): boolean {
  return (
    Object.keys(chains).length > 0 &&
    CHAIN_KEYS.some(c => Object.keys(chains).some(k => k.startsWith(`${c}:`))) &&
    CHAIN_KEYS.every(c => Object.entries(chains).filter(([k]) => k.startsWith(`${c}:`)).every(([, k]) => k.verified))
  );
}

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
  const fullyControlled = filtered.filter(([, chains]) => acctFullyControlled(chains)).length;

  return (
    <div className="space-y-4">
      {/* header + controls */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight leading-tight text-zinc-900">כספת המפתחות</h1>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            {/* FIX(Roast-65-e4 · F10): כנות — האימות-האוטומטי רץ-רק בעת-חיבור; תמיד-אפשר-לחיצה-ידנית */}
            מטריצת שליטה חיה · {status?.totals.accounts} ישויות · {status?.totals.verified} מאומתות-חי מול השרשרת · אימות-חי בעת-חיבור (כל-5-דק׳) — או לחיצה-ידנית
          </p>
        </div>
        <button onClick={onVerifyAll} disabled={verifying} className="h-9 px-3.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[12px] text-zinc-700 transition-colors inline-flex items-center gap-2 disabled:opacity-50 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
          <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />אמת הכל עכשיו
        </button>
      </div>

      {/* filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-44 max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש חשבון..." className="bg-white border-[#e0e0da] h-9 pr-9 text-[12px] shadow-[0_1px_2px_rgba(24,24,27,0.04)]" />
        </div>
        <div className="flex gap-1 bg-white border border-[#e8e8e3] rounded-lg p-0.5 shadow-[0_1px_2px_rgba(24,24,27,0.04)]" role="group" aria-label="סינון שרשרת">
          {(['all', ...CHAIN_KEYS] as const).map(c => (
            <button
              key={c}
              onClick={() => setFilter(c as ChainFilter)}
              aria-pressed={filter === c}
              className={`h-8 px-3 rounded-md text-[11px] font-data transition-colors ${filter === c ? 'bg-emerald-600 text-white font-bold' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50'}`}
              dir="ltr"
            >
              {c === 'all' ? 'ALL' : CHAIN_META[c as ChainId].label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-zinc-500 font-data" dir="ltr">{filtered.length} accts · {fullyControlled} full-control</span>
      </div>

      {/* the matrix */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map(([acct, chains]) => (
          <div key={acct} className="sv-card p-4">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-data font-semibold text-[13px] text-zinc-900" dir="ltr">{acct}</span>
              {/* FIX(Roast-65-e4 · F2): התג-נגזר-מה-verified בפועל — לא-עוד "בשליטה מלאה" קבוע לכל-כרטיס */}
              {acctFullyControlled(chains) ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <Lock className="w-2.5 h-2.5" />בשליטה מלאה
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  <Lock className="w-2.5 h-2.5" />שליטה חלקית
                </span>
              )}
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
          <div className="sv-card p-8 text-center text-[12px] text-zinc-400 col-span-full">לא נמצאו חשבונות לחיפוש זה</div>
        )}
      </div>

      {/* material + archive */}
      {(materialAccounts.length > 0 || archiveAccounts.length > 0) && (
        <Collapsible>
          <CollapsibleTrigger className="sv-well w-full px-4 py-2.5 flex items-center justify-between text-[12px] text-zinc-500 hover:text-zinc-800 transition-colors">
            <span className="inline-flex items-center gap-2"><Archive className="w-3.5 h-3.5" />חומר נוסף בכספת ({materialAccounts.length + archiveAccounts.length}) — גנזך מוצפן</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {materialAccounts.filter(([a]) => match(a)).map(([acct, chains]) => (
                <div key={acct} className="sv-well p-3">
                  <div className="font-data text-[11px] text-zinc-700 mb-1.5" dir="ltr">{acct}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(chains).map(([key, k]) => {
                      const [c] = key.split(':');
                      return chainVisible(key) ? <RoleChip key={key} k={k} chain={c} /> : null;
                    })}
                  </div>
                </div>
              ))}
              {archiveAccounts.filter(([a]) => match(a)).map(([acct, chains]) => (
                <div key={acct} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <div className="font-data text-[11px] text-amber-800 mb-1.5" dir="ltr">{acct}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(chains).map(([key, k]) => {
                      const [c] = key.split(':');
                      return chainVisible(key) ? <RoleChip key={key} k={k} chain={c} /> : null;
                    })}
                  </div>
                  <div className="text-[10px] text-amber-600/80 mt-1.5">מפתחות-היסטוריה (recent-owner-authority)</div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
