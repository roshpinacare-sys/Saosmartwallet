"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Radio, Send } from "lucide-react";
import { apiJson, GlowCard, rise, SectionHead } from "@/components/console/kit";
import type { Msg } from "@/components/console/types";

export function Bridge() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false); // SSE connected — push beats polling
  const viewportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; messages: Msg[] }>("/api/gate/messages");
    if (r?.ok) setMsgs((r.messages || []).slice(-100));
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    // BRIDGE-ENGINE: one live stream instead of blind 5s polling. On any
    // failure the old poller takes over — the bridge never goes dark.
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (!poll) poll = setInterval(() => { load(); }, 5000);
    };
    try {
      es = new EventSource("/api/gate/stream");
      es.addEventListener("hello", () => { setLive(true); if (poll) { clearInterval(poll); poll = null; } });
      es.addEventListener("messages", (ev) => {
        try {
          const arr = JSON.parse((ev as MessageEvent).data) as Msg[];
          setMsgs((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = arr.filter((m) => !seen.has(m.id));
            return fresh.length ? [...prev, ...fresh].slice(-100) : prev;
          });
        } catch { /* malformed frame — the next poller tick repairs */ }
      });
      es.onerror = () => { setLive(false); startPoll(); };
    } catch {
      startPoll();
    }
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [load]);
  // Chat etiquette: follow fresh messages ONLY when the reader is already at
  // the bottom of the bridge AND the bridge is on-screen. We scroll the INNER
  // container (scrollTop) — which by construction can never drag the page —
  // instead of scrollIntoView, which yanked the whole window down to §05 on
  // every SSE push (user-reported: "הגשר כל הזמן מושך את הדף").
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof window === "undefined") return;
    const rect = vp.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
    const atBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 140;
    if (onScreen && atBottom) vp.scrollTop = vp.scrollHeight;
  }, [msgs]);

  async function send() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true); setInput("");
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/messages", { method: "POST", body: JSON.stringify({ body }) });
      if (r?.ok) await load();
      else toast.error(r?.error || "השליחה נכשלה");
    } finally { setSending(false); }
  }

  return (
    <section className="py-14">
      <SectionHead num="06" title="גשר-הפיקוד" sub="אתה, הסוכנים והמערכת — ערוץ אחד. הכול נרשם." />
      <motion.div {...rise}>
        <GlowCard className="flex flex-col h-[480px] overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-3">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-500" dir="ltr">
              <Radio className={"h-3 w-3 " + (live ? "text-emerald-400 animate-pulse" : "text-zinc-600")} aria-hidden />
              {live ? "live stream" : "polling"}
            </span>
          </div>
          <div ref={viewportRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 py-4">
            <div className="space-y-3">
              {msgs.map((m) => (
                <div key={m.id} className={"flex gap-2.5 items-start " + (m.fromKind === "operator" ? "flex-row-reverse" : "")}>
                  <Badge
                    variant="outline"
                    className={
                      "shrink-0 text-[10px] mt-0.5 font-mono " +
                      (m.fromKind === "operator" ? "text-emerald-400 border-emerald-500/40"
                        : m.fromKind === "agent" ? "text-amber-300 border-amber-500/40"
                        : "text-zinc-500 border-zinc-700")
                    }
                  >
                    {m.fromKind === "operator" ? "אתה" : m.fromKind === "agent" ? m.fromName : "SYS"}
                  </Badge>
                  <div className={"max-w-[78%] rounded-2xl px-4 py-2.5 " + (m.fromKind === "operator" ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-zinc-900/70 border border-zinc-800")}>
                    <p className="text-sm break-words whitespace-pre-wrap leading-relaxed text-zinc-200">{m.body}</p>
                    <p className="text-[9px] text-zinc-600 mt-1 font-mono">{new Date(m.createdAt).toLocaleString("he-IL")}</p>
                  </div>
                </div>
              ))}
              {msgs.length === 0 && <p className="text-sm text-zinc-500 text-center py-10">הערוץ ריק — כתוב פקודה ראשונה</p>}
            </div>
          </div>
          <div className="border-t border-zinc-800/80 p-3.5 flex gap-2 bg-black/40">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !sending) send(); }}
              placeholder="פקודה או הודעה…"
              className="bg-zinc-950/80 border-zinc-800"
              aria-label="הודעה לגשר-הפיקוד"
            />
            <Button onClick={send} disabled={sending || !input.trim()} className="bg-emerald-600 hover:bg-emerald-500 text-black shrink-0" aria-label="שלח">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </GlowCard>
      </motion.div>
    </section>
  );
}
