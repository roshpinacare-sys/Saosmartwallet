"use client";

/**
 * SAOS SOVEREIGN VAULT — overview plane (r38 · סדר-הקונסולה).
 * לוח-פיקוד רציני במקום Hero דף-נחיתה: KPIs אמיתיים, לב-האוטונומיה, היד-הכלכלית,
 * הדלת-הקדמית, עוגני-אמת וריפו-הארגון — הכל מה-APIs החיים, כל כשל כנה.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, Activity, HeartPulse, Wallet, RadioTower, Anchor, Github, Bot, ShieldCheck } from "lucide-react";
import { apiJson, GlowCard, rise } from "./kit";
import type { GateStatus, HeartData, SituationData, DigestData } from "./types";

const HEART_TICK_MS = 20000;

export function Overview({ status }: { status: GateStatus }) {
  const [sit, setSit] = useState<SituationData | null>(null);
  const [heart, setHeart] = useState<HeartData | null>(null);
  const [dig, setDig] = useState<DigestData | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    const [s, h, d] = await Promise.all([
      apiJson<SituationData & { ok: boolean }>("/api/gate/situation"),
      apiJson<HeartData>("/api/gate/heart"),
      apiJson<DigestData & { ok: boolean }>("/api/gate/digest"),
    ]);
    if (s?.ok) setSit(s);
    if (h?.ok) setHeart(h);
    if (d?.ok) setDig(d);
    setBusy(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    const t = setInterval(() => { void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  /* ── derived truth (measured, never claimed) ── */
  const beatAgeS = heart?.pulse?.lastTickAt ? Math.max(0, Math.round((Date.now() - new Date(heart.pulse.lastTickAt).getTime()) / 1000)) : null;
  const beatState = !heart?.pulse ? "dark" : beatAgeS !== null && beatAgeS <= (HEART_TICK_MS / 1000) * 3 ? "ok" : beatAgeS !== null && beatAgeS <= 120 ? "warn" : "stall";
  const beatColor = beatState === "ok" ? "text-emerald-400" : beatState === "warn" ? "text-amber-400" : beatState === "stall" ? "text-rose-400" : "text-zinc-600";
  const c = heart?.pulse?.counters;

  const steemRail = sit?.treasury.rails.find((r) => r.rail === "steem");
  const hiveRail = sit?.treasury.rails.find((r) => r.rail === "hive");
  const blurtRail = sit?.treasury.rails.find((r) => r.rail === "blurt");

  const emp = status.employment;
  const rate = emp?.doneRate ?? null;
  const rateColor = rate === null ? "text-zinc-500" : rate >= 70 ? "text-emerald-400" : rate >= 40 ? "text-amber-400" : "text-rose-400";

  const door = dig?.door;
  const doorIncoming = door?.checked ? door.incoming : null; // r40: the FULL door count — the fetched voices are only the bounded window
  const doorClassified = door?.checked ? door.voices.filter((v) => v.ok && !v.selfEcho).length : null;
  const doorNew = door?.checked ? door.voices.filter((v) => v.ok && !v.selfEcho && v.isNew).length : 0;
  const pendingAsks = door?.checked ? door.voices.filter((v) => v.ok && !v.selfEcho).reduce((n, v) => n + v.asks.length, 0) : null;
  const anchorsOk = sit?.anchors.ok ? sit.anchors.latest.filter((a) => true) : [];

  const kpis: Array<{ label: string; v: string | number; sub?: string; cls?: string }> = [
    { label: "סודות מוצפנים", v: status.counts.vaultEntries, sub: `${status.keySeals} חותמות-מפתח` },
    { label: "סוכנים פעילים", v: status.counts.activeAgents, sub: sit?.fleet.ok ? `${sit.fleet.autonomous} אוטונומיים · ${sit.fleet.activeRuns} ריצות-חיות` : undefined },
    { label: "הודעות-פיקוד", v: status.counts.messages, sub: "גשר חי · SSE" },
    { label: "הצלחת-הצי 24h", v: rate === null ? "–" : `${rate}%`, sub: emp ? `${emp.done} done · ${emp.blocked} blocked · ${emp.failed} failed` : "אין ריצות ב-24h", cls: rateColor },
    { label: "נזיל STEEM", v: steemRail?.ok ? steemRail.totals.liquid.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "כשל כן", sub: steemRail?.ok ? `${steemRail.totals.debt.toLocaleString("en-US", { maximumFractionDigits: 3 })} SBD חוב` : "מדידה נכשלה", cls: steemRail?.ok ? "text-emerald-300" : "text-rose-300/80" },
    { label: "דופק-הדלת", v: doorIncoming === null ? "–" : doorIncoming, sub: `${doorNew > 0 ? `${doorNew} חדש · ` : ""}${pendingAsks ?? 0} שאלות-פתוחות · מסווגים-חי ${doorClassified ?? 0}/${doorIncoming ?? 0}`, cls: doorNew > 0 ? "text-amber-300" : undefined },
  ];

  return (
    <section className="py-10">
      <motion.div {...rise} className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-4">
          <span className="font-mono text-5xl md:text-6xl font-black leading-none text-zinc-800 select-none" aria-hidden>00</span>
          <div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-100">סקירה — מצב-הרשת עכשיו</h2>
            <p className="text-sm text-zinc-500 mt-1">כל מספר כאן נמדד חי מה-APIs · רענון אוטומטי 60 שניות · כשל הוא ממצא-כנה</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void load(); }} className="gap-1.5 border-zinc-800 hover:border-emerald-500/40">
          <RefreshCw className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")} /> רענן עכשיו
        </Button>
      </motion.div>

      {/* KPI strip — real counts only */}
      <motion.div {...rise} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <GlowCard key={k.label} className="p-4">
            <p className={"font-mono text-2xl font-black " + (k.cls ?? "text-zinc-100")}>{k.v}</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">{k.label}</p>
            {k.sub && <p className="mt-1 text-[10px] text-zinc-600 leading-snug">{k.sub}</p>}
          </GlowCard>
        ))}
      </motion.div>

      {/* planes row */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* heart */}
        <motion.div {...rise}>
          <GlowCard className="p-4 h-full">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <HeartPulse className={"h-4 w-4 " + beatColor} /> לב-האוטונומיה
              </p>
              <Badge variant="outline" className={"text-[9px] font-mono " + (heart?.autonomyEnabled ? "text-emerald-300 border-emerald-500/40" : "text-zinc-500 border-zinc-700")}>
                {heart ? (heart.autonomyEnabled ? "פעיל" : "כבוי") : "…"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap font-mono text-[10px]" dir="ltr">
              <span className={"inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 " + (beatState === "ok" ? "border-emerald-500/40 text-emerald-300" : beatState === "warn" ? "border-amber-500/40 text-amber-300" : beatState === "stall" ? "border-rose-500/40 text-rose-300" : "border-zinc-800 text-zinc-600")}>
                <span className={"h-2 w-2 rounded-full " + (beatState === "ok" ? "bg-emerald-400 animate-pulse" : beatState === "warn" ? "bg-amber-400" : beatState === "stall" ? "bg-rose-400" : "bg-zinc-700")} aria-hidden />
                beat {heart?.pulse?.beats ?? 0}{beatAgeS !== null ? ` · ${beatAgeS}s ago` : ""}
              </span>
              <span className="rounded-lg border border-zinc-800 px-2 py-1 text-zinc-400">queued {heart?.counts.queued ?? "–"}</span>
              <span className="rounded-lg border border-zinc-800 px-2 py-1 text-zinc-400">running {heart?.counts.running ?? "–"}</span>
            </div>
            {c && (
              <div className="mt-2 flex items-center gap-2 flex-wrap font-mono text-[10px] text-zinc-500" dir="ltr">
                <span title="ריצות שהלב שיגר מהתור">dispatched {c.dispatched}</span>
                <span className="text-emerald-400/80" title="ריצות שהתאוששו מקריסה">recovered {c.recovered}</span>
                <span title="סיורים שהוזנקו מתוכננים">patrols {c.schedulesFired}</span>
                <span title="יוזמות-יעד שהוזנקו מהצעות סוכנים">initiatives {c.proposalsFired}</span>
                <span className="text-lime-300/80" title="תעסוקה-עצמית">self-employed {c.idleFired ?? 0}</span>
                <span title="ריצות קרוסות שהשומר החזיר לתור">reaped {c.reaped}</span>
              </div>
            )}
            {heart?.pulse?.error && <p className="mt-2 text-[10px] text-rose-300 font-mono" dir="ltr">⚠ {heart.pulse.error}</p>}
            <p className="mt-2.5 text-[10px] text-zinc-600">המתג והבקרה המלאה — בסעיף אוטונומיה</p>
          </GlowCard>
        </motion.div>

        {/* money */}
        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.06 }}>
          <GlowCard className="p-4 h-full">
            <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 mb-2.5">
              <Wallet className="h-4 w-4 text-emerald-300" /> היד-הכלכלית
              {sit && <span className="text-[9px] text-zinc-600 font-normal mr-auto font-mono" dir="ltr">{sit.cached ? "cache 60s" : "fresh"}</span>}
            </p>
            <div className="space-y-1">
              {sit ? (
                <>
                  {sit.treasury.rails.map((r) => (
                    <div key={r.rail} className="flex items-center justify-between text-[10px] font-mono" dir="ltr">
                      <span className={r.ok ? "text-zinc-400" : "text-rose-300/80"}>{r.rail.toUpperCase()}</span>
                      <span className={r.ok ? "text-emerald-300" : "text-rose-300/80"}>
                        {r.ok ? `${r.totals.liquid.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${r.liquidSymbol}${r.totals.debt > 0 ? ` · ${r.totals.debt.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${r.debtSymbol}` : ""}` : "כשל כן"}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-[10px] font-mono" dir="ltr">
                    <span className={sit.evm.ethereum.ok ? "text-zinc-400" : "text-rose-300/80"}>ETH</span>
                    <span className={sit.evm.ethereum.ok ? "text-emerald-300" : "text-rose-300/80"}>
                      {sit.evm.ethereum.ok ? `${sit.evm.ethereum.total} · ${sit.evm.ethereum.okWallets}/${sit.evm.ethereum.wallets} ארנקים` : "כשל כן"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono" dir="ltr">
                    <span className={sit.evm.solana.ok ? "text-zinc-400" : "text-rose-300/80"}>SOL</span>
                    <span className={sit.evm.solana.ok ? "text-emerald-300" : "text-rose-300/80"}>
                      {sit.evm.solana.ok ? `${sit.evm.solana.total} · ${sit.evm.solana.okWallets}/${sit.evm.solana.wallets} ארנקים` : "כשל כן"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-zinc-800/60" dir="ltr">
                    <span className={sit.rewards.ok ? "text-zinc-400" : "text-rose-300/80"}>תגמולים-ממתינים</span>
                    {sit.rewards.ok ? (
                      sit.rewards.totalPendingSteemEquiv > 0
                        ? <span className="text-amber-300">{sit.rewards.totalPendingSteemEquiv.toFixed(4)} STEEM-equiv · {sit.rewards.pendingAccounts.length} חשבונות</span>
                        : <span className="text-zinc-500">אפס — הכל נתבע</span>
                    ) : <span className="text-rose-300/80">כשל כן</span>}
                  </div>
                </>
              ) : (
                <p className="text-[10px] text-zinc-600 py-3 text-center font-mono" dir="ltr">
                  <Loader2 className="h-3 w-3 inline animate-spin" /> מודד את הכיס…
                </p>
              )}
            </div>
          </GlowCard>
        </motion.div>

        {/* front door */}
        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.12 }}>
          <GlowCard className={"p-4 h-full " + (doorNew > 0 ? "border-amber-500/30" : "")}>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <RadioTower className="h-4 w-4 text-sky-300" /> הדלת-הקדמית
              </p>
              {door?.checked && <Badge variant="outline" className={"text-[9px] font-mono " + (doorNew > 0 ? "text-amber-300 border-amber-500/40" : "text-zinc-500 border-zinc-700")}>{door.incoming} דופקים</Badge>}
            </div>
            {!dig && <p className="text-[10px] text-zinc-600 py-3 text-center font-mono" dir="ltr"><Loader2 className="h-3 w-3 inline animate-spin" /> קורא את הערוץ…</p>}
            {dig && !door?.checked && <p className="text-[10px] text-rose-300/80">{door?.error ?? "הסריקה לא רצה עדיין"}</p>}
            {dig && door?.checked && (
              <>
                <div className="space-y-1.5">
                  {door.voices.filter((v) => v.ok && !v.selfEcho).slice(0, 3).map((v) => (
                    <div key={v.file} className="text-[10px] font-mono" dir="ltr">
                      <span className={v.isNew ? "text-amber-300 font-semibold" : "text-emerald-200/90"}>{v.isNew ? "NEW " : ""}[{v.kind}] {v.file.replace(/\.md$/, "")}</span>
                      <span className="text-zinc-500"> — {v.headline.slice(0, 60)}</span>
                    </div>
                  ))}
                  {door.voices.filter((v) => v.ok && !v.selfEcho).length === 0 && (
                    <p className="text-[10px] text-zinc-600 py-1">אין דופק-שותף כרגע — הערוץ שקט</p>
                  )}
                </div>
                <p className="mt-2 text-[10px] text-zinc-600">
                  {pendingAsks ?? 0} שאלות-פתוחות שהוצבו-לנו (מסווגים-חי {doorClassified ?? 0} מה-{door.incoming}) · {(door.selfEchoVoices ?? 0)} 🪞 הד-שידור-שלנו (זוהה בטביעת-אצבע)
                  {" "}· הפירוט המלא וטיוטת-התשובה — בסעיף ערוץ
                </p>
              </>
            )}
            {dig?.error && <p className="mt-1 text-[10px] text-rose-300/70">🧠 {dig.error}</p>}
          </GlowCard>
        </motion.div>
      </div>

      {/* anchors + repos row */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <motion.div {...rise}>
          <GlowCard className="p-4 h-full">
            <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 mb-2.5">
              <Anchor className="h-4 w-4 text-lime-300" /> עוגני-אמת על-השרשרת
              {sit?.anchors.ok && <Badge variant="outline" className="text-[9px] font-mono text-zinc-500 border-zinc-700 mr-auto" dir="ltr">{sit.anchors.count} recorded</Badge>}
            </p>
            {sit?.anchors.ok && anchorsOk.length > 0 ? (
              <div className="space-y-1">
                {sit.anchors.latest.slice(0, 4).map((a) => (
                  <div key={a.chain + a.txId} className="flex items-center gap-2 text-[10px] font-mono" dir="ltr">
                    <span className={a.chain === "steem" ? "text-sky-300" : "text-lime-300"}>{a.chain}</span>
                    <span className="text-zinc-400">blk {a.blockNum ?? "?"}</span>
                    <span className="text-zinc-600 truncate max-w-[40%]">{a.txId.slice(0, 18)}…</span>
                    <span className="text-zinc-600 mr-auto">{a.round}</span>
                  </div>
                ))}
              </div>
            ) : sit?.anchors.ok ? (
              <p className="text-[10px] text-zinc-600">אין עוגנים מדודים כרגע — האמת תחושב כשהמדידה תרוץ</p>
            ) : sit ? (
              <p className="text-[10px] text-rose-300/80">{sit.anchors.error ?? "כשל כן"}</p>
            ) : (
              <p className="text-[10px] text-zinc-600 font-mono" dir="ltr"><Loader2 className="h-3 w-3 inline animate-spin" /> loading…</p>
            )}
          </GlowCard>
        </motion.div>

        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.06 }}>
          <GlowCard className="p-4 h-full">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <Github className="h-4 w-4 text-zinc-300" /> ריפו-הארגון {sit?.repos.ok ? `(${sit.repos.org})` : ""}
              </p>
              {sit?.repos.ok && (
                <Badge variant="outline" className={"text-[9px] font-mono " + (sit.repos.freshCount > 0 ? "text-amber-300 border-amber-500/40" : "text-zinc-500 border-zinc-700")}>
                  {sit.repos.count} מאגרים · {sit.repos.freshCount} פעילים-עכשיו
                </Badge>
              )}
            </div>
            {sit?.repos.ok ? (
              <>
                <div className="max-h-28 overflow-y-auto scroll-thin space-y-0.5">
                  {sit.repos.repos.slice(0, 8).map((r) => (
                    <div key={r.name} className="flex items-center justify-between text-[10px] font-mono py-0.5" dir="ltr">
                      <span className={"truncate max-w-[60%] " + (r.ours ? "text-sky-300 font-semibold" : r.fresh ? "text-amber-200/90" : "text-zinc-400")}>{r.ours ? "★ " : ""}{r.name}</span>
                      <span className="flex items-center gap-1 text-zinc-500">
                        {r.fresh && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" aria-label="פעיל עכשיו" />}
                        {r.pushedMinutesAgo !== null ? (r.pushedMinutesAgo < 60 ? `${r.pushedMinutesAgo} דק׳` : r.pushedMinutesAgo < 1440 ? `${Math.floor(r.pushedMinutesAgo / 60)} שע׳` : `${Math.floor(r.pushedMinutesAgo / 1440)} ימ׳`) : "?"}
                      </span>
                    </div>
                  ))}
                </div>
                {(sit.repos.broadcastTotal ?? 0) > 0 && (
                  <p className="mt-1.5 pt-1.5 border-t border-zinc-800/80 text-[10px] font-mono text-emerald-300/90">📡 שידורים-נכנסים ({sit.repos.broadcastTotal}) — ערוץ הדדי</p>
                )}
              </>
            ) : sit ? (
              <p className="text-[10px] text-rose-300/80">{sit.repos.error ?? "סריקת-הארגון נכשלה כנה"}</p>
            ) : (
              <p className="text-[10px] text-zinc-600 font-mono" dir="ltr"><Loader2 className="h-3 w-3 inline animate-spin" /> scanning…</p>
            )}
          </GlowCard>
        </motion.div>
      </div>

      {/* employment strip + vault/fleet line */}
      <motion.div {...rise} className="mt-4 grid gap-4 md:grid-cols-2">
        <GlowCard className="p-4">
          <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 mb-2.5">
            <Activity className="h-4 w-4 text-lime-300" /> תעסוקת-הצי · 24h
          </p>
          {emp && emp.runs24h > 0 ? (
            <>
              <div className="flex items-center gap-2 flex-wrap font-mono text-[10px]" dir="ltr">
                <span className="rounded-md border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5">done {emp.done}</span>
                <span className="rounded-md border border-zinc-700 text-zinc-300 px-1.5 py-0.5">blocked {emp.blocked}</span>
                <span className="rounded-md border border-rose-500/30 text-rose-300 px-1.5 py-0.5">failed {emp.failed}</span>
                <span className="rounded-md border border-zinc-800 text-zinc-400 px-1.5 py-0.5">running {emp.running}</span>
                <span className="rounded-md border border-lime-500/30 text-lime-300 px-1.5 py-0.5">idle {emp.idleRuns24h}</span>
              </div>
              {(() => {
                const t = emp.blockedTaxonomy;
                const taxTotal = t.fair + t.vaultLocked + t.rate429 + t.watchdog + t.other;
                if (taxTotal <= 0) return null;
                return (
                  <p className="mt-1.5 text-[10px] text-zinc-500 leading-relaxed">
                    חסימות לפי סיבה (חי): <span className="font-mono text-zinc-400" dir="ltr">fair {t.fair} · vault-locked {t.vaultLocked} · 429 {t.rate429} · watchdog {t.watchdog} · other {t.other}</span>
                  </p>
                );
              })()}
            </>
          ) : (
            <p className="text-[10px] text-zinc-600">אין ריצות ב-24 השעות — הזנק מטרה או קבע סיור בסעיף סוכנים</p>
          )}
        </GlowCard>

        <GlowCard className="p-4">
          <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 mb-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> הכספת והצי — שורת-אמת
          </p>
          {sit?.vault.ok && sit.fleet.ok ? (
            <div className="space-y-1 text-[10px] font-mono">
              <div className="flex items-center justify-between" dir="ltr">
                <span className="text-zinc-400">vault</span>
                <span className="text-zinc-200">{sit.vault.total} · {sit.vault.verified} verified (status-col){sit.vault.rotatedOut > 0 ? ` · ${sit.vault.rotatedOut} rotated-out` : ""}</span>
              </div>
              <div className="flex items-center justify-between" dir="ltr">
                <span className="text-zinc-400">fleet</span>
                <span className="text-zinc-200">{sit.fleet.agents} סוכנים ({sit.fleet.autonomous} אוטונומיים) · {sit.fleet.activeRuns} ריצות-חיות</span>
              </div>
              <div className="flex items-center justify-between gap-2" dir="ltr">
                <span className="text-zinc-400 shrink-0">chains</span>
                <span className="text-zinc-500 truncate">{Object.entries(sit.vault.chains).map(([ch, n]) => `${ch}:${n}`).join(" · ")}</span>
              </div>
              <div className="flex items-center justify-between" dir="ltr">
                <span className="text-zinc-400">bots</span>
                <span className="text-zinc-200 flex items-center gap-1"><Bot className="h-3 w-3 text-emerald-400" /> {status.counts.activeAgents} מחוברים</span>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-zinc-600 font-mono" dir="ltr"><Loader2 className="h-3 w-3 inline animate-spin" /> מרכיב את התמונה המלאה…</p>
          )}
        </GlowCard>
      </motion.div>
    </section>
  );
}
