"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Github, Globe, Loader2, RefreshCw } from "lucide-react";
import { apiJson, GlowCard, rise, SectionHead } from "@/components/console/kit";
import type { Inventory } from "@/components/console/types";

export function Connections() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    const i = await apiJson<Inventory>("/api/gate/inventory");
    setInv(i);
    setBusy(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const verifyAll = useCallback(() => { setBusy(true); return load(); }, [load]);

  const chains = inv?.chains;
  const summary = inv?.summary;
  const byChain = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of inv?.entries || []) {
      const c = (e.chain || e.kind).toLowerCase();
      m[c] = (m[c] || 0) + 1;
    }
    return m;
  }, [inv]);

  const cards = [
    {
      name: "STEEM", icon: <Globe className="h-5 w-5" />, ok: chains?.steemOk,
      endpoint: "api.steemit.com", count: summary?.rails?.steem ?? 0, secrets: byChain["steem"] || 0,
    },
    {
      name: "HIVE", icon: <Globe className="h-5 w-5" />, ok: chains?.hiveOk,
      endpoint: "api.hive.blog", count: summary?.rails?.hive ?? 0, secrets: byChain["hive"] || 0,
    },
    {
      name: "BLURT", icon: <Globe className="h-5 w-5" />, ok: chains?.blurtOk,
      endpoint: "blurt-rpc.saboin.com", count: summary?.rails?.blurt ?? 0, secrets: byChain["blurt"] || 0,
    },
    {
      name: "GITHUB", icon: <Github className="h-5 w-5" />, ok: chains?.githubOk,
      endpoint: "api.github.com", count: summary?.rails?.github ?? 0, secrets: byChain["github"] || 0,
    },
  ];

  return (
    <section className="py-14">
      <SectionHead num="01" title="החיבורים — הוכחה חיה" sub="כל שרשרת נבדקת מול הרשת בפועל, עכשיו. אין מצב-מדומה." />
      <motion.div {...rise} className="flex justify-end mb-4">
        <Button variant="outline" size="sm" onClick={verifyAll} className="gap-1.5 border-zinc-800 hover:border-emerald-500/40">
          <RefreshCw className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")} /> אמת הכל עכשיו
        </Button>
      </motion.div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div key={c.name} {...rise} transition={{ ...rise.transition, delay: i * 0.08 }}>
            <GlowCard className={"p-6 h-full relative overflow-hidden " + (c.ok === true ? "border-emerald-500/30" : c.ok === false ? "border-rose-500/30" : "")}>
              {c.ok === true && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-l from-transparent via-emerald-400/70 to-transparent" />}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-zinc-200">{c.icon}<span className="font-mono font-bold tracking-wider">{c.name}</span></div>
                {c.ok === true
                  ? <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" /></span>
                  : c.ok === false
                    ? <span className="h-3 w-3 rounded-full bg-rose-500" />
                    : <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
              </div>
              <p className="mt-4 font-mono text-3xl font-black">{busy && !inv ? "…" : c.count}</p>
              <p className="text-xs text-emerald-500/90 mt-1">מפתחות עם סמכות-חיה ברשת</p>
              <p className="text-xs text-zinc-500 mt-0.5">{c.secrets} סודות בכספת</p>
              <p className="mt-3 font-mono text-[10px] text-zinc-600" dir="ltr">{c.endpoint}</p>
            </GlowCard>
          </motion.div>
        ))}
      </div>
      {summary && (
        <motion.p {...rise} className="mt-4 font-mono text-xs text-zinc-500">
          אימות-חי אחרון: <b className="text-emerald-400">{summary.verified}</b> עברו ·{" "}
          {(() => {
            // r19 — rotated-out rows are history by design (their keys left the
            // chain on purpose); counting them as "failures" was a living lie
            const realFailed = summary.failed - (summary.rotatedOut ?? 0);
            return (
              <>
                {realFailed > 0 ? <span className="text-rose-400">{realFailed} נכשלו</span> : <span className="text-zinc-600">0 נכשלו</span>}
                {(summary.rotatedOut ?? 0) > 0 && <span className="text-zinc-500"> · {summary.rotatedOut} rotated-out (היסטוריה-מכוונת)</span>}
              </>
            );
          })()}{" "}
          {summary.noLive} ללא-בדיקה-אפשרית
          {summary.rails && (
            <> · סמכויות-חיה: steem {summary.rails.steem ?? 0} · hive {summary.rails.hive ?? 0} · blurt {summary.rails.blurt ?? 0} · ETH {summary.rails.ethereum ?? 0} · TRX {summary.rails.tron ?? 0} · SOL {summary.rails.solana ?? 0} · BTC {summary.rails.bitcoin ?? 0}</>
          )}
        </motion.p>
      )}
    </section>
  );
}
