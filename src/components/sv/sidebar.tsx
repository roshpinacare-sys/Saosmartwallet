'use client';

// ─── navigation — right sidebar (desktop) + bottom bar (mobile) ────────────
// RTL: in a flex-row the first child lands on the RIGHT — the sidebar is
// rendered first and therefore sits on the right edge, Israeli-style.

import { LayoutDashboard, Fingerprint, Zap, ScrollText, Settings2, LogIn, LogOut, Radio } from 'lucide-react';
import { Sigil } from './sigil';
import type { StatusData } from './shared';

export type ViewId = 'overview' | 'vault' | 'ops' | 'audit' | 'settings';

export const VIEWS: Array<{ id: ViewId; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'ראשי', desc: 'סקירה חיה', icon: LayoutDashboard },
  { id: 'vault', label: 'כספת', desc: 'מטריצת מפתחות', icon: Fingerprint },
  { id: 'ops', label: 'מבצעים', desc: 'סוכנים · צ׳אט · משימות', icon: Zap },
  { id: 'audit', label: 'ביקורת', desc: 'יומן פעולות', icon: ScrollText },
  { id: 'settings', label: 'הגדרות', desc: 'נעילה · מדיניות', icon: Settings2 },
];

export function Sidebar({ view, onNavigate, status, relay, authed, onLogin, onLogout }: {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  status: StatusData | null;
  relay: boolean;
  authed: boolean;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const activeAgents = status?.agents.filter(a => a.status === 'active').length || 0;
  return (
    <aside className="hidden md:flex flex-col w-[264px] shrink-0 border-l border-[#26262c] bg-[#0b0b0e]">
      {/* brand */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-5">
        <Sigil live={relay} />
        <div className="min-w-0">
          <div className="font-bold text-[15px] leading-tight tracking-tight">מרכז-השליטה הריבוני</div>
          <div className="text-[10px] text-zinc-600 font-data" dir="ltr">SOVEREIGN CONTROL CENTER</div>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 px-3 space-y-1" aria-label="ניווט ראשי">
        {VIEWS.map(v => {
          const active = view === v.id;
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              onClick={() => onNavigate(v.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative w-full text-right rounded-lg px-3 py-2.5 transition-colors duration-150 group ${active ? 'bg-[#17171c] border border-[#34343c]' : 'border border-transparent hover:bg-[#131317]'}`}
            >
              {active && <span className="absolute inset-y-3 right-0 w-[2px] rounded-full bg-[#d4a94e]" aria-hidden />}
              <span className="flex items-center gap-3">
                <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? 'text-[#ecd28b]' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                <span className="min-w-0">
                  <span className={`block text-[13px] font-semibold leading-tight ${active ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'}`}>{v.label}</span>
                  <span className="block text-[10px] text-zinc-600 leading-tight">{v.desc}</span>
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* status mini */}
      <div className="px-5 pb-3 space-y-2 text-[11px]">
        <div className="flex items-center justify-between text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><Radio className="w-3 h-3" />relay</span>
          <span className={`font-data ${relay ? 'text-emerald-400' : 'text-amber-400'}`}>{relay ? 'LIVE' : 'POLL'}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><Fingerprint className="w-3 h-3" />מפתחות חיים</span>
          <span className="font-data text-zinc-300" dir="ltr">{status?.totals.verified ?? '—'}/{status?.totals.keys ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><Zap className="w-3 h-3" />סוכנים</span>
          <span className="font-data text-zinc-300" dir="ltr">{activeAgents}</span>
        </div>
      </div>

      {/* identity */}
      <div className="m-3 mt-0 rounded-xl border border-[#26262c] bg-[#0f0f12] p-3">
        {authed ? (
          <>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-ring shrink-0" />
              <span className="text-[12px] font-semibold text-zinc-200 truncate" dir="ltr">{status?.me}</span>
            </div>
            <div className="text-[10px] text-zinc-600 leading-relaxed mb-2.5">החיבור דו-נשא: Bearer + cookie — שורד רענון וסגירת-טאב.</div>
            <button onClick={onLogout} className="w-full h-8 rounded-lg border border-[#34343c] bg-[#17171c] hover:bg-[#1d1d22] text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors inline-flex items-center justify-center gap-1.5">
              <LogOut className="w-3.5 h-3.5" />התנתק
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <span className="text-[12px] font-semibold text-amber-300">צפייה בלבד</span>
            </div>
            <div className="text-[10px] text-zinc-600 leading-relaxed mb-2.5">הכל פתוח לקריאה. כדי לבצע פעולות — התחבר עם כל מפתח מכל שרשרת.</div>
            <button onClick={onLogin} className="w-full h-9 rounded-lg bg-gradient-to-b from-[#ecd28b] to-[#d4a94e] hover:from-[#f5e0a0] hover:to-[#dfb45a] text-[#09090b] text-[12px] font-bold shadow-[0_0_20px_rgba(212,169,78,0.18)] transition-all inline-flex items-center justify-center gap-1.5">
              <LogIn className="w-3.5 h-3.5" />התחברות חכמה
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

export function MobileNav({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#26262c] bg-[#0b0b0e]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0b0b0e]/85" aria-label="ניווט תחתון">
      <div className="grid grid-cols-5 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
        {VIEWS.map(v => {
          const active = view === v.id;
          const Icon = v.icon;
          return (
            <button key={v.id} onClick={() => onNavigate(v.id)} aria-current={active ? 'page' : undefined} className="relative flex flex-col items-center gap-0.5 py-1.5">
              {active && <span className="absolute top-0 w-8 h-[2px] rounded-full bg-[#d4a94e]" aria-hidden />}
              <Icon className={`w-[19px] h-[19px] ${active ? 'text-[#ecd28b]' : 'text-zinc-500'}`} />
              <span className={`text-[9px] font-medium ${active ? 'text-zinc-200' : 'text-zinc-600'}`}>{v.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileTopbar({ status, relay, authed, onLogin, onLogout }: {
  status: StatusData | null;
  relay: boolean;
  authed: boolean;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="md:hidden sticky top-0 z-40 border-b border-[#26262c] bg-[#09090b]/95 backdrop-blur supports-[backdrop-filter]:bg-[#09090b]/85">
      <div className="px-4 py-2.5 flex items-center gap-2.5">
        <Sigil size="sm" live={relay} />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-[13px] leading-tight">מרכז-השליטה הריבוני</div>
          <div className="text-[9px] font-data text-zinc-600 leading-tight" dir="ltr">{status?.totals.verified ?? '—'}/{status?.totals.keys ?? '—'} VERIFIED · {relay ? 'LIVE' : 'POLL'}</div>
        </div>
        {authed ? (
          <button onClick={onLogout} aria-label="התנתק" className="w-9 h-9 rounded-lg border border-[#34343c] bg-[#17171c] flex items-center justify-center text-zinc-400"><LogOut className="w-4 h-4" /></button>
        ) : (
          <button onClick={onLogin} className="h-9 px-3 rounded-lg bg-gradient-to-b from-[#ecd28b] to-[#d4a94e] text-[#09090b] text-[12px] font-bold inline-flex items-center gap-1.5">
            <LogIn className="w-3.5 h-3.5" />התחבר
          </button>
        )}
      </div>
    </header>
  );
}
