'use client';

// ─── settings — guard policy · session · system posture (light) ────────────

import { ShieldCheck, ShieldAlert, Lock, LogOut, RefreshCw, KeyRound, Database, Radio, Fingerprint } from 'lucide-react';
import { fmtAgo } from './shared';
import type { StatusData } from './shared';

export function SettingsView({ status, authed, verifying, onToggleLock, onVerifyAll, onLogout }: {
  status: StatusData | null;
  authed: boolean;
  verifying: boolean;
  onToggleLock: (enable: boolean) => void;
  onVerifyAll: () => void;
  onLogout: () => void;
}) {
  const locked = status?.guard.ownerLock;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight leading-tight text-zinc-900">הגדרות ומדיניות</h1>
        <p className="text-[12px] text-zinc-500 mt-0.5">נעילת-owner · הסתמכות-עצמית · יציבת-מערכת</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* guard / owner-lock */}
        <section className={`sv-card p-5 ${locked ? 'border-emerald-200' : 'border-rose-200'}`}>
          <div className="flex items-start gap-3">
            {locked ? <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" /> : <ShieldAlert className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />}
            <div className="flex-1">
              <h2 className="text-[14px] font-bold text-zinc-900">נעילת-owner — {locked ? 'פעילה' : 'כבויה'}</h2>
              <p className="text-[12px] text-zinc-500 mt-1 leading-relaxed">
                {locked
                  ? 'אסור לשנות מפתחות-owner ללא הנחייתך המפורשת. ביטול הנעילה דורש אישור מילולי.'
                  : 'פעולות-owner חשופות. מומלץ להפעיל נעילה — ביטול נעילה לא חוסם את הצפייה או השימוש האישי.'}
              </p>
              {status?.guard.note && <p className="text-[11px] text-zinc-400 mt-1.5">{status.guard.note}{status.guard.updatedAt ? ` · עודכן ${fmtAgo(status.guard.updatedAt)}` : ''}</p>}
              <div className="mt-4 flex gap-2">
                {locked ? (
                  <button
                    onClick={() => { if (confirm('לבטל את נעילת-owner? פעולה מסוכנת.')) onToggleLock(false); }}
                    className="h-9 px-3.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-[12px] text-rose-700 transition-colors inline-flex items-center gap-1.5"
                  >
                    <Lock className="w-3.5 h-3.5" />בטל נעילה
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleLock(true)}
                    className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[12px] text-white font-semibold transition-colors inline-flex items-center gap-1.5 shadow-[0_2px_8px_-2px_rgba(5,150,105,0.4)]"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />הפעל נעילה
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* session */}
        <section className="sv-card p-5">
          <div className="flex items-start gap-3">
            <Fingerprint className="w-6 h-6 text-zinc-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="text-[14px] font-bold text-zinc-900">הפעלה נוכחית</h2>
              {authed ? (
                <>
                  <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-ring" />
                    <span className="font-data text-[12px] text-emerald-800" dir="ltr">{status?.me}</span>
                  </div>
                  <p className="text-[12px] text-zinc-500 mt-2.5 leading-relaxed">
                    חיבור דו-נשא: Bearer ב-localStorage + cookie httpOnly — שורד רענון-עמוד, סגירת-טאב ו-preview חוסם-cookies.
                    {status?.sessions != null && <span> סשנים פעילים: <span className="font-data" dir="ltr">{status.sessions}</span>.</span>}
                  </p>
                  <button onClick={onLogout} className="mt-4 h-9 px-3.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[12px] text-zinc-600 hover:text-zinc-900 transition-colors inline-flex items-center gap-1.5">
                    <LogOut className="w-3.5 h-3.5" />התנתק מהמערכת
                  </button>
                </>
              ) : (
                <p className="text-[12px] text-zinc-500 mt-2 leading-relaxed">
                  לא מחובר — מצב צפייה. כל הקריאה פתוחה; כתיבה דורשת התחברות חכמה עם כל מפתח מכל שרשרת (STEEM · HIVE · BLURT).
                </p>
              )}
            </div>
          </div>
        </section>

        {/* verification policy */}
        <section className="sv-card p-5">
          <div className="flex items-start gap-3">
            <KeyRound className="w-6 h-6 text-zinc-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="text-[14px] font-bold text-zinc-900">מדיניות אימות-מפתחות</h2>
              <ul className="text-[12px] text-zinc-500 mt-2 space-y-1.5 leading-relaxed">
                {/* FIX(Roast-65-e4 · F10): כנות — האימות-האוטומטי רץ-רק בעת-חיבור; תמיד-אפשר-לחיצה-ידנית */}
                <li className="flex gap-2"><span className="text-emerald-600">•</span>אימות-חי בעת-חיבור (כל-5-דק׳) — או לחיצה-ידנית</li>
                <li className="flex gap-2"><span className="text-emerald-600">•</span>WIF מומר למפתח-ציבורי ומושווה מול authorities על-השרשרת — לעולם לא נסרקת היסטוריה</li>
                <li className="flex gap-2"><span className="text-emerald-600">•</span>החומר נשמר AES-256-GCM בכספת מקומית; ב-DB יש רק fingerprint</li>
              </ul>
              <button onClick={onVerifyAll} disabled={verifying} className="mt-4 h-9 px-3.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[12px] text-zinc-700 transition-colors inline-flex items-center gap-2 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />אמת הכל עכשיו
              </button>
            </div>
          </div>
        </section>

        {/* system posture */}
        <section className="sv-card p-5">
          <div className="flex items-start gap-3">
            <Database className="w-6 h-6 text-zinc-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="text-[14px] font-bold text-zinc-900">יציבת-מערכת</h2>
              <div className="mt-2.5 space-y-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500 inline-flex items-center gap-1.5"><Radio className="w-3.5 h-3.5" />relay בזמן-אמת</span>
                  <span className="font-data text-[11px] text-emerald-700" dir="ltr">socket.io :3003</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">RPC STEEM</span>
                  <span className="font-data text-[11px] text-zinc-600" dir="ltr">api.steemit.com</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">RPC HIVE</span>
                  <span className="font-data text-[11px] text-zinc-600" dir="ltr">api.hive.blog</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">RPC BLURT</span>
                  <span className="font-data text-[11px] text-zinc-600" dir="ltr">blurt-rpc.saboin.com</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">מסד נתונים</span>
                  <span className="font-data text-[11px] text-zinc-600" dir="ltr">SQLite + Prisma</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
