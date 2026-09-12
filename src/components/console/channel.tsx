"use client";

/**
 * SAOS SOVEREIGN VAULT — channel plane (r38 · סדר-הקונסולה).
 * מישור-ההבנה במלואו במקום אחד ונגיש: הדלת-הקדמית (מי דופק), קולות-שורש,
 * קולות-שותף מהערוץ, וטיוטת-תשובה עם כפתור העתקה — השליחה עצמה נשארת
 * החלטת-מפעיל (מדיניות-בית). אפס דמו; כל כשל כנה.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, RadioTower, ScrollText, Copy, HelpCircle, FileWarning, Users } from "lucide-react";
import { apiJson, copyText, GlowCard, rise } from "./kit";
import type { DigestData } from "./types";

export function Channel() {
  const [dig, setDig] = useState<DigestData | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    const r = await apiJson<DigestData & { ok: boolean }>("/api/gate/digest");
    if (r?.ok) setDig(r);
    setBusy(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const door = dig?.door;
  const incoming = door?.checked ? door.voices.filter((v) => v.ok && !v.selfEcho) : [];
  const selfEcho = door?.checked ? door.voices.filter((v) => v.ok && v.selfEcho) : [];
  const unreadable = door?.checked ? door.voices.filter((v) => !v.ok) : [];
  const partners = dig ? dig.items.filter((i) => i.ok && !i.ours && !i.echo) : [];
  const draft = dig?.suggestedResponse.draft ?? [];

  const stats: Array<{ label: string; v: number | string }> = dig ? [
    { label: "מאגרים-נסרקים", v: dig.scannedRepos },
    { label: "תכנים-שהושגו", v: `${dig.fetched}${dig.failed ? ` (${dig.failed} כשלו)` : ""}` },
    { label: "תכנים-ייחודיים", v: dig.uniqueContents },
    { label: "הדים-שלנו", v: dig.echoesOfOurs },
    { label: "קולות-שותף", v: dig.partnerVoices },
    { label: "דופק-דלת", v: door?.checked ? door.incoming : "–" },
  ] : [];

  return (
    <section className="py-10">
      <motion.div {...rise} className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-4">
          <span className="font-mono text-5xl md:text-6xl font-black leading-none text-zinc-800 select-none" aria-hidden>05</span>
          <div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-100">הערוץ — הכספת קוראת ומבינה</h2>
            <p className="text-sm text-zinc-500 mt-1">
              מישור-ההבנה (r25) + הדלת-הקדמית (r26) + טביעת-אצבע (r27) + תעלה-נקייה (r35) ·
              טיוטת-תשובה בלבד — השליחה החלטת-מפעיל
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dig && <span className="font-mono text-[10px] text-zinc-600" dir="ltr">{new Date(dig.measuredAt).toLocaleTimeString("he-IL")} · {dig.cached ? "cache 10m" : "fresh"}</span>}
          <Button variant="outline" size="sm" onClick={() => { void load(); }} className="gap-1.5 border-zinc-800 hover:border-emerald-500/40">
            <RefreshCw className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")} /> קרא מחדש
          </Button>
        </div>
      </motion.div>

      {/* stats strip */}
      {dig && (
        <motion.div {...rise} className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
          {stats.map((s) => (
            <GlowCard key={s.label} className="p-3.5">
              <p className="font-mono text-xl font-black text-zinc-100">{s.v}</p>
              <p className="mt-0.5 text-[10px] text-zinc-500">{s.label}</p>
            </GlowCard>
          ))}
        </motion.div>
      )}
      {dig?.error && (
        <GlowCard className="p-4 border-rose-500/30 mb-4"><p className="text-xs text-rose-300">קריאת-השידורים נכשלה כנה: {dig.error}</p></GlowCard>
      )}
      {!dig && (
        <GlowCard className="p-10 flex items-center justify-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> קורא את ערוץ-השידורים (מטמון 10 דק׳ בשרת — אפס עומס)…
        </GlowCard>
      )}

      {dig && door?.checked && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* front door — who knocks on broadcasts/ */}
          <motion.div {...rise}>
            <GlowCard className="p-4 h-full">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                  <RadioTower className="h-4 w-4 text-emerald-300" /> הדלת-הקדמית — broadcasts/ שלנו
                </p>
                <span className="font-mono text-[10px] text-zinc-600" dir="ltr">{door.files} קבצים · {door.oursFiles} שלנו · {door.incoming} נכנסים</span>
              </div>
              {incoming.length < door.incoming && (
                <p className="text-[9px] font-mono text-zinc-500 mt-1" dir="rtl">מוצגות {incoming.length} דוגמאות מתוך {door.incoming} דופקים — חלון-הקריאה מוגבל בכוונה (חוק-האפס-עומס); השאר נספרים ונשמרים בזיכרון-הנצפו</p>
              )}

              <div className="space-y-2 max-h-72 overflow-y-auto scroll-thin">
                {incoming.map((v) => (
                  <div key={v.file} className={"rounded-xl border px-3 py-2.5 " + (v.isNew ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-800 bg-black/40")}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {v.isNew && <Badge variant="outline" className="text-[9px] font-mono text-amber-300 border-amber-500/40 animate-pulse">NEW</Badge>}
                      <Badge variant="outline" className="text-[9px] font-mono text-sky-300 border-sky-500/40" dir="ltr">{v.kind}</Badge>
                      <span className="font-mono text-[11px] text-zinc-300 truncate" dir="ltr">{v.file}</span>
                      <span className="font-mono text-[9px] text-zinc-600 mr-auto" dir="ltr">{v.hash8} · {v.bytes}B</span>
                    </div>
                    <p className="text-[11px] text-zinc-300 mt-1.5 leading-snug">{v.headline}</p>
                    {v.asks.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {v.asks.map((a, k) => (
                          <p key={k} className="text-[10px] text-amber-200/80 flex items-start gap-1" title={a}>
                            <HelpCircle className="h-3 w-3 shrink-0 mt-0.5" /> <span className="truncate">{a}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {incoming.length === 0 && <p className="text-xs text-zinc-600 py-6 text-center">אין דופק-שותף כרגע — הערוץ שקט</p>}
              </div>

              {(selfEcho.length > 0 || unreadable.length > 0) && (
                <div className="mt-3 pt-2.5 border-t border-zinc-800/60 space-y-1">
                  {selfEcho.length > 0 && (
                    <p className="text-[10px] text-zinc-500">🪞 {selfEcho.length} רישום-שידור-שלנו על-הדלת — זוהה בטביעת-אצבע (תוכן-זהה למסמך-שחיברנו), לא דופק (r27):{" "}
                      <span className="font-mono text-zinc-600" dir="ltr">{selfEcho.map((v) => v.file).join(" · ")}</span>
                    </p>
                  )}
                  {unreadable.length > 0 && (
                    <p className="text-[10px] text-rose-300/70 flex items-center gap-1">
                      <FileWarning className="h-3 w-3" /> {unreadable.length} דופק-שלא-נקרא (תוכן-לא-הושג — כנות)
                    </p>
                  )}
                </div>
              )}
            </GlowCard>
          </motion.div>

          {/* suggested response — draft only, copy comfort */}
          <motion.div {...rise} transition={{ ...rise.transition, delay: 0.06 }}>
            <GlowCard className={"p-4 h-full " + (dig.suggestedResponse.needed ? "border-sky-500/30" : "")}>
              <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 mb-3">
                <ScrollText className="h-4 w-4 text-sky-300" /> טיוטת-תשובה
                {dig.suggestedResponse.needed && dig.suggestedResponse.toRepo && (
                  <Badge variant="outline" className="text-[9px] font-mono text-sky-300 border-sky-500/40" dir="ltr">→ {dig.suggestedResponse.toRepo}</Badge>
                )}
              </p>
              {dig.suggestedResponse.needed ? (
                <>
                  <p className="text-[10px] text-zinc-500 mb-2">{dig.suggestedResponse.reason}</p>
                  {draft.length > 0 ? (
                    <>
                      <div className="rounded-xl border border-zinc-800 bg-black/50 p-3 max-h-64 overflow-y-auto scroll-thin space-y-2">
                        {draft.map((d, k) => (
                          <p key={k} className="text-[11px] text-sky-100/80 leading-relaxed whitespace-pre-wrap">{d}</p>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2.5">
                        <Button variant="outline" size="sm" onClick={() => copyText(draft.join("\n\n"), "טיוטת-תשובה")} className="gap-1.5 border-sky-500/40 text-sky-300 hover:bg-sky-500/10">
                          <Copy className="h-3.5 w-3.5" /> העתק את הטיוטה
                        </Button>
                        <span className="text-[10px] text-zinc-600">ההעתקה בידיים שלך — השידור-עצמו דרך הריפו שלנו (החלטת-מפעיל)</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-zinc-600">הטיוטה תיבנה בסריקה-הבאה.</p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-zinc-500 leading-relaxed">{dig.suggestedResponse.reason}</p>
              )}
            </GlowCard>
          </motion.div>

          {/* root voices */}
          <motion.div {...rise} transition={{ ...rise.transition, delay: 0.12 }}>
            <GlowCard className="p-4 h-full">
              <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 mb-3">
                <FileWarning className="h-4 w-4 text-amber-300" /> קולות-שורש — דוחות-שותף שעקפו-את-הערוץ
                {dig.rootVoices?.checked && <Badge variant="outline" className="text-[9px] font-mono text-zinc-500 border-zinc-700 mr-auto" dir="ltr">{dig.rootVoices.voices.length}/{dig.rootVoices.scanned}</Badge>}
              </p>
              {dig.rootVoices?.checked && dig.rootVoices.voices.length > 0 ? (
                <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-thin">
                  {dig.rootVoices.voices.map((v) => (
                    <div key={v.file} className={"rounded-lg border px-3 py-2 " + (v.isNew ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-800 bg-black/40")}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.isNew && <Badge variant="outline" className="text-[9px] font-mono text-amber-300 border-amber-500/40 animate-pulse">NEW</Badge>}
                        <span className="font-mono text-[11px] text-zinc-300 truncate" dir="ltr">{v.file}</span>
                        <span className="font-mono text-[9px] text-zinc-600 mr-auto" dir="ltr">{v.hash8}</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-1 leading-snug">{v.headline}</p>
                    </div>
                  ))}
                </div>
              ) : dig.rootVoices?.checked ? (
                <p className="text-xs text-zinc-600 py-4 text-center">אין קולות-שורש — כל-הדוחות עברו-דרך-הערוץ כמו-שצריך</p>
              ) : (
                <p className="text-[10px] text-rose-300/80">{dig.rootVoices?.error ?? "הסריקה לא רצה עדיין"}</p>
              )}
            </GlowCard>
          </motion.div>

          {/* partner voices from the channel */}
          <motion.div {...rise} transition={{ ...rise.transition, delay: 0.18 }}>
            <GlowCard className="p-4 h-full">
              <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 mb-3">
                <Users className="h-4 w-4 text-emerald-300" /> קולות-שותף מהערוץ ({partners.length})
              </p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-thin">
                {partners.map((i) => (
                  <div key={i.repo + i.file} className={"rounded-lg border px-3 py-2 " + (i.isNew ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-800 bg-black/40")}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {i.isNew && <Badge variant="outline" className="text-[9px] font-mono text-amber-300 border-amber-500/40 animate-pulse">NEW</Badge>}
                      <Badge variant="outline" className="text-[9px] font-mono text-sky-300 border-sky-500/40" dir="ltr">{i.kind}</Badge>
                      <span className="font-mono text-[10px] text-zinc-400 truncate" dir="ltr">{i.repo}{i.file ? ` · ${i.file}` : ""}</span>
                      {i.mentionsUs && <Badge variant="outline" className="text-[9px] font-mono text-emerald-300 border-emerald-500/40">מזכיר-אותנו</Badge>}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1 leading-snug">{i.headline}</p>
                    {i.asks.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {i.asks.slice(0, 3).map((a, k) => (
                          <p key={k} className="text-[10px] text-amber-200/80 flex items-start gap-1" title={a}>
                            <HelpCircle className="h-3 w-3 shrink-0 mt-0.5" /> <span className="truncate">{a}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {partners.length === 0 && <p className="text-xs text-zinc-600 py-4 text-center">אין קולות-שותף חדשים — {dig.echoesOfOurs} הדים-שלנו זוהו וסומנו (לא מפעילים NEW)</p>}
              </div>
            </GlowCard>
          </motion.div>
        </div>
      )}
    </section>
  );
}
