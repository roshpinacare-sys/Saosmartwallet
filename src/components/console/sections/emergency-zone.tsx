"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { apiJson, GlowCard, rise, SectionHead, setToken } from "@/components/console/kit";

export function EmergencyZone({ onAfter }: { onAfter: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (confirm !== "איפוס" || busy) return;
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; token?: string; imported?: number; keySeals?: unknown[]; error?: string }>("/api/gate/reset", {
        method: "POST", body: JSON.stringify({ key: key.trim(), newPassphrase: pass }),
      });
      if (r?.ok) {
        if (r.token) setToken(r.token);
        toast.success(`שחזור-חירום הושלם — ${r.imported} סודות ייובאו מחדש`);
        setKey(""); setPass(""); setConfirm(""); setOpen(false);
        await onAfter();
      } else toast.error(r?.error || "האיפוס נדחה");
    } finally { setBusy(false); }
  }

  return (
    <section className="py-14">
      <SectionHead num="10" title="אזור-חירום" sub="רק אם איבדת הכול: הוכחת-בעלות חיה משחזרת את הכספת מהמקורות ששרדו. כל המכשירים-המהימנים נשללים אוטומטית — מפתח-אב חדש." />
      <motion.div {...rise}>
        <GlowCard className="border-rose-500/20">
          <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-6 py-4 text-right" aria-expanded={open}>
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-sm">שחזור-חירום — בנייה מחדש של הכספת</p>
              <p className="text-xs text-zinc-500 mt-0.5">מוחק את ההצפנה הנוכחית ובונה מחדש מהמקורות · דורש מפתח owner/active חי</p>
            </div>
            <span className="font-mono text-zinc-500">{open ? "−" : "+"}</span>
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-6 space-y-3">
                  <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="מפתח owner/active של headcorner (מאומת חי)" className="font-mono text-sm bg-zinc-950/80 border-zinc-800" dir="ltr" autoComplete="off" spellCheck={false} />
                  <Input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="סיסמה חדשה (8+ תווים, אופציונלית בפועל)" className="bg-zinc-950/80 border-zinc-800" type="password" />
                  <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='הקלד "איפוס" כדי לאשר' className="bg-zinc-950/80 border-rose-500/30" />
                  <Button onClick={reset} disabled={busy || confirm !== "איפוס" || !key.trim() || pass.length < 8} variant="destructive" className="gap-2 w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} בצע שחזור-חירום
                  </Button>
                  <p className="text-[11px] text-zinc-600 leading-relaxed">
                    הפעולה מוכיחה בעלות מול השרשרת בלייב, מייבאת מחדש את כל המקורות ששרדו, ואוטמת מפתח-אב חדש תחת הסיסמה
                    ותחת כל מפתח-headcorner נוכחי. נוצר גיבוי מוצפן מקומי.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlowCard>
      </motion.div>
    </section>
  );
}
