'use client';

// ─── navigation — right sidebar (desktop) + bottom bar (mobile) ────────────
// RTL: in a flex-row the first child lands on the RIGHT — the sidebar is
// rendered first and therefore sits on the right edge, Israeli-style.

import { LayoutDashboard, Fingerprint, Landmark, Zap, ScrollText, Settings2, LogIn, LogOut, Radio } from 'lucide-react';
import { Sigil } from './sigil';
import type { StatusData } from './shared';

export type ViewId = 'overview' | 'vault' | 'towers' | 'ops' | 'audit' | 'settings';

export const VIEWS: Array<{ id: ViewId; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'ראשי', desc: 'סקירה חיה', icon: LayoutDashboard },
  { id: 'vault', label: 'כספת', desc: 'מטריצת מפתחות', icon: Fingerprint },
  { id: 'towers', label: 'מגדלים', desc: 'חמשת מגדלי SAOS', icon: Landmark },
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
    <aside className="hidden md:flex flex-col w-[264px] shrink-0 border-l border-[#e8e8e3] bg-white">
      {/* brand */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-5">
        <Sigil live={relay} />
        <div className="min-w-0">
          <div className="font-bold text-[15px] leading-tight tracking-tight text-zinc-900">מרכז-השליטה הריבוני</div>
          <div className="text-[10px] text-zinc-400 font-data" dir="ltr">SAOS CONTROL CENTER</div>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 px-3 space-y-0.5" aria-label="ניווט ראשי">
        {VIEWS.map(v => {
          const active = view === v.id;
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              onClick={() => onNavigate(v.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative w-full text-right rounded-xl px-3 py-2.5 transition-colors duration-150 group ${active ? 'bg-emerald-50 border border-emerald-200/70' : 'border border-transparent hover:bg-zinc-50'}`}
            >
              {active && <span className="absolute inset-y-3 right-0 w-[3px] rounded-full bg-emerald-600" aria-hidden />}
              <span className="flex items-center gap-3">
                <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? 'text-emerald-700' : 'text-zinc-400 group-hover:text-zinc-600'}`} />
                <span className="min-w-0">
                  <span className={`block text-[13px] font-semibold leading-tight ${active ? 'text-emerald-900' : 'text-zinc-700 group-hover:text-zinc-900'}`}>{v.label}</span>
                  <span className="block text-[10px] text-zinc-400 leading-tight">{v.desc}</span>
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
          <span className={`font-data ${relay ? 'text-emerald-600' : 'text-amber-600'}`}>{relay ? 'LIVE' : 'POLL'}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><Fingerprint className="w-3 h-3" />מפתחות חיים</span>
          <span className="font-data text-zinc-700" dir="ltr">{status?.totals.verified ?? '—'}/{status?.totals.keys ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><Zap className="w-3 h-3" />סוכנים</span>
          <span className="font-data text-zinc-700" dir="ltr">{activeAgents}</span>
        </div>
      </div>

      {/* identity */}
      <div className="m-3 mt-0 rounded-2xl border border-[#e8e8e3] bg-zinc-50 p-3.5">
        {authed ? (
          <>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-ring shrink-0" />
              <span className="text-[12px] font-semibold text-zinc-800 truncate" dir="ltr">{status?.me}</span>
            </div>
            <div className="text-[10px] text-zinc-500 leading-relaxed mb-2.5">חיבור דו-נשא: Bearer + cookie — שורד רענון וסגירת-טאב.</div>
            <button onClick={onLogout} className="w-full h-8 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-100 text-[11px] text-zinc-600 hover:text-zinc-900 transition-colors inline-flex items-center justify-center gap-1.5">
              <LogOut className="w-3.5 h-3.5" />התנתק
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span className="text-[12px] font-semibold text-amber-700">צפייה בלבד</span>
            </div>
            <div className="text-[10px] text-zinc-500 leading-relaxed mb-2.5">הכל פתוח לקריאה. כדי לבצע פעולות — התחבר עם כל מפתח מכל שרשרת.</div>
            <button onClick={onLogin} className="w-full h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-bold shadow-[0_2px_10px_-2px_rgba(5,150,105,0.5)] transition-colors inline-flex items-center justify-center gap-1.5">
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
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#e8e8e3] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85" aria-label="ניווט תחתון">
      <div className="grid grid-cols-6 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
        {VIEWS.map(v => {
          const active = view === v.id;
          const Icon = v.icon;
          return (
            <button key={v.id} onClick={() => onNavigate(v.id)} aria-current={active ? 'page' : undefined} className="relative flex flex-col items-center gap-0.5 py-1.5">
              {active && <span className="absolute top-0 w-7 h-[2.5px] rounded-full bg-emerald-600" aria-hidden />}
              <Icon className={`w-[18px] h-[18px] ${active ? 'text-emerald-700' : 'text-zinc-400'}`} />
              <span className={`text-[8.5px] font-medium ${active ? 'text-emerald-800' : 'text-zinc-500'}`}>{v.label}</span>
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
    <header className="md:hidden sticky top-0 z-40 border-b border-[#e8e8e3] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="px-4 py-2.5 flex items-center gap-2.5">
        <Sigil size="sm" live={relay} />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-[13px] leading-tight text-zinc-900">מרכז-השליטה הריבוני</div>
          <div className="text-[9px] font-data text-zinc-400 leading-tight" dir="ltr">{status?.totals.verified ?? '—'}/{status?.totals.keys ?? '—'} VERIFIED · {relay ? 'LIVE' : 'POLL'}</div>
        </div>
        {authed ? (
          <button onClick={onLogout} aria-label="התנתק" className="w-9 h-9 rounded-lg border border-[#e0e0da] bg-white flex items-center justify-center text-zinc-500"><LogOut className="w-4 h-4" /></button>
        ) : (
          <button onClick={onLogin} className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-[12px] font-bold inline-flex items-center gap-1.5 shadow-[0_2px_10px_-2px_rgba(5,150,105,0.5)]">
            <LogIn className="w-3.5 h-3.5" />התחבר
          </button>
        )}
      </div>
    </header>
  );
}
