"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { apiJson, GlowCard, rise, SectionHead } from "@/components/console/kit";
import type { ActionRow } from "@/components/console/types";

export function Audit() {
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; actions: ActionRow[] }>("/api/gate/actions");
    if (r?.ok) setActions(r.actions || []);
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const refresh = useCallback(() => { setLoading(true); return load(); }, [load]);

  return (
    <section className="py-14">
      <div className="flex items-end justify-between">
        <SectionHead num="07" title="ביקורת" sub="כל פעולת-סוכן — רשומה. תמיד." />
        <Button variant="ghost" size="sm" onClick={refresh} className="gap-1.5 text-zinc-500 mb-6">
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
        </Button>
      </div>
      <motion.div {...rise}>
        <GlowCard className="p-2 max-h-96 overflow-y-auto scroll-thin">
          <div className="divide-y divide-zinc-800/50">
            {loading && actions.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10 text-zinc-500 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>
            )}
            {actions.map((a) => (
              <details key={a.id} className="px-4 py-3 group">
                <summary className="flex items-center gap-2.5 flex-wrap cursor-pointer list-none">
                  <span className={"h-2 w-2 rounded-full shrink-0 " + (a.ok ? "bg-emerald-500" : "bg-rose-500")} />
                  <span className="font-mono text-sm font-bold">{a.agentName}</span>
                  <span className="font-mono text-xs text-amber-300/80">{a.action}</span>
                  <span className="text-[10px] text-zinc-600 mr-auto font-mono">{new Date(a.createdAt).toLocaleString("he-IL")}</span>
                </summary>
                <pre className="mt-2 font-mono text-[10px] text-zinc-500 break-all whitespace-pre-wrap bg-black/60 border border-zinc-800/70 rounded-lg p-2.5 leading-relaxed" dir="ltr">
{`params: ${a.params}
result: ${a.result}`}
                </pre>
              </details>
            ))}
            {!loading && actions.length === 0 && <p className="text-center text-zinc-500 text-sm py-10">אין פעולות עדיין</p>}
          </div>
        </GlowCard>
      </motion.div>
    </section>
  );
}
