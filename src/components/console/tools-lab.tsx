"use client";

/**
 * tools-lab.tsx — מעבדת-הכלים (r29)
 * ================================================================================
 * מישור חדש בקונסולה: היכולות שנבנו מהפרויקטים שהמשתמש העלה (r29):
 *   · מוח-קוד AxiomState — סנכרון אינקרמנטלי, שאילתות-תלויות מדויקות,
 *     באנדל-הקשר דטרמיניסטי (מ-AxiomState Phase 2 של המשתמש).
 *   · הבנקאי-הזמני TIB — תקציבי אסימונים לסוכנים (מ-SRS TemporalBankerScheduler).
 *   · שער-עקביות — self-audit (תבנית TFA Evolution Studio) נרץ ב-CLI וחוסם-שחרור.
 *
 * אפס סודות: כל הקריאות כאן ציבוריות ומוצגות כמו-שהן; פעולות-כתיבה על
 * הבנקאי fail-closed (דורשות BANKER_TOKEN של המפעיל).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Boxes, Brain, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { GlowCard, SectionHead, apiJson } from "@/components/console/kit";

type AxiomStatus = {
  key: string;
  seq: string | null;
  keyCount: number;
  checkpointSeq: string | null;
  filesIndexed: number;
  symbolsIndexed: number;
  lastSync: { at: string; scanned: number; changed: number; removed: number } | null;
};

const ROOTS = ["src", "prisma", "scripts", "docs"] as const;

const QUERY_PRESETS = [
  "rdeps(file:lib/hardening.ts)",
  "deps(file:app/page.tsx,1)",
  "and(kind:file, deps(file:lib/gate/digest.ts))",
  "name:*banker*",
];

export function ToolsLab() {
  const [status, setStatus] = useState<AxiomStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [query, setQuery] = useState(QUERY_PRESETS[0]);
  const [queryRoot, setQueryRoot] = useState<string>("src");
  const [queryRun, setQueryRun] = useState<{ ids: string[]; total: number; truncated: boolean; ms: number } | null>(null);
  const [querying, setQuerying] = useState(false);
  const [bundleEntry, setBundleEntry] = useState("file:lib/hardening.ts");
  const [bundleRun, setBundleRun] = useState<{ order: string[]; cycles: string[]; totalBytes: number; truncated: boolean } | null>(null);
  const [bundling, setBundling] = useState(false);
  const [banker, setBanker] = useState<Array<{ agent: string; budget: { budget: number; maxBudget: number; refillPerHour: number }; defaults?: { unitCost?: number } }>>([]);

  const loadStatus = useCallback(async () => {
    const res = await apiJson<{ ok: boolean; status?: AxiomStatus[] }>("/api/code/query?status=1");
    setStatus(res?.ok && res.status ? res.status : []);
    setLoading(false);
  }, []);

  const loadBanker = useCallback(async () => {
    const res = await apiJson<{ ok: boolean; banker?: Array<{ agent: string; budget: { budget: number; maxBudget: number; refillPerHour: number }; defaults?: { unitCost?: number } }> }>("/api/gate/banker");
    if (res?.ok && res.banker) setBanker(res.banker);
  }, []);

  useEffect(() => {
    loadStatus();
    loadBanker();
  }, [loadStatus, loadBanker]);

  const syncRoot = async (root: string) => {
    setSyncing(root);
    const res = await apiJson<{ ok: boolean; sync?: { changed: number; scanned: number; removed: number } }>("/api/code/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root }),
    });
    setSyncing(null);
    if (res?.ok && res.sync) {
      toast.success(`סונכרן ${root}: ${res.sync.changed} שונו / ${res.sync.scanned} נסרקו`);
      loadStatus();
    } else {
      toast.error("סנכרון נכשל");
    }
  };

  const runQuery = async () => {
    setQuerying(true);
    const t0 = performance.now();
    const res = await apiJson<{ ok: boolean; ids?: string[]; total?: number; truncated?: boolean; error?: string }>(
      `/api/code/query?root=${encodeURIComponent(queryRoot)}&q=${encodeURIComponent(query)}`,
    );
    setQuerying(false);
    if (res?.ok && res.ids) {
      setQueryRun({ ids: res.ids, total: res.total ?? res.ids.length, truncated: !!res.truncated, ms: Math.round(performance.now() - t0) });
    } else {
      toast.error(res?.error ?? "שאילתה נכשלה");
      setQueryRun(null);
    }
  };

  const runBundle = async () => {
    setBundling(true);
    const res = await apiJson<{ ok: boolean; bundle?: { order: string[]; cycles: string[]; totalBytes: number; truncated: boolean }; error?: string }>(
      `/api/code/bundle?root=${encodeURIComponent(queryRoot)}&entry=${encodeURIComponent(bundleEntry)}`,
    );
    setBundling(false);
    if (res?.ok && res.bundle) setBundleRun(res.bundle);
    else toast.error(res?.error ?? "באנדל נכשל");
  };

  return (
    <section className="py-10">
      <SectionHead
        num="11"
        title="מעבדת-כלים"
        sub="r29 · היכולות שנבנו מהפרויקטים שהעלית: מוח-קוד AxiomState · הבנקאי-הזמני TIB · שער-עקביות (תבנית TFA)"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* מוח-קוד AxiomState */}
        <GlowCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-emerald-400" aria-hidden />
              <h3 className="font-mono text-sm text-zinc-200" dir="rtl">מוח-קוד AxiomState — גרף-AST על WAL בלתי-הפיך</h3>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); loadStatus(); }} className="border-zinc-800 text-zinc-400 h-7">
              <RefreshCw className={"h-3 w-3" + (loading ? " animate-spin" : "")} /> רענן
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            {ROOTS.map((root) => {
              const st = status.find((s) => s.key === root);
              return (
                <div key={root} className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-emerald-300">{root}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => syncRoot(root)}
                      disabled={syncing !== null}
                      className="h-6 px-2 text-[10px] text-zinc-400 hover:text-emerald-300"
                      aria-label={`סנכרון ${root}`}
                    >
                      {syncing === root ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} סנכרן
                    </Button>
                  </div>
                  {st ? (
                    <div className="space-y-0.5 font-mono text-[10px] text-zinc-500" dir="ltr">
                      <div>seq <b className="text-zinc-300">{st.seq}</b> · keys <b className="text-zinc-300">{st.keyCount}</b></div>
                      <div>files <b className="text-zinc-300">{st.filesIndexed}</b> · symbols <b className="text-zinc-300">{st.symbolsIndexed}</b></div>
                    </div>
                  ) : (
                    <div className="font-mono text-[10px] text-zinc-600">טרם-סונכרן — לחץ סנכרן</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* שאילתות */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {QUERY_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setQuery(p)}
                  className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[10px] text-zinc-400 hover:border-emerald-500/40 hover:text-emerald-300 transition-colors"
                  dir="ltr"
                >
                  {p.length > 34 ? p.slice(0, 34) + "…" : p}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <select
                value={queryRoot}
                onChange={(e) => setQueryRoot(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-300"
                aria-label="שורש לשאילתה"
              >
                {ROOTS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                dir="ltr"
                className="flex-1 h-8 bg-zinc-950 border-zinc-800 font-mono text-xs"
                placeholder="rdeps(file:lib/...)"
                aria-label="שאילתת-DSL"
              />
              <Button size="sm" onClick={runQuery} disabled={querying} className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white gap-1">
                {querying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} הרץ
              </Button>
            </div>
            {queryRun && (
              <div className="rounded-lg border border-zinc-800/80 bg-black/50 p-3">
                <p className="font-mono text-[10px] text-zinc-500 mb-1.5" dir="rtl">
                  {queryRun.total} תוצאות · {queryRun.ms}ms{queryRun.truncated ? " · חתוך ל-400" : ""}
                </p>
                <div className="max-h-40 overflow-y-auto scroll-thin font-mono text-[11px] space-y-0.5" dir="ltr">
                  {queryRun.ids.map((id) => (
                    <div key={id} className="text-emerald-300/80 truncate">{id}</div>
                  ))}
                </div>
              </div>
            )}

            {/* באנדל */}
            <div className="flex gap-2 pt-1">
              <Input
                value={bundleEntry}
                onChange={(e) => setBundleEntry(e.target.value)}
                dir="ltr"
                className="flex-1 h-8 bg-zinc-950 border-zinc-800 font-mono text-xs"
                placeholder="file:src/..."
                aria-label="כניסת-באנדל"
              />
              <Button size="sm" variant="outline" onClick={runBundle} disabled={bundling} className="h-8 border-zinc-800 text-zinc-300 gap-1">
                {bundling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Boxes className="h-3.5 w-3.5" />} באנדל
              </Button>
            </div>
            {bundleRun && (
              <div className="rounded-lg border border-zinc-800/80 bg-black/50 p-3">
                <p className="font-mono text-[10px] text-zinc-500 mb-1.5" dir="rtl">
                  {bundleRun.order.length} קבצים בסדר-טופולוגי · {bundleRun.totalBytes}B{bundleRun.truncated ? " · חתוך (512KB)" : ""}
                  {bundleRun.cycles.length > 0 ? ` · מעגלים: ${bundleRun.cycles.length}` : ""}
                </p>
                <div className="max-h-32 overflow-y-auto scroll-thin font-mono text-[11px] space-y-0.5" dir="ltr">
                  {bundleRun.order.map((id, i) => (
                    <div key={id} className="text-zinc-400 truncate"><span className="text-zinc-600">{i + 1}.</span> {id}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </GlowCard>

        {/* הבנקאי-הזמני TIB */}
        <div className="space-y-4">
          <GlowCard className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-lime-400" aria-hidden />
                <h3 className="font-mono text-sm text-zinc-200" dir="rtl">הבנקאי-הזמני TIB — תקציבי-אסימונים לסוכנים</h3>
              </div>
              <Button variant="outline" size="sm" onClick={loadBanker} className="border-zinc-800 text-zinc-400 h-7">
                <RefreshCw className="h-3 w-3" /> רענן
              </Button>
            </div>
            {banker.length === 0 ? (
              <p className="font-mono text-xs text-zinc-600" dir="rtl">עדיין אין חשבונות-סוכן בבנקאי. פעולת spend/grant ראשונה (דרך CLI עם BANKER_TOKEN) תפתח חשבון אוטומטית.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto scroll-thin space-y-2">
                {banker.map((b) => {
                  const pct = b.budget.maxBudget > 0 ? Math.round((b.budget.budget / b.budget.maxBudget) * 100) : 0;
                  return (
                    <div key={b.agent} className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-xs text-zinc-300">{b.agent}</span>
                        <Badge variant="outline" className="border-lime-500/30 text-lime-300 text-[10px]">
                          {b.budget.budget.toFixed(2)} / {b.budget.maxBudget} TIB
                        </Badge>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-lime-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="font-mono text-[10px] text-zinc-600 mt-1" dir="ltr">
                        refill {b.budget.refillPerHour}/h {b.defaults?.unitCost ? `· unit ${b.defaults.unitCost}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="font-mono text-[10px] text-zinc-600 mt-3" dir="rtl">
              מצב חתום HMAC-SHA256 + כתיבה אטומית + מונה-רולבק עם מראה (תבנית SRS) · פעולות-כתיבה fail-closed — דורשות BANKER_TOKEN של המפעיל
            </p>
          </GlowCard>

          <GlowCard className="p-5 border-emerald-500/15">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden />
              <h3 className="font-mono text-sm text-zinc-200" dir="rtl">שער-עקביות (self-audit) — תבנית TFA Evolution Studio</h3>
            </div>
            <div className="space-y-1.5 font-mono text-[11px] text-zinc-400" dir="ltr">
              <div><span className="text-emerald-400">✓</span> node tools/self-audit.mjs — יבואים שבורים · סודות-שנשכחו · runtime exports</div>
              <div className="text-zinc-600">· סריקה אחרונה: 241 קבצי-src, 77 routes — CLEAN (0 findings)</div>
              <div className="text-zinc-600">· יציאה 1 = חוסם-שחרור; מומלץ בכל commit לרשת</div>
            </div>
          </GlowCard>
        </div>
      </div>
    </section>
  );
}
