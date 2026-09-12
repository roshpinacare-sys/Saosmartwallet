"use client";

/**
 * SAOS SOVEREIGN VAULT — console kit (r38).
 * עיקובי-האימות, עזרי-תנועה ורכיבים-משותפים לכל סעיפי-הקונסולה.
 * הועבר מ-page.tsx כמות-שהוא (r38 · סדר-הקונסולה).
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, MinusCircle, Loader2, ShieldCheck, Lock } from "lucide-react";
import { toast } from "sonner";
import type { Ep } from "./types";

/* ══════════════════════════ auth plumbing ══════════════════════════ */

const TOKEN_KEY = "saos-gate-token";
const DEVICE_KEY = "saos-gate-device"; // the trusted-device token — lives ONLY in this browser
const DEVICE_ID_KEY = "saos-gate-device-id";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* cookie fallback applies */ }
}
export function getDeviceToken(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
export function setDeviceToken(token: string | null, id?: string) {
  try {
    if (token) {
      localStorage.setItem(DEVICE_KEY, token);
      if (id) localStorage.setItem(DEVICE_ID_KEY, id);
    } else {
      localStorage.removeItem(DEVICE_KEY);
      localStorage.removeItem(DEVICE_ID_KEY);
    }
  } catch { /* private mode — device memory unavailable, key login still works */ }
}
export function getDeviceId(): string | null {
  try { return localStorage.getItem(DEVICE_ID_KEY); } catch { return null; }
}

export async function api(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const t = getToken();
  if (t) headers.set("x-gate-token", t);
  return fetch(path, { ...init, headers, cache: "no-store" });
}
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try { return (await (await api(path, init)).json()) as T; } catch { return null; }
}

/* ══════════════════════════ API console catalog ══════════════════════════ */

export const ENDPOINTS: Ep[] = [
  { method: "GET", path: "/api/gate/status", desc: "מצב-השער הריבוני", auth: "public" },
  { method: "GET", path: "/api/gate/inventory", desc: "הכספת + אימות-חי מול השרשרות", auth: "operator" },
  { method: "POST", path: "/api/gate/reveal", desc: "פענוח מפתח-פרטי לפי id", auth: "operator", body: '{ "id": "<entry-id>" }' },
  { method: "POST", path: "/api/gate/key", desc: "זיהוי-חי של מפתח + שמירה מוצפנת", auth: "operator", body: '{ "key": "…", "save": false }' },
  { method: "GET", path: "/api/gate/agents", desc: "הסוכנים המחוברים", auth: "operator" },
  { method: "POST", path: "/api/gate/agents", desc: "צירוף סוכן (טוקן פעם-אחת)", auth: "operator", body: '{ "name": "my-agent" }' },
  { method: "GET", path: "/api/gate/modules", desc: "מחסן-המודולים לחימוש סוכנים", auth: "operator" },
  { method: "POST", path: "/api/gate/run", desc: "הרצת מטרה עם לולאת-חוכמה (מייצר + בודק עצמאי + לקחים)", auth: "operator", body: '{ "agentName": "…", "goal": "…", "doneMeans": ["…"] }' },
  { method: "GET", path: "/api/gate/run", desc: "יומן הרצות + יעילות-צי אמיתית", auth: "operator" },
  { method: "GET", path: "/api/gate/heart", desc: "דופק לב-האוטונומיה: סיורים, טריגרים, יוזמות, אירועים ותור", auth: "operator" },
  { method: "POST", path: "/api/gate/heart", desc: "מתג-הפסק לאוטונומיה (kill-switch)", auth: "operator", body: '{ "autonomyEnabled": false }' },
  { method: "GET", path: "/api/gate/proposals", desc: "תור יוזמות-היעד שהסוכנים הציעו + המדיניות המרוסנת", auth: "operator" },
  { method: "PATCH", path: "/api/gate/proposals", desc: "הכרעת הצעת-יעד: אישור מזניק ריצה אמיתית (origin=proposal)", auth: "operator", body: '{ "id": "…", "decision": "approve" }' },
  { method: "PUT", path: "/api/gate/proposals", desc: "מדיניות-יוזמות: אישור-אוטומטי מרוסן (מקס-יומי + תקציב)", auth: "operator", body: '{ "autoApprove": true, "maxAutoPerDay": 2, "maxBudget": 4 }' },
  { method: "GET", path: "/api/gate/memory", desc: "זיכרון-הצי: בנק-הממצאים הסופיים המשותף", auth: "operator" },
  { method: "GET", path: "/api/gate/orders", desc: "יד-ריבונית: תור-החתימות (פקודות-המרה שהסוכנים הכינו — כל חשבון-צי × steem/hive × לימיט/המרת-מדין) + מדדי-הגבול", auth: "operator" },
  { method: "PATCH", path: "/api/gate/orders", desc: "הכרעת פקודה: אישור = הכספת חותמת במפתח-הפעיל של חשבון-הפקודה עצמו ומשדרת לשרשרת-היעד (txId אמתי)", auth: "operator", body: '{ "id": "…", "decision": "approve" }' },
  { method: "GET", path: "/api/gate/treasury", desc: "אמת-הכיס (r21): יתרות חיות של כל חשבונות-הצי על שלוש-המסילות (נזיל/חוב/vesting) — כל-מסילה נכשלת בכנות בנפרד", auth: "operator" },
  { method: "GET", path: "/api/gate/situation", desc: "מצב-העניינים (r22): הכל במקום אחד — כסף-מסילות + ETH/SOL + תגמולים-ממתינים + כספת + צי + עוגנים + מה-קורה-בשאר-הריפו של הארגון (12 מאגרים, מה נדחף עכשיו). מטמון 60s, אפס-עומס", auth: "public" },
  { method: "GET", path: "/api/gate/digest", desc: "מישור-ההבנה (r25) + מישור-הדלת-הקדמית (r26): הכספת קוראת את ערוץ-השידורים — הדים-שלנו מול קולות-שותף, סיווג, שאלות-שהוצבו-לנו, סריקת-הדלת-שלנו וקולות-שורש. טיוטת-תשובה בלבד — שליחה = החלטת-מפעיל. מטמון 10 דק׳, אפס-עומס", auth: "public" },
  { method: "GET", path: "/api/gate/stream", desc: "גשר-הפיקוד בזמן-אמת (SSE) — הודעות חדשות נדחפות, בלי דגימה", auth: "operator" },
  { method: "POST", path: "/api/gate/schedule", desc: "קביעת סיור אוטונומי תקופתי", auth: "operator", body: '{ "label": "…", "agentName": "…", "goal": "…", "everyMinutes": 30, "maxPerDay": 8 }' },
  { method: "PATCH", path: "/api/gate/schedule", desc: "השהיה או הפעלה של סיור", auth: "operator", body: '{ "id": "…", "enabled": false }' },
  { method: "POST", path: "/api/gate/device", desc: "חימוש מכשיר-מהימן (זכור אותי בצורה בטוחה)", auth: "operator", body: '{ "label": "Chrome · Windows" }' },
  { method: "POST", path: "/api/gate/device/login", desc: "כניסה חוזרת ממכשיר מוכר — בלי מפתח", auth: "public", body: '{ "deviceToken": "…" }' },
  { method: "GET", path: "/api/gate/device", desc: "רשימת המכשירים-המהימנים", auth: "operator" },
  { method: "POST", path: "/api/gate/messages", desc: "פרסום בגשר-הפיקוד", auth: "operator", body: '{ "body": "…" }' },
  { method: "GET", path: "/api/gate/actions", desc: "יומן-הביקורת", auth: "operator" },
  { method: "POST", path: "/api/gate/lock", desc: "נעילה וניקוי-זיכרון", auth: "public" },
  { method: "GET", path: "/api/system/health", desc: "בריאות-מערכת", auth: "public" },
  { method: "GET", path: "/api/steem/market", desc: "שוק STEEM חי", auth: "public" },
  { method: "GET", path: "/api/steem/wallet?account=headcorner", desc: "ארנק headcorner", auth: "public" },
  { method: "GET", path: "/api/vault/status", desc: "מצב vault ההיסטורי", auth: "public" },
  { method: "GET", path: "/api/vault/keys", desc: "מפתחות vault ההיסטורי", auth: "public" },
  { method: "GET", path: "/api/eco/networks", desc: "רשתות האקו-סיסטם", auth: "public" },
  { method: "GET", path: "/api/saos/fleet-status", desc: "מצב צי SAOS", auth: "public" },
  { method: "GET", path: "/api/bridge/status", desc: "מצב הגשר", auth: "public" },
];

/* ══════════════════════════ motion helpers ══════════════════════════ */

export const rise = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-70px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

/** פענוח-באנימציה: תווים אקראיים מתייצבים לטקסט האמיתי. */
export function Scramble({ text, className }: { text: string; className?: string }) {
  const [out, setOut] = useState("");
  useEffect(() => {
    const glyphs = "0123456789abcdefABCDEFKLMNOPQRSTUVWXYZ";
    let frame = 0;
    const total = Math.min(46, Math.max(20, Math.round(text.length / 2.2)));
    const iv = setInterval(() => {
      frame++;
      const fixed = Math.floor(text.length * (frame / total));
      let s = text.slice(0, fixed);
      for (let i = fixed; i < text.length; i++) {
        s += text[i] === " " ? " " : glyphs[Math.floor(Math.random() * glyphs.length)];
      }
      setOut(s);
      if (frame >= total) { clearInterval(iv); setOut(text); }
    }, 28);
    return () => clearInterval(iv);
  }, [text]);
  return <code className={className} dir="ltr">{out || "…"}</code>;
}

/* ══════════════════════════ the vault seal (SVG) ══════════════════════════ */

export function VaultSeal({ seals, state, size = 300 }: { seals: number; state: "locked" | "verifying" | "open"; size?: number }) {
  const notches = Math.max(1, Math.min(16, seals || 1));
  const iconCls = size >= 120 ? "h-10 w-10" : "h-4 w-4";
  const spin = state === "verifying" ? "animate-[spin_2.5s_linear_infinite]" : "animate-[spin_40s_linear_infinite]";
  const spin2 = state === "verifying" ? "animate-[spin_1.6s_linear_infinite_reverse]" : "animate-[spin_28s_linear_infinite_reverse]";
  const color = state === "open" ? "#34d399" : state === "verifying" ? "#fcd34d" : "#a1a1aa";
  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-0 rounded-full blur-3xl opacity-30"
        style={{ background: `radial-gradient(circle, ${color}55 0%, transparent 62%)` }} />
      <svg viewBox="0 0 200 200" className={`absolute inset-0 h-full w-full ${spin}`} style={{ filter: `drop-shadow(0 0 14px ${color}66)` }}>
        <circle cx="100" cy="100" r="92" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 9" />
      </svg>
      <svg viewBox="0 0 200 200" className={`absolute inset-0 h-full w-full ${spin2}`} style={{ filter: `drop-shadow(0 0 10px ${color}55)` }}>
        <circle cx="100" cy="100" r="78" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="2.5" strokeDasharray={`${(2 * Math.PI * 78) / (notches * 2)} ${(2 * Math.PI * 78) / (notches * 2)}`} strokeLinecap="round" />
        <circle cx="100" cy="100" r="64" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="1 6" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <motion.div
          key={state}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
        >
          {state === "open"
            ? <ShieldCheck className={iconCls} style={{ color }} />
            : state === "verifying"
              ? <Loader2 className={iconCls + " animate-spin"} style={{ color }} />
              : <Lock className={iconCls} style={{ color }} />}
        </motion.div>
        {size >= 120 && (
          <>
            <p className="text-[11px] font-mono tracking-widest" style={{ color }}>{notches} SEALS</p>
            <p className="text-[10px] font-mono tracking-[0.3em] text-zinc-500">
              {state === "open" ? "UNLOCKED" : state === "verifying" ? "VERIFYING" : "SEALED"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════ shared bits ══════════════════════════ */

export function SectionHead({ num, title, sub }: { num: string; title: string; sub: string }) {
  return (
    <motion.div {...rise} className="mb-6 flex items-end gap-4">
      <span className="font-mono text-5xl md:text-6xl font-black leading-none text-zinc-800 select-none" aria-hidden>{num}</span>
      <div>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-100">{title}</h2>
        <p className="text-sm text-zinc-500 mt-1">{sub}</p>
      </div>
    </motion.div>
  );
}

export function LiveDot({ ok }: { ok: boolean | null }) {
  if (ok === true) return <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> חי</span>;
  if (ok === false) return <span className="inline-flex items-center gap-1 text-xs text-rose-400"><XCircle className="h-3.5 w-3.5" /> נכשל</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><MinusCircle className="h-3.5 w-3.5" /> ללא בדיקה</span>;
}

export function copyText(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success("הועתק: " + label)).catch(() => toast.error("ההעתקה נכשלה"));
}

export function GlowCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={"rounded-2xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm " + className}>
      {children}
    </div>
  );
}

export function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-4 py-1.5 font-mono text-xs transition-all border " +
        (active
          ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
          : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200")
      }
    >
      {label}
    </button>
  );
}
