"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Braces, Loader2, Lock } from "lucide-react";
import { api, ENDPOINTS, GlowCard, rise, SectionHead } from "@/components/console/kit";
import type { Ep } from "@/components/console/types";

export function ApiConsole() {
  const [sel, setSel] = useState<Ep>(ENDPOINTS[0]);
  const [body, setBody] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(e: Ep) { setSel(e); setBody(e.body || ""); setOut(null); setMeta(null); }

  async function run() {
    setBusy(true); setOut(null); setMeta(null);
    try {
      const res = await api(sel.path, sel.method === "POST" ? { method: "POST", body: body || "{}" } : {});
      const text = await res.text();
      setMeta(`${res.status} ${res.statusText}`);
      try { setOut(JSON.stringify(JSON.parse(text), null, 2)); } catch { setOut(text); }
    } catch (e) {
      setMeta("שגיאת-רשת");
      setOut(String((e as Error).message));
    } finally { setBusy(false); }
  }

  return (
    <section className="py-14">
      <SectionHead num="08" title="מסוף-API חי" sub="נקודות-הקצה להרצה חיה — הטוקן מצורף אוטומטית. זרמי-האימות, האיפוס והנעילה מוחרגים בכוונה מהמעבדה." />
      <div className="grid gap-4 lg:grid-cols-5">
        <motion.div {...rise} className="lg:col-span-2">
          <GlowCard className="p-2 max-h-[60vh] overflow-y-auto scroll-thin">
            <div className="space-y-1">
              {ENDPOINTS.map((e) => (
                <button
                  key={e.method + e.path}
                  onClick={() => pick(e)}
                  className={"w-full text-right rounded-xl px-3.5 py-2.5 transition-all " + (sel === e ? "bg-emerald-500/10 border border-emerald-500/30" : "hover:bg-zinc-900/60 border border-transparent")}
                >
                  <div className="flex items-center gap-2">
                    <span className={"font-mono text-[9px] font-black px-1.5 py-0.5 rounded " + (e.method === "GET" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300")}>{e.method}</span>
                    <span className="font-mono text-xs truncate" dir="ltr">{e.path}</span>
                    {e.auth === "operator" && <Lock className="h-3 w-3 text-zinc-600 shrink-0" aria-label="מוגן" />}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{e.desc}</p>
                </button>
              ))}
            </div>
          </GlowCard>
        </motion.div>

        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.1 }} className="lg:col-span-3">
          <GlowCard className="p-5 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={"font-mono text-[10px] font-black px-2 py-1 rounded " + (sel.method === "GET" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300")}>{sel.method}</span>
              <code className="font-mono text-sm text-zinc-200 break-all" dir="ltr">{sel.path}</code>
            </div>
            {sel.method === "POST" && (
              <div>
                <label htmlFor="ep-body" className="text-xs text-zinc-500 mb-1.5 block">גוף (JSON)</label>
                <Textarea id="ep-body" value={body} onChange={(e) => setBody(e.target.value)} dir="ltr" className="font-mono text-xs bg-zinc-950/80 border-zinc-800 min-h-24" />
              </div>
            )}
            <Button onClick={run} disabled={busy} className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Braces className="h-4 w-4" />} הרץ עכשיו
            </Button>
            {meta && <p className="font-mono text-xs text-zinc-500">↩ {meta}</p>}
            <AnimatePresence>
              {out && (
                <motion.pre
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl bg-black/70 border border-zinc-800 p-3.5 font-mono text-[11px] text-emerald-200/90 overflow-auto max-h-[46vh] scroll-thin leading-relaxed"
                  dir="ltr"
                >{out}</motion.pre>
              )}
            </AnimatePresence>
          </GlowCard>
        </motion.div>
      </div>
    </section>
  );
}
