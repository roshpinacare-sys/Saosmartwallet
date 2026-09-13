"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Boxes, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2, Play, RefreshCw,
  Save, ScanSearch, Search, ShieldAlert, ShieldCheck, XCircle,
} from "lucide-react";
import {
  apiJson, copyText, FilterChip, GlowCard, LiveDot, rise, Scramble, SectionHead,
} from "@/components/console/kit";
import type { DrillResult, Inventory, KeyBatchResult, KeyReport } from "@/components/console/types";

/* r40: friendly kind labels for the intake reports (raw kinds stay in the payload) */
const KIND_LABEL: Record<string, string> = {
  "steem-wif": "WIF",
  "evm-key": "EVM",
  "hex-priv": "HEX",
  "mnemonic": "מנשק",
  "github-pat": "PAT",
  "nvidia-api": "NVIDIA",
  "admin-token": "ADMIN",
  "unknown": "לא-מזוהה",
};

export function VaultGrid() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chain, setChain] = useState<string>("*");

  // r34 bug-hunt: mount loads the INSTANT snapshot (last-known status, no chain
  // calls); the full live sweep runs only when the operator presses "אמת-חי"
  // (?verify=1 — the sweep verifies all secrets against the chains and used to
  // block the whole grid for minutes). `verifying` marks the heavy pass.
  const [verifying, setVerifying] = useState(false);
  const load = useCallback(async (verify = false) => {
    if (verify) setVerifying(true);
    try {
      const i = await apiJson<Inventory>(verify ? "/api/gate/inventory?verify=1" : "/api/gate/inventory");
      setInv(i);
      if (verify) toast.success("אימות-חי הושלם — המצב עודכן מהשרשרות");
    } catch {
      if (verify) toast.error("האימות-החי נכשל — נסה שוב");
    } finally {
      setLoading(false);
      setVerifying(false);
    }
  }, []);
  useEffect(() => { void load(false); }, [load]);
  const refresh = useCallback((verify = true) => { setLoading(true); return load(verify); }, [load]);

  async function reveal(id: string) {
    if (revealed[id]) { setRevealed((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    setRevealing(id);
    try {
      const r = await apiJson<{ ok: boolean; priv?: string; error?: string }>("/api/gate/reveal", {
        method: "POST", body: JSON.stringify({ id }),
      });
      if (r?.ok && r.priv) setRevealed((s) => ({ ...s, [id]: r.priv as string }));
      else toast.error(r?.error || "הפענוח נכשל");
    } finally { setRevealing(null); }
  }

  const entries = inv?.entries || [];
  // r11 — rewards-level control truth, computed live from the sweep, not a claim:
  // a soldier's steem-key row counts as "steem-controlled" only when the live
  // authorities contain it ON STEEM. Rows live on hive/blurt but rotated off
  // steem surface in the custody banner below.
  const controlMatrix = useMemo(() => {
    const soldiers = ["cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq","ynet"];
    const rows = soldiers.map((name) => {
      const steemRows = entries.filter((e) => e.kind === "steem-key" && e.account === name);
      const onSteem = steemRows.some((e) => (e.chains || []).includes("steem") && e.liveOk === true);
      const rails = new Set(steemRows.flatMap((e) => e.chains || []));
      return { name, onSteem, rails: [...rails] };
    });
    return rows;
  }, [entries]);
  const steemOrphans = controlMatrix.filter((r) => !r.onSteem);
  const chainsList = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => [(e.chain || e.kind), ...(e.chains || [])]))).sort(),
    [entries],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      // r10: a graphene key rules multiple rails — filter matches the stored
      // label AND every rail the live sweep proved authority on
      if (chain !== "*" && (e.chain || e.kind) !== chain && !(e.chains || []).includes(chain)) return false;
      if (!needle) return true;
      return [e.account, e.role, e.kind, e.chain, e.pub, ...(e.chains || [])].some((f) => (f || "").toLowerCase().includes(needle));
    });
  }, [entries, q, chain]);

  return (
    <section className="py-14">
      <SectionHead num="02" title="הכספת — כל המפתחות" sub="לוחצים 'פענח' והמפתח הפרטי מתגלה כאן, מוצפן-עד-הרגע הזה. הזרקת-מפתח מעל — זיהוי-חי לפני שמירה." />

      <KeyInjectCard />

      <motion.div {...rise} className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" aria-hidden />
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש: חשבון / תפקיד / מפתח-ציבורי…"
            className="pr-9 bg-zinc-950/80 border-zinc-800"
            aria-label="חיפוש בכספת"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh(true)} className="gap-1.5 border-zinc-800 shrink-0">
          <RefreshCw className={"h-3.5 w-3.5" + (verifying ? " animate-spin" : "")} /> אמת-חי
        </Button>
      </motion.div>

      <motion.div {...rise} className="flex flex-wrap gap-2 mb-5">
        <FilterChip active={chain === "*"} onClick={() => setChain("*")} label={`הכול (${entries.length})`} />
        {chainsList.map((c) => (
          <FilterChip key={c} active={chain === c} onClick={() => setChain(c)} label={`${c} (${entries.filter((e) => (e.chain || e.kind) === c || (e.chains || []).includes(c)).length})`} />
        ))}
      </motion.div>

      {steemOrphans.length > 0 && (
        <motion.div {...rise} className="mb-5">
          <GlowCard className="p-4 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" aria-hidden />
              <div className="text-sm leading-relaxed">
                <p className="font-semibold text-amber-300">שליטת-הרשת — האמת החיה ({controlMatrix.length} נבדקו on-chain)</p>
                <p className="text-zinc-400 mt-1">
                  <b className="text-emerald-400">r19 — האמת המדודה (chain-proven, חי-מה-API):</b>{" "}
                  {(() => {
                    // gap-54 doctrine: the banner describes the era the CHAIN is in —
                    // computed live from rotationStatus's rotated flags, never a stored era
                    const rot = inv?.rotation;
                    const rotatedCount = rot?.rotatedCount ?? rot?.targets.filter((t) => t.rotated).length ?? 0;
                    if (rotatedCount >= 11) return (
                      <>
                        הצי מאוחד על שורש-אחד: <b className="text-lime-300">11/11 חשבונות-steem נושאים שורשי-D1 בכל-ארבעת-ה-authorities</b> (owner+active+posting+memo — רוטציה מאושרת-שרשרת, double-proven מצומת-עצמאי); ועל hive ו-blurt השורש זהה מאז-r12.
                        <b className="text-amber-300"> החריג היחיד: ynet@steem</b> — המפתחות-החיים שלו (FULL-4 מ-09-04) אצל המפעיל.
                      </>
                    );
                    if (rotatedCount > 0) return (
                      <>מעבר-עידנים בעיצומו: <b className="text-lime-300">{rotatedCount}/11</b> מאוחדים-על-D1, היתר עוד-על-גזירת-ROT1 — האמת-החיה מהשרשרת, לא-זיכרון.</>
                    );
                    return <>הצי על steem תחת גזירת-ROT1 (עידן-r17) — הרוטציה-ל-D1 טרם-בוצעה.</>;
                  })()}
                </p>
                <p className="text-zinc-400 mt-1">
                  דלתות-פרסום חוץ-מיושנות (steemauto, שירות צד-שלישי 2017) נמדדו חי: על steem — רק ynet (חסות-מפעיל); על hive — 9 חשבונות: {(() => {
                    const s = inv?.steemautoProposal;
                    if (!s) return <span className="text-zinc-400">אין כרגע הצעה פתוחה לסגירתן.</span>;
                    if (s.status === "pending") return <span className="text-amber-300">המשאבים (HP/RC) חסרים בחשבונות-היעד — השרשרת עצמה דוחה (r19, מדוד): נדרשת הזרמת-משאבים ואז הפעלה-חוזרת של הסגירה (הכלי מוכן, fail-closed).</span>;
                    if (s.status === "launched") {
                      // gap-57 — the claim follows the RUN's real state, not the proposal's optimism
                      if (s.runStatus === "queued" || s.runStatus === "running") return <span className="text-emerald-300">הריצה לסגירתן חיה כרגע.</span>;
                      if (s.runStatus === "done") return <span className="text-emerald-300">הריצה הסתיימה — הדלתות נסגרו.</span>;
                      if (s.runStatus === "blocked" || s.runStatus === "failed") return <span className="text-rose-300">הריצה נעצרה כנה — הכלים קיימים (r19); החסם-הנוכחי: משאבי-RC בחשבונות-היעד (נדרשת הזרמה).</span>;
                      return <span className="text-emerald-300">הריצה הוזנקה על-ידי המפעיל.</span>;
                    }
                    if (s.status === "adopted") return <span className="text-lime-300">ההצעה אומצה כסיור-קבוע.</span>;
                    if (s.status === "rejected") return <span className="text-zinc-400">הוצא מסדר-היום בהוראת-המפעיל (r20) — לא על סדר-היום יותר; הדלתות נשארות מתועדות-מדוד (hive: חסומות-כלכלה RC · steem: חסות-מפעיל).</span>;
                    return <span className="text-zinc-400">ההצעה פגתה במדיניות — דורשת הגשה-מחדש.</span>;
                  })()}
                  {(() => {
                    // r19 — the rotation plane reports its state live (the era is decided)
                    const rot = inv?.rotation;
                    if (!rot) return null;
                    const rotatedCount = rot.rotatedCount ?? rot.targets.filter((t) => t.rotated).length;
                    return (
                      <span className="block mt-1">
                        <b className="text-lime-300">מישור-רוטציית account_update (רק-מפעיל):</b> הרוטציה לשורשי-D1 <b className="text-lime-300">בוצעה ואומתה-שרשרת ({rotatedCount}/11)</b> — המפתחות-החיים הם עכשיו שורשי-D1 הנאטמים; אין-צורך ברוטציה-נוספת. ה-ROT1 ומפתחות-2018 מוגדרים rotated-out (היסטוריה-אטומה, נשמרת).
                      </span>
                    );
                  })()}
                  {(() => {
                    // r20 — the anchor line is LIVE: per-rail chain-verified anchors
                    // from /api/gate/inventory (get_transaction → get_block scan),
                    // never a stored era. gap-54 doctrine applies here too.
                    const an = inv?.anchors ?? [];
                    if (!an.length) return (
                      <span className="text-zinc-400">עוגני-האמת על-השרשרת: אין עוגנים מדודים כרגע — האמת תחושב כשהמדידה תרוץ.</span>
                    );
                    const digests = [...new Set(an.flatMap((a) => (a.digest ? [a.digest] : [])))];
                    const unity = an.filter((a) => a.onChain).length >= 2 && digests.length === 1;
                    return (
                      <span className="block mt-1">
                        עוגני-האמת על-השרשרת ({an.length} מסילות, אמת-חי):
                        {an.map((a) => (
                          <span key={a.chain} className="font-mono text-[11px] text-emerald-300/90" dir="ltr">{" "}{a.chain}{a.onChain ? " ✓" : " ?"} · blk {a.blockNum ?? "—"} · {a.txId.slice(0, 10)}…{a.round ? ` · ${a.round}` : ""} ·</span>
                        ))}
                        {digests.length === 1 && <span className="font-mono text-[11px] text-lime-300" dir="ltr">{" "}digest {digests[0].slice(0, 16)}…</span>}
                        {unity && <b className="text-lime-300"> · אחדות-עוגן רבת-מסילה ✓ (דיגסט אחד, שרשרות עצמאיות)</b>}
                        {!an.some((a) => a.chain === "hive") && <span className="text-zinc-500"> · hive: חסום-כלכלה RC (מדוד-חי) — ממתין להזרמת-HP</span>}
                      </span>
                    );
                  })()}
                </p>
              </div>
            </div>
          </GlowCard>
        </motion.div>
      )}

      <RotationPanel inv={inv} onDone={() => refresh()} />

      {inv?.mode === "snapshot" && (
        <motion.div {...rise} className="mb-5">
          <GlowCard className="p-3 flex items-center gap-2.5 border-zinc-800 bg-zinc-900/40">
            <ScanSearch className="h-4 w-4 text-zinc-500 shrink-0" aria-hidden />
            <p className="text-xs text-zinc-400 leading-relaxed">
              מוצג <b className="text-zinc-300">מצב-אחרון-ידוע</b> מהכספת ({entries.length} רשומות{inv.lastVerifiedAt ? ` · אימות-מלא אחרון: ${new Date(inv.lastVerifiedAt).toLocaleString("he-IL")}` : ""}) — בלי סריקת-שרשראות.
              לחץ <b className="text-emerald-400">אמת-חי</b> לאימות-מלא מול השרשרות.
            </p>
          </GlowCard>
        </motion.div>
      )}

            {loading && entries.length === 0 ? (
        <GlowCard className="p-12 flex items-center justify-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {verifying ? "מאמת את הסודות מול השרשרות…" : "טוען את הכספת…"}
        </GlowCard>
      ) : (
        <motion.div {...rise}>
          <GlowCard className="divide-y divide-zinc-800/60 max-h-[560px] overflow-y-auto scroll-thin">
            {filtered.map((e) => {
              const priv = revealed[e.id];
              return (
                <div key={e.id} className="px-4 py-3.5 transition-colors hover:bg-zinc-900/40">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <Badge variant="secondary" className="font-mono text-[10px] bg-zinc-800/80 text-amber-300/90 border border-amber-500/20">{e.chain || e.kind}</Badge>
                    {(e.chains || []).filter((c) => c !== (e.chain || e.kind)).map((c) => (
                      <Badge key={c} variant="secondary" className="font-mono text-[10px] bg-emerald-500/10 text-emerald-300/90 border border-emerald-500/20">+{c}</Badge>
                    ))}
                    <span className="font-mono text-sm font-bold">{e.account || "—"}</span>
                    {e.role && <span className="font-mono text-[10px] text-zinc-500">@{e.role}</span>}
                    <LiveDot ok={e.liveOk} />
                    <div className="mr-auto flex items-center gap-1.5">
                      {e.pub && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500" title="העתק מפתח-ציבורי" onClick={() => copyText(e.pub!, "מפתח-ציבורי")}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="outline" size="sm"
                        className="gap-1.5 h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 font-mono text-xs"
                        onClick={() => reveal(e.id)} disabled={revealing === e.id}
                      >
                        {revealing === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : priv ? <><EyeOff className="h-3.5 w-3.5" /> הסתר</>
                          : <><Eye className="h-3.5 w-3.5" /> פענח</>}
                      </Button>
                    </div>
                  </div>
                  {e.pub && !priv && <p className="mt-1.5 font-mono text-[10px] text-zinc-600 truncate" dir="ltr">{e.pub}</p>}
                  <AnimatePresence>
                    {priv && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2.5" dir="ltr">
                          <Scramble text={priv} className="flex-1 font-mono text-xs break-all whitespace-pre-wrap text-amber-200 leading-relaxed" />
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-amber-300" onClick={() => copyText(priv, "מפתח פרטי")}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="text-center text-zinc-500 text-sm py-10">אין התאמות</p>}
          </GlowCard>
        </motion.div>
      )}
      <RestoreDrillCard />
    </section>
  );
}

/* ══════════════════════════ key injection — r38 gap fix ══════════════════════════
   היה רכיב-מלא שמעולם לא רונדר (קוד-מת: KeyInject הוגדר ולא נקרא אף-פעם ב-Page).
   עתה: כרטיס-קומפקטי בראש-סעיף-הכספת — מזהה חי כל מפתח ושומר מוצפן. */

function KeyInjectCard() {
  const [keyInput, setKeyInput] = useState("");
  const [saveIt, setSaveIt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<KeyReport | null>(null);
  // r39 — bulk intake: the ready door for the NEXT batch of keys (text block or zip archive)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [zipUrl, setZipUrl] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [batch, setBatch] = useState<KeyBatchResult | null>(null);
  const [take, setTake] = useState<Set<string>>(new Set());

  async function run() {
    if (!keyInput.trim()) return;
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; report?: KeyReport; saved?: { id: string }[]; error?: string }>("/api/gate/key", {
        method: "POST", body: JSON.stringify({ key: keyInput.trim(), save: saveIt }),
      });
      if (r?.ok) {
        setReport(r.report || null);
        setKeyInput("");
        toast.success(saveIt && r.saved?.length ? `נשמר מוצפן בכספת (${r.saved.length})` : "זוהה חי — דוח מוצג");
      } else toast.error(r?.error || "הזיהוי נכשל");
    } finally { setBusy(false); }
  }

  async function bulkScan() {
    if (!bulkText.trim() && !zipUrl.trim()) return;
    setBulkBusy(true);
    try {
      const r = await apiJson<KeyBatchResult>("/api/gate/keys-batch", {
        method: "POST", body: JSON.stringify({ mode: "scan", text: bulkText || undefined, zipUrl: zipUrl.trim() || undefined }),
      });
      if (r?.ok) {
        setBatch(r);
        const fresh = new Set<string>();
        for (const it of r.items || []) if (!it.dupOf) fresh.add(it.hash);
        setTake(fresh); // pre-select the non-duplicates — the operator unchecks what they don't want
        toast.success(r.found ? `סרוק: ${r.found} מועמדים (כלום לא נאטם עדיין)` : "לא נמצאו מועמדים שנראים כמפתחות");
      } else if (r?.code === "vault-locked") toast.error("הכספת נעולה — פתח אותה כדי לאטום");
      else toast.error(r?.error || "הסריקה נכשלה");
    } finally { setBulkBusy(false); }
  }

  async function bulkSeal() {
    if (!take.size) return;
    setBulkBusy(true);
    try {
      const r = await apiJson<KeyBatchResult>("/api/gate/keys-batch", {
        method: "POST", body: JSON.stringify({ mode: "seal", text: bulkText || undefined, zipUrl: zipUrl.trim() || undefined, take: [...take] }),
      });
      if (r?.ok) {
        toast.success(r.created ? `${r.created} מפתחות נאטמו מוצפנים בכספת` : "לא נאטם כלום (כפילויות או אישורים ריקים)");
        setBatch(r);
        setBulkText("");
      } else toast.error(r?.error || "האטימה נכשלה");
    } finally { setBulkBusy(false); }
  }

  return (
    <motion.div {...rise} className="mb-6">
      <GlowCard className="p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <KeyRound className="h-4 w-4 text-emerald-400" aria-hidden />
          <h3 className="font-bold text-sm">הזרקת מפתח — זיהוי-חי ושמירה מוצפנת</h3>
          <span className="text-[10px] text-zinc-600">מזהה WIF / hex / מנשק / PAT מול השרשרות — לפני שהוא נוגע בכספת</span>
        </div>
        <div className="flex flex-col md:flex-row gap-3 mt-3">
          <div className="relative flex-1">
            <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" aria-hidden />
            <Input
              value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
              placeholder="WIF / hex / מנשק / PAT — הדבק כאן"
              className="pr-9 font-mono text-sm bg-zinc-950/80 border-zinc-800" dir="ltr"
              autoComplete="off" spellCheck={false}
              aria-label="מפתח לזיהוי"
            />
          </div>
          <Button onClick={run} disabled={busy || !keyInput.trim()} className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saveIt ? "זהה ושמור" : "זהה חי"}
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2.5 text-xs text-zinc-400 cursor-pointer">
            <Switch checked={saveIt} onCheckedChange={setSaveIt} aria-label="שמירה מוצפנת בכספת" />
            שמור מוצפן בכספת (בלי זה — רק דוח-זיהוי)
          </label>
          <button type="button" onClick={() => setBulkOpen((v) => !v)} className="text-xs text-emerald-300/90 hover:text-emerald-200 flex items-center gap-1.5" aria-expanded={bulkOpen}>
            <Boxes className="h-3.5 w-3.5" /> יבוא-מרובה (טקסט / zip) — מוכן לגל של מפתחות {bulkOpen ? "▲" : "▼"}
          </button>
        </div>
        <AnimatePresence>
          {bulkOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-black/30 p-3.5 space-y-2.5">
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  הדבק גוש מפתחות (שורה = מפתח: WIF / 0x-hex / 64-hex / מנשק / ghp_ PAT) ו/או כתובת zip (למשל ארכיון-מפתחות בגיט).
                  סריקה מזהה כל מועמד מול השרשרות, מוציאה כפילויות מול הכספת — וכלום לא נאטם עד שאתה מאשר. אפס-סודות בפלט.
                </p>
                <Textarea
                  value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"5K… (WIF)\n0x… (מפתח EVM)\nשתים-עשרה עד עשרים-וארבע מילים… (מנשק)"}
                  className="min-h-[88px] font-mono text-xs bg-zinc-950/80 border-zinc-800" dir="ltr" spellCheck={false}
                  aria-label="גוש מפתחות ליבוא-מרובה"
                />
                <Input
                  value={zipUrl} onChange={(e) => setZipUrl(e.target.value)}
                  placeholder="https://…/keys-backup.zip (אופציונלי — נסרק בזיכרון, עד 64MB)"
                  className="font-mono text-xs bg-zinc-950/80 border-zinc-800" dir="ltr" spellCheck={false}
                  aria-label="כתובת ארכיון-zip"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={bulkScan} disabled={bulkBusy || (!bulkText.trim() && !zipUrl.trim())} className="gap-1.5 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                    {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />} סרוק חי
                  </Button>
                  {batch?.mode === "scan" && batch.items && (
                    <Button size="sm" onClick={bulkSeal} disabled={bulkBusy || !take.size} className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-black font-bold">
                      <Save className="h-3.5 w-3.5" /> אטום נבחרים ({take.size})
                    </Button>
                  )}
                  {batch?.note && <span className="text-[10px] text-zinc-500">{batch.note}</span>}
                </div>
                {batch?.items && batch.items.length > 0 && (
                  <div className="max-h-52 overflow-y-auto scroll-thin space-y-1.5 pl-1">
                    {batch.items.map((it) => (
                      <div key={it.hash} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 flex items-start gap-2 flex-wrap">
                        {!it.dupOf ? (
                          <input
                            type="checkbox" checked={take.has(it.hash)}
                            onChange={() => setTake((s) => { const n = new Set(s); if (n.has(it.hash)) n.delete(it.hash); else n.add(it.hash); return n; })}
                            className="mt-0.5 accent-emerald-500" aria-label={`אישור אטימה עבור ${it.preview}`}
                          />
                        ) : <span className="text-[10px] text-zinc-600 w-4 text-center" title={`כפילות של ${it.dupOf}`}>=</span>}
                        <span className="font-mono text-[10px] text-zinc-400" dir="ltr">{it.preview}</span>
                        <Badge variant="outline" className="text-[9px] font-mono text-zinc-400 border-zinc-700" dir="ltr">{KIND_LABEL[it.kind] ?? it.kind}</Badge>
                        {it.liveChecked && it.controls.length > 0 && <Badge variant="outline" className="text-[9px] text-emerald-300 border-emerald-500/40">חי ✓</Badge>}
                        {it.liveChecked && it.controls.length === 0 && <Badge variant="outline" className="text-[9px] text-rose-300 border-rose-500/40">נדחה ✗</Badge>}
                        {!it.liveChecked && it.notes.length > 0 && <Badge variant="outline" className="text-[9px] text-amber-300 border-amber-500/40">לא-הוכרע</Badge>}
                        {it.controls.slice(0, 2).map((c, i) => (
                          <Badge key={i} variant="outline" className="text-[9px] font-mono text-sky-300 border-sky-500/40" dir="ltr">{c.chain}{c.account ? `·${c.account}` : ""}@{c.role}</Badge>
                        ))}
                        {it.dupOf && <span className="text-[9px] text-zinc-600">כבר בכספת ({it.dupOf})</span>}
                        <span className="text-[9px] text-zinc-700 mr-auto font-mono" dir="ltr">{it.from}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {report && (
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs space-y-2"
            >
              <p><span className="text-zinc-500">סוג:</span> <span className="font-mono text-emerald-400 font-bold">{KIND_LABEL[report.kind] ?? report.kind}</span>
                <span className="text-zinc-600"> · אימות-חי: {report.liveChecked ? "כן ✓" : "לא"}{report.liveChecked && report.controls.length === 0 ? " (המפתח נדחה/לא-שולט — ראה הערות)" : ""}</span></p>
              {report.label && <p className="text-zinc-400">{report.label}</p>}
              {(report.notes?.length ?? 0) > 0 && (
                <ul className="text-[11px] text-zinc-500 space-y-0.5">
                  {report.notes?.map((n, i) => <li key={i}>· {n}</li>)}
                </ul>
              )}
              {report.controls.length > 0 && (
                <p className="break-all leading-relaxed">
                  <span className="text-zinc-500">שליטה נוכחית:</span>{" "}
                  {report.controls.map((ctrl, i) => (
                    <Badge key={i} variant="outline" className="font-mono text-[10px] border-emerald-500/30 text-emerald-300 ml-1.5">
                      {ctrl.chain}{ctrl.account ? `·${ctrl.account}` : ""}@{ctrl.role}
                    </Badge>
                  ))}
                </p>
              )}
              {report.pubs.length > 0 && <p className="font-mono text-[10px] text-zinc-600 break-all" dir="ltr">pub: {report.pubs[0]}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </GlowCard>
    </motion.div>
  );
}

function RestoreDrillCard() {
  const [last, setLast] = useState<DrillResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; last: DrillResult | null }>("/api/gate/restore-drill");
    if (r?.ok) setLast(r.last);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      // POST returns the drill result spread onto {ok:true,...} (the ok() helper shape)
      const r = await apiJson<DrillResult & { ok: boolean; error?: string; code?: string }>("/api/gate/restore-drill", { method: "POST" });
      if (r?.ok && r?.verdict) {
        setLast(r);
        if (r.verdict === "pass") toast.success(`תרגיל-שחזור עבר — ${r.restored}/${r.total} סודות נפתחו בפועל`);
        else toast.error(`תרגיל-שחזור נכשל — ${r.failed} הצפנות לא נפתחו`);
      } else if (r?.code === "vault-locked") toast.error("הכספת נעולה — היכנס כדי להדליק את מפתח-האב");
      else toast.error(r?.error || "התרגיל נכשל");
    } finally { setBusy(false); }
  }

  return (
    <motion.div {...rise} className="mt-5">
      <GlowCard className="p-4 sm:p-5 border-emerald-500/15">
        <div className="flex items-start gap-3 flex-wrap">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-[240px]">
            <p className="font-bold text-sm">תרגיל-שחזור — ההוכחה-העומדת שהכספת משיבה את כל המפתחות</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              התרגיל פותח בפועל את כל ההצפנות מול מפתח-האב וסופר מה באמת נפתח · אפס-סודות בפלט — ספירה, תווית ופסק בלבד.
            </p>
            {last && (
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                <Badge variant="outline" className={last.verdict === "pass" ? "text-emerald-300 border-emerald-500/40" : "text-rose-300 border-rose-500/40"}>
                  {last.verdict === "pass" ? "עבר" : "נכשל"}
                </Badge>
                <Badge variant="outline" className="text-zinc-300 border-zinc-700">{last.restored}/{last.total} נפתחו</Badge>
                {last.placeholders ? <Badge variant="outline" className="text-zinc-400 border-zinc-700">{last.placeholders} פנויות</Badge> : null}
                {last.failed > 0 && <Badge variant="outline" className="text-rose-300 border-rose-500/40">{last.failed} כשלים</Badge>}
                {last.seals?.operatorPrimary && <Badge variant="outline" className="text-emerald-300 border-emerald-500/40">חותמת-מפעיל ראשית</Badge>}
                <span className="text-zinc-600 font-mono">{new Date(last.at).toLocaleString("he-IL")}</span>
              </div>
            )}
            {last?.meaning && <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">{last.meaning}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={run} disabled={busy} className="gap-1.5 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 shrink-0">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} הרץ תרגיל עכשיו
          </Button>
        </div>
      </GlowCard>
    </motion.div>
  );
}

/* ═════════════════ r16 — SOVEREIGN ROTATION PANEL (gap-58) ═════════════════
   "לחבר את כולם": the operator pastes each account's current owner key →
   live-verified against the chain in the same call → sealed → and rotation
   (account_update) sets all four steem authorities to the D1 roots the vault
   already holds (unified with hive+blurt). Operator-only plane — agents have
   no path here. Every verdict is the chain's answer, never an assumption. */
function RotationPanel({ inv, onDone }: { inv: Inventory | null; onDone: () => void }) {
  const rot = inv?.rotation || null;
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Array<{ account: string; ok: boolean; detail: string }> | null>(null);
  const [rotated, setRotated] = useState<Record<string, { txId: string; verified: boolean; detail: string }>>({});
  const targets = rot?.targets || [];

  const doImport = async () => {
    const items = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = /^([a-z0-9.\-]+)[=:\s]+(\S+)$/i.exec(line);
      return m ? { account: m[1].toLowerCase(), wif: m[2] } : null;
    }).filter(Boolean) as Array<{ account: string; wif: string }>;
    if (!items.length) { toast.error("הדבק שורות בפורמט: חשבון=מפתח-owner"); return; }
    setBusy("import");
    try {
      const res = await apiJson<{ ok: boolean; verdicts: Array<{ account: string; ok: boolean; detail: string }>; sealed: number }>(
        "/api/gate/rotation",
        { method: "POST", body: JSON.stringify({ action: "import", items }) },
      );
      if (res?.ok) {
        setVerdicts(res.verdicts || []);
        toast.success(`ייבוא הושלם — ${res.sealed || 0} מפתחות נאטמו (כל אימות מול השרשרת)`);
        onDone();
      } else toast.error("הייבוא נכשל — בדוק את ההרשאות");
    } catch { toast.error("שגיאת רשת בייבוא"); }
    setBusy(null);
  };

  const doRotate = async (account: string) => {
    if (!window.confirm(`לחתום ולשדר account_update עבור ${account}? כל ארבעת ה-authorities יוצבו לשורשי-D1 (account_auths נשמרים). זו פעולת-שרשרת שלא ניתן לבטל.`)) return;
    setBusy(account);
    try {
      const res = await apiJson<{ ok: boolean; txId?: string; verified?: boolean; detail?: string; error?: string }>(
        "/api/gate/rotation",
        { method: "POST", body: JSON.stringify({ action: "rotate", account }) },
      );
      if (res?.ok && res.txId) {
        setRotated((s) => ({ ...s, [account]: { txId: res.txId || "", verified: Boolean(res.verified), detail: res.detail || "" } }));
        toast.success(res.verified ? `${account}: אומת live — כל ארבעת ה-authorities נושאים את שורשי-D1` : `${account}: שודר (${(res.txId || "").slice(0, 12)}…) — האימות-חי יושלם בסריקה`);
        onDone();
      } else toast.error(res?.error || `הרוטציה של ${account} נכשלה`);
    } catch { toast.error(`שגיאת רשת ברוטציה של ${account}`); }
    setBusy(null);
  };

  if (!rot) return null;
  return (
    <motion.div {...rise} className="mb-5">
      <GlowCard className="p-4 border-lime-500/30 bg-lime-500/5">
        <div className="flex items-start gap-3">
          <KeyRound className="h-5 w-5 text-lime-400 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm leading-relaxed w-full">
            <p className="font-semibold text-lime-300">חיבור-steem — מישור הרוטציה הריבוני (רק-מפעיל)</p>
            <p className="text-zinc-400 mt-1">
              הכספת חותמת רק כאן, בהחלטה-מפורשת שלך. שורשי-D1 כבר נאטמו והוכחו חי על hive+blurt — הרוטציה מאחדת את steem על אותו שורש.
              חשבונות-מוכנים: <b className="text-lime-300">{rot.readyCount}/{targets.length}</b>.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-40 overflow-y-auto scroll-thin">
              {targets.map((t) => (
                <div key={t.account} className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md bg-zinc-950/60 border border-zinc-800/80">
                  <span className="font-mono text-zinc-300">{t.account}</span>
                  <span className={"text-[10px] " + (t.hasOwnerKey ? "text-emerald-400" : "text-zinc-600")}>owner{t.hasOwnerKey ? "✓" : "✗"}</span>
                  <span className={"text-[10px] " + (t.hasP5Root ? "text-emerald-400" : "text-zinc-600")}>P5{t.hasP5Root ? "✓" : "✗"}</span>
                  {rotated[t.account] ? (
                    <span className={"text-[10px] ml-auto " + (rotated[t.account].verified ? "text-emerald-300" : "text-amber-300")}>
                      {rotated[t.account].verified ? "אומת" : "שודר"}
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!t.ready || busy !== null} onClick={() => doRotate(t.account)}
                      className="ml-auto h-6 px-2 text-[10px] border-lime-500/40 text-lime-300 hover:bg-lime-500/10">
                      {busy === t.account ? <Loader2 className="h-3 w-3 animate-spin" /> : "התחל רוטציה"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} dir="ltr"
                placeholder={"cashmachine=5J...…\nharan=5K...…  (owner WIF per line — verified live before sealing)"}
                className="bg-zinc-950/80 border-zinc-800 font-mono text-[11px]" aria-label="הדבקת מפתחי-owner" />
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" variant="outline" disabled={busy !== null || !paste.trim()} onClick={doImport}
                  className="gap-1.5 border-lime-500/40 text-lime-300 hover:bg-lime-500/10">
                  {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  אמת-חי ואטום
                </Button>
                <span className="text-[11px] text-zinc-500">מפתח שאינו ב-authority ה-owner החי — נדחה ולא נאטם (fail-closed).</span>
              </div>
            </div>
            {verdicts && (
              <div className="mt-3 max-h-36 overflow-y-auto scroll-thin divide-y divide-zinc-800/60 border border-zinc-800/60 rounded-md">
                {verdicts.map((v, i) => (
                  <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-[12px]">
                    {v.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />}
                    <span className="font-mono text-zinc-300">{v.account}</span>
                    <span className={v.ok ? "text-zinc-400" : "text-rose-300/90"}>{v.detail}</span>
                  </div>
                ))}
              </div>
            )}
            {Object.values(rotated).length > 0 && (
              <div className="mt-3 space-y-1.5">
                {Object.entries(rotated).map(([acct, r]) => (
                  <div key={acct} className="text-[12px] px-2.5 py-1.5 rounded-md bg-zinc-950/60 border border-zinc-800/80">
                    <span className="font-mono text-zinc-300">{acct}</span>
                    {" — "}tx <span className="font-mono text-[10px] text-emerald-300/90" dir="ltr">{r.txId.slice(0, 18)}…</span>
                    {" · "}<span className={r.verified ? "text-emerald-300" : "text-amber-300"}>{r.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlowCard>
    </motion.div>
  );
}
