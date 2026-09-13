"use client";

/**
 * SAOS SOVEREIGN VAULT — קונסולת-פיקוד ריבונית (r38 · סדר-הקונסולה).
 *
 * r38: סוף עידן דף-הנחיתה. העמוד הוא עתה קונסולה מסודרת:
 *  · סרגל-ניווט (דסקטופ: סרגל-צד דביק · מובייל: שורת-צ'יפים גוללת)
 *  · 00 סקירה — לוח-פיקוד אמיתי במקום Hero (KPIs, לב, כסף, דלת, עוגנים, ארגון)
 *  · 05 ערוץ — מישור-ההבנה במלואו + טיוטת-תשובה עם העתקה (פער-ר38)
 *  · הזרקת-מפתח חוזרת להיות מוצגת בסעיף-הכספת (היה קוד-מת-שלא-רונדר — פער-ר38)
 *  · מסך-הנעילה וכל המישורים הקיימים נשמרו כמות-שהם — אפס פגיעה בפונקציונליות.
 *
 * כל הנתונים מה-APIs האמיתיים של src/app/api/gate · אפס דמו.
 * אימות: טוקן-סשן בכותרת x-gate-token (עמיד ל-iframe) + קוקי כגיבוי.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertTriangle, Bot, Boxes, Globe, HeartPulse, History, LayoutDashboard, Lock,
  LogOut, Radio, RadioTower, Smartphone, Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiJson, getDeviceToken, setDeviceToken, setToken, VaultSeal } from "@/components/console/kit";
import type { GateStatus } from "@/components/console/types";
import { LockScene } from "@/components/console/lock-scene";

/* Task 2-a — per-section lazy chunks: every console section lives in its own
 * module under sections/ and is loaded on demand (next/dynamic, ssr:false —
 * the console is client-only anyway). Same JSX usage, same props; only the
 * module graph got smaller so one section no longer compiles with the rest.
 * LockScene stays a REGULAR import on purpose: the lock screen must paint
 * instantly, never behind a lazy-chunk roundtrip. */
const Overview = dynamic(() => import("@/components/console/overview").then((m) => m.Overview), { ssr: false });
const Channel = dynamic(() => import("@/components/console/channel").then((m) => m.Channel), { ssr: false });
const ToolsLab = dynamic(() => import("@/components/console/tools-lab").then((m) => m.ToolsLab), { ssr: false });
const Connections = dynamic(() => import("@/components/console/sections/connections").then((m) => m.Connections), { ssr: false });
const VaultGrid = dynamic(() => import("@/components/console/sections/vault-grid").then((m) => m.VaultGrid), { ssr: false });
const Agents = dynamic(() => import("@/components/console/sections/agents").then((m) => m.Agents), { ssr: false });
const AutonomySection = dynamic(() => import("@/components/console/sections/autonomy-section").then((m) => m.AutonomySection), { ssr: false });
const Bridge = dynamic(() => import("@/components/console/sections/bridge").then((m) => m.Bridge), { ssr: false });
const Audit = dynamic(() => import("@/components/console/sections/audit").then((m) => m.Audit), { ssr: false });
const ApiConsole = dynamic(() => import("@/components/console/sections/api-console").then((m) => m.ApiConsole), { ssr: false });
const TrustedDevices = dynamic(() => import("@/components/console/sections/trusted-devices").then((m) => m.TrustedDevices), { ssr: false });
const EmergencyZone = dynamic(() => import("@/components/console/sections/emergency-zone").then((m) => m.EmergencyZone), { ssr: false });

/* ══════════════════════════ console navigation (r38) ══════════════════════════ */

type SectionId =
  | "overview" | "connections" | "vault" | "agents" | "autonomy"
  | "channel" | "bridge" | "audit" | "console" | "devices" | "tools" | "emergency";

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon; num: string }> = [
  { id: "overview", label: "סקירה", icon: LayoutDashboard, num: "00" },
  { id: "connections", label: "חיבורים", icon: Globe, num: "01" },
  { id: "vault", label: "כספת", icon: Lock, num: "02" },
  { id: "agents", label: "סוכנים", icon: Bot, num: "03" },
  { id: "autonomy", label: "אוטונומיה", icon: HeartPulse, num: "04" },
  { id: "channel", label: "ערוץ", icon: RadioTower, num: "05" },
  { id: "bridge", label: "פיקוד", icon: Radio, num: "06" },
  { id: "audit", label: "ביקורת", icon: History, num: "07" },
  { id: "console", label: "מסוף", icon: Terminal, num: "08" },
  { id: "tools", label: "מעבדה", icon: Boxes, num: "11" },
  { id: "devices", label: "מכשירים", icon: Smartphone, num: "09" },
  { id: "emergency", label: "חירום", icon: AlertTriangle, num: "10" },
];

/* ══════════════════════════ root ══════════════════════════ */

export default function Page() {
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [sealState, setSealState] = useState<"locked" | "verifying" | "open">("locked");
  const [deviceRemembered, setDeviceRemembered] = useState(false);
  // ROAST r9 gap-38: the old amber warning ("היה כאן טוקן-מכשיר שנפסל") was
  // DEAD CODE — it rendered off `deviceRemembered`, the very state the failure
  // path cleared. Rejection now has its own flag; the warning actually shows.
  const [deviceRejected, setDeviceRejected] = useState(false);
  // r38 — the active console section (sidebar / chips navigation).
  // BUG-HUNT fix (user: "נפילות"): dev-server memory-threshold restarts reload
  // the page and the console used to reset to 00 סקירה — the operator lost their
  // place on every crash. The active section is now mirrored into sessionStorage
  // and restored on mount, so a reload lands back where the user was.
  const [active, setActive] = useState<SectionId>(() => {
    if (typeof window === "undefined") return "overview";
    try {
      const saved = window.sessionStorage.getItem("saos-console-section");
      const ids: SectionId[] = ["overview", "connections", "vault", "agents", "autonomy", "channel", "bridge", "audit", "console", "tools", "devices", "emergency"];
      return ids.includes(saved as SectionId) ? (saved as SectionId) : "overview";
    } catch { return "overview"; }
  });

  function selectSection(id: SectionId) {
    setActive(id);
    try { window.sessionStorage.setItem("saos-console-section", id); } catch { /* private mode */ }
  }

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    const s = await apiJson<GateStatus>("/api/gate/status");
    if (s?.ok) {
      setStatus(s);
      setSealState(s.session ? "open" : "locked");
      return Boolean(s.session);
    }
    return false;
  }, []);

  useEffect(() => {
    (async () => {
      let okIn = await refreshStatus();
      // secure "remember me": no live session but this browser holds a trusted
      // device token → re-open the vault without ever pasting a key again
      if (!okIn && getDeviceToken()) {
        setDeviceRemembered(true);
        try {
          const r = await fetch("/api/gate/device/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceToken: getDeviceToken() }),
          }).then((x) => x.json());
          if (r?.ok && r.token) {
            setToken(r.token as string);
            okIn = await refreshStatus();
            if (okIn) toast.success("חזרת בביטחון ממכשיר מוכר — בלי להדביק מפתח");
          } else {
            // the device was revoked/expired — clear the inert token, honest state
            setDeviceToken(null);
            setDeviceRemembered(false);
            setDeviceRejected(true); // r9 gap-38: the warning must actually render
            toast.warning("טוקן-המכשיר של הדפדפן הזה נשלל או פג-תוקף (הצופן נמחק מה-DB) — הכניסה הבאה במפתח תחמש מכשיר חדש");
          }
        } catch { /* network hiccup — the lock screen stays honest */ }
      }
      // open gate: token-only entry (operator policy — "זה רק אני ואתה").
      // The server re-lights the vault from its own lifeline token; no key needed.
      if (!okIn) {
        try {
          const s = await fetch("/api/gate/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((x) => x.json());
          if (s?.ok && s?.in && s?.token) {
            setToken(s.token as string);
            okIn = await refreshStatus();
            if (okIn) toast.success("השער נפתח בטוקן — בלי להדביק מפתח");
          }
        } catch { /* the lock screen stays honest */ }
      }
      setBooting(false);
    })();
  }, [refreshStatus]);

  async function logout() {
    setSealState("locked");
    await apiJson("/api/gate/lock", { method: "POST" });
    setToken(null);
    setStatus(null);
    selectSection("overview");
    toast("הכספת נאטמה — מפתח-האב נמחק מהזיכרון");
  }

  // r38 — section switching scrolls back to the top of the console
  function go(id: SectionId) {
    selectSection(id);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  const wrapper = "min-h-screen flex flex-col bg-[#050505] text-zinc-100 relative overflow-x-hidden";

  if (booting) {
    return (
      <div dir="rtl" className={wrapper}>
        <div className="flex-1 flex items-center justify-center">
          <VaultSeal seals={status?.keySeals || 8} state="verifying" size={220} />
        </div>
      </div>
    );
  }

  if (!status?.session) {
    return (
      <div dir="rtl" className={wrapper}>
        <Backdrop />
        <LockScene
          status={status}
          state={sealState}
          deviceRemembered={deviceRemembered}
          deviceRejected={deviceRejected}
          onVerifying={() => setSealState("verifying")}
          onFail={() => setSealState("locked")}
          onIn={async (token) => {
            setToken(token);
            const okIn = await refreshStatus();
            if (okIn) toast.success("הכספת נפתחה — כל המפתחות בפנים");
            else { setSealState("locked"); toast.error("האימות השתבש — נסה שוב"); }
            return okIn;
          }}
        />
      </div>
    );
  }

  const activeMeta = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div dir="rtl" className={wrapper}>
      <Backdrop />
      <div className="relative z-10 flex-1 flex flex-row">
        {/* ── sidebar — desktop (RTL: renders on the right) ── */}
        <aside className="hidden lg:flex flex-col w-60 shrink-0 sticky top-0 h-screen border-l border-zinc-900 bg-black/60 backdrop-blur-md">
          <div className="px-5 py-3.5 border-b border-zinc-900 flex items-center gap-2.5">
            <VaultSeal seals={status.keySeals} state="open" size={36} />
            <div className="min-w-0">
              <p className="font-black tracking-tight text-sm leading-tight">SOVEREIGN <span className="text-emerald-400">VAULT</span></p>
              <p className="text-[10px] font-mono text-emerald-400/90">פתוחה · {status.keySeals} חותמות</p>
            </div>
          </div>
          <nav aria-label="ניווט-הקונסולה" className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-1">
            {SECTIONS.map((s) => {
              const on = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => go(s.id)}
                  aria-current={on ? "page" : undefined}
                  className={
                    "w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all border " +
                    (on
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200 font-bold"
                      : "border-transparent text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200")
                  }
                >
                  <s.icon className={"h-4 w-4 shrink-0 " + (on ? "text-emerald-400" : "text-zinc-500")} aria-hidden />
                  <span className="flex-1 text-right">{s.label}</span>
                  <span className={"font-mono text-[9px] " + (on ? "text-emerald-400/70" : "text-zinc-700")}>{s.num}</span>
                </button>
              );
            })}
          </nav>
          <div className="px-4 py-3.5 border-t border-zinc-900 space-y-2">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              מחובר כ-<b className="text-zinc-300">{status.session.name}</b> · סשן 30 יום
              {deviceRemembered && <span className="text-emerald-500/80"> · מכשיר זכור ✓</span>}
            </p>
            <Button variant="outline" size="sm" onClick={logout} className="w-full gap-1.5 border-zinc-800 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
              <LogOut className="h-3.5 w-3.5" /> אטום את הכספת
            </Button>
          </div>
        </aside>

        {/* ── content column ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-30 border-b border-zinc-900 bg-black/70 backdrop-blur-md">
            <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 lg:hidden min-w-0">
                <VaultSeal seals={status.keySeals} state="open" size={30} />
                <span className="font-black tracking-tight text-sm truncate">SOVEREIGN <span className="text-emerald-400">VAULT</span></span>
              </div>
              <div className="hidden lg:flex items-center gap-2.5 font-mono text-[11px] text-zinc-500" dir="ltr">
                <span className="text-emerald-400 font-bold">{activeMeta.num}</span>
                <span className="text-zinc-300 font-sans font-bold" dir="rtl">{activeMeta.label}</span>
                <span className="text-zinc-700">·</span>
                <span>secrets <b className="text-zinc-300">{status.counts.vaultEntries}</b></span>
                <span>agents <b className="text-zinc-300">{status.counts.activeAgents}</b></span>
                <span>msgs <b className="text-zinc-300">{status.counts.messages}</b></span>
              </div>
              <Button variant="outline" size="sm" onClick={logout} className="lg:hidden gap-1.5 border-zinc-800 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
                <LogOut className="h-3.5 w-3.5" /> אטום
              </Button>
            </div>
            {/* mobile chips — sections within thumb reach */}
            <div className="lg:hidden border-t border-zinc-900/70 bg-black/60">
              <div role="tablist" aria-label="סעיפי-הקונסולה" className="flex gap-1.5 overflow-x-auto scroll-thin px-3 py-2">
                {SECTIONS.map((s) => {
                  const on = active === s.id;
                  return (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={on}
                      onClick={() => go(s.id)}
                      className={
                        "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-mono transition-all " +
                        (on
                          ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                          : "bg-zinc-900/60 border-zinc-800 text-zinc-400")
                      }
                    >
                      <s.icon className="h-3 w-3" aria-hidden /> {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </header>

          <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-6 min-h-[70vh]">
            {active === "overview" && <Overview status={status} />}
            {active === "connections" && <Connections />}
            {active === "vault" && <VaultGrid />}
            {active === "agents" && <Agents />}
            {active === "autonomy" && <AutonomySection />}
            {active === "channel" && <Channel />}
            {active === "bridge" && <Bridge />}
            {active === "audit" && <Audit />}
            {active === "console" && <ApiConsole />}
            {active === "tools" && <ToolsLab />}
            {active === "devices" && <TrustedDevices />}
            {active === "emergency" && <EmergencyZone onAfter={refreshStatus} />}
            <div className="h-8" />
          </main>

          <footer className="mt-auto border-t border-zinc-900 bg-black/60 backdrop-blur">
            <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
              <span className="font-mono tracking-widest">SAOS SOVEREIGN VAULT · AES-256-GCM · scrypt(2¹⁵) · r38-console</span>
              <span>
                מחובר כ-<b className="text-zinc-400">{status.session.name}</b> · {status.keySeals} חותמות-מפתח · סשן 30 יום
                {deviceRemembered && <span className="text-emerald-500/80"> · מכשיר זכור ✓</span>}
              </span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ backdrop ══════════════════════════ */

function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <div className="absolute inset-0 opacity-[0.13]"
        style={{ backgroundImage: "linear-gradient(#18181b 1px, transparent 1px), linear-gradient(90deg, #18181b 1px, transparent 1px)", backgroundSize: "56px 56px" }} />
      <div className="absolute -top-40 right-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-[130px]" />
      <div className="absolute top-1/3 -left-32 h-80 w-80 rounded-full bg-amber-500/8 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-400/6 blur-[110px]" />
    </div>
  );
}
