'use client';

// ─── audit — append-only action log ────────────────────────────────────────

import { useState } from 'react';
import { Search, ScrollText, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { fmtAgo } from './shared';
import type { AuditRow } from './shared';

export function AuditView({ rows }: { rows: AuditRow[] }) {
  const [q, setQ] = useState('');
  const filtered = rows.filter(l =>
    !q || l.action.toLowerCase().includes(q.toLowerCase()) || (l.detail || '').toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight leading-tight">יומן-ביקורת</h1>
        <p className="text-[12px] text-zinc-600 mt-0.5">כל פעולה רגישה נרשמת כאן — append-only, שלא יקרה שוב</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-52 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש ביומן (פעולה או פירוט)..." className="bg-[#0c0c0e] border-[#26262c] h-9 pr-9 text-[12px]" />
        </div>
        <span className="font-data text-[11px] text-zinc-600" dir="ltr">{filtered.length}/{rows.length} entries</span>
      </div>

      <section className="sv-card">
        <div className="px-4 py-3 border-b border-[#1d1d22] flex items-center justify-between">
          <span className="text-[13px] font-semibold flex items-center gap-2"><ScrollText className="w-4 h-4 text-zinc-500" />רשומות</span>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-zinc-600"><ShieldCheck className="w-3 h-3 text-emerald-500" />append-only · חתום זמן</span>
        </div>
        <div className="p-2 max-h-[560px] overflow-y-auto scroll-slim">
          {filtered.map(l => {
            const bad = l.action.includes('reject') || l.action.includes('OFF');
            return (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#131317] transition-colors border-b border-[#141418] last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${bad ? 'bg-red-400' : 'bg-emerald-400/70'}`} aria-hidden />
                <span className={`font-data text-[10px] shrink-0 w-32 truncate ${bad ? 'text-red-400' : 'text-emerald-400/80'}`} dir="ltr" title={l.action}>{l.action}</span>
                <span className="text-[11px] text-zinc-500 truncate flex-1 font-data" dir="ltr">{l.detail}</span>
                <span className="font-data text-[10px] text-zinc-600 shrink-0 w-20 text-left" dir="ltr">{new Date(l.createdAt).toLocaleString('he-IL', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="font-data text-[10px] text-zinc-700 shrink-0 hidden md:block w-16">{fmtAgo(l.createdAt)}</span>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="py-8 text-center text-[12px] text-zinc-600">אין רשומות לחיפוש זה</div>}
        </div>
      </section>
    </div>
  );
}
