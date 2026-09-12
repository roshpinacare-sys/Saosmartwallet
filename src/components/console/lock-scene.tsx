"use client";

/**
 * SAOS SOVEREIGN VAULT — lock scene (r38).
 * מסך-הכניסה: חותם-הכספת + מפתח-חי. הועבר מ-page.tsx כמות-שהוא.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { VaultSeal, apiJson, getDeviceToken, setDeviceToken } from "./kit";
import type { GateStatus } from "./types";

export function LockScene({
  status, state, deviceRemembered, deviceRejected, onVerifying, onFail, onIn,
}: {
  status: GateStatus | null;
  state: "locked" | "verifying" | "open";
  deviceRemembered: boolean;
  deviceRejected: boolean;
  onVerifying: () => void;
  onFail: () => void;
  onIn: (token: string) => Promise<boolean>;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  async function login() {
    if (!keyInput.trim() || state === "verifying") return;
    setErr(null);
    onVerifying();
    try {
      const r = await fetch("/api/gate/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput.trim() }),
      }).then((x) => x.json());
      if (r?.ok && r.token) {
        setKeyInput("");
        const okIn = await onIn(r.token as string);
        if (okIn && remember) {
          // arm THIS browser as a trusted device — the raw token lives only here;
          // the server keeps the hash + the master sealed under it (DB alone is inert).
          // ROAST r9: an existing live token ROTATES that device in place —
          // same row, new token, fresh 90 days — instead of duplicating rows.
          try {
            const dt = getDeviceToken();
            const d = await apiJson<{ ok: boolean; device?: { id: string }; deviceToken?: string; error?: string }>("/api/gate/device", {
              method: "POST",
              body: JSON.stringify(dt ? { deviceToken: dt } : {}),
            });
            if (d?.ok && d.deviceToken) {
              setDeviceToken(d.deviceToken, d.device?.id);
              toast.success("המכשיר הזה זכור — הכניסה הבאה בלי מפתח (90 יום)");
            } else {
              toast.error(d?.error || "חימוש-המכשיר נכשל — הכניסה במפתח תמיד עובדת");
            }
          } catch { /* device arm is best-effort — session already live */ }
        }
      } else {
        setErr(r?.error || "הכניסה נכשלה");
        onFail();
      }
    } catch {
      setErr("השרת לא נענה — נסה שוב");
      onFail();
    }
  }

  return (
    <div className="relative z-10 flex-1 flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <VaultSeal seals={status?.keySeals || 0} state={state} size={280} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="w-full max-w-lg text-center"
        >
          <h1 className="text-3xl md:text-5xl font-black tracking-tight">
            SAOS <span className="text-emerald-400">SOVEREIGN</span> VAULT
          </h1>
          <p className="mt-3 text-zinc-400 text-sm md:text-base leading-relaxed">
            מדביקים כל מפתח <span className="font-mono text-zinc-300">@headcorner</span> נוכחי — STEEM או HIVE,
            כל תפקיד — והכספת נפתחת. בלי סיסמה. האימות חי מול השרשרת.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row gap-2.5">
            <label htmlFor="gate-key" className="sr-only">מפתח-פרטי</label>
            <Input
              id="gate-key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") login(); }}
              placeholder="5K… / K… / L… — הדבק כאן את המפתח"
              className="font-mono text-sm h-12 bg-zinc-950/80 border-zinc-800 focus-visible:ring-emerald-500/40 text-center sm:text-right"
              autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus
            />
            <Button
              onClick={login}
              disabled={state === "verifying" || !keyInput.trim()}
              className="h-12 px-7 text-base gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold shrink-0"
            >
              {state === "verifying"
                ? <><Loader2 className="h-4 w-4 animate-spin" /> מאמת מול השרשרת…</>
                : <><KeyRound className="h-4 w-4" /> פתח את הכספת</>}
            </Button>
          </div>

          {err && (
            <p role="alert" className="mt-4 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2.5">{err}</p>
          )}

          <div className="mt-4 flex items-center justify-center gap-3">
            <Switch
              checked={remember}
              onCheckedChange={setRemember}
              aria-label="זכור אותי על המכשיר הזה"
              className="data-[state=checked]:bg-emerald-600"
            />
            <span className="text-xs text-zinc-400">
              זכור אותי בצורה בטוחה על המכשיר הזה — <span className="text-zinc-500">כניסה חוזרת בלי מפתח, 90 יום, שלילה בלחיצה</span>
            </span>
          </div>
          {deviceRejected && (
            <p className="mt-2 text-[11px] font-mono text-amber-300/80">⚠ טוקן-המכשיר שהיה כאן נשלל או פג-תוקף (הצופן שלו נמחק מה-DB) — היכנס במפתח והמכשיר יחומש מחדש</p>
          )}

          {status && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-mono text-xs text-zinc-500"
            >
              <span><b className="text-zinc-300">{status.counts.vaultEntries}</b> סודות מוצפנים</span>
              <span className="text-zinc-700">·</span>
              <span><b className="text-zinc-300">{status.keySeals}</b> חותמות-מפתח</span>
              <span className="text-zinc-700">·</span>
              <span><b className="text-zinc-300">{status.counts.activeAgents}</b> סוכנים</span>
              <span className="text-zinc-700">·</span>
              <span>{status.initialized ? "מאותחל" : "לא מאותחל"}</span>
            </motion.div>
          )}
        </motion.div>
      </main>

      <footer className="relative z-10 mt-auto border-t border-zinc-900 bg-black/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center font-mono text-xs text-zinc-600 tracking-widest">
          SEALS CANNOT BE FORGED · GCM REJECTS EVERY WRONG KEY · 30-DAY SESSION
        </div>
      </footer>
    </div>
  );
}
