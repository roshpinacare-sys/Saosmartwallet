'use client';

// ─── towers — חמשת מגדלי SAOS ──────────────────────────────────────────────
// The Foundry's five towers, live:
//   1. מגדל-פיקוח  — anchor matrix + kernel selftest + sealing pulses
//   2. אנרגיה      — TRON energize math + Hive RC recovery plan
//   3. כלכלה       — harvest streams simulator + flywheel
//   4. הוכחות      — merkle verify-pack (anyone can verify)
//   5. פורץ דרך    — the research verdict over 10 archives

import { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Landmark, Zap, Coins, FileCheck2, Gavel, RefreshCw, Stamp, ShieldCheck, XCircle, CheckCircle2, Loader2, Clock, Anchor, ChevronDown } from 'lucide-react';
import { authHeaders, fmtAgo } from './shared';
import type { SaosStatus } from './shared';

type KernelResult = { ok: boolean; checks: Array<{ name: string; pass: boolean; detail: string }> };
type VerifyPack = { ok: boolean; empty?: boolean; message?: string; seal?: { height: number; root: string; stateRoot: string; createdAt: string }; tree?: { leaves: number; levels: number; root: string }; rootMatches?: boolean; allVerified?: boolean; proofs?: Array<{ index: number; leaf: string; verified: boolean }>; howToVerify?: string };
type TronPlan = { trxStaked: number; dailyEnergy: number; settlementsPerDay: number; uncoveredPerDay: number; burnCostPerTxTrx: number; burnCostPerDayTrx: number; breakEvenTxs: number; txPlan: Array<{ step: string; call: string }> };
type HivePlan = { currentPct: number; lightFloorHours: number; heavyFloorHours: number; verdict: string; path: Array<{ step: string; detail: string; hours: number }> };
type EconomyResult = { streams: Array<{ name: string; he: string; amount: number; note: string }>; totalPerDay: number; reinvestedPerDay: number; retainedPerDay: number; energyFunded: { trx: number; settlements: number }; verdict: string };
type Finding = { archive: string; rank: number; score: number; verdict: string; salvage: string[]; evidence: string[] };
type Research = { ok: boolean; findings: Finding[]; synthesis: { chosen: string; why: string[]; roadmap: string[] } };

const MATRIX_STATE: Record<string, { label: string; cls: string; dot: string }> = {
  anchored: { label: 'עוגן', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  gated: { label: 'סורג', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  transit: { label: 'במעבר', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', dot: 'bg-zinc-400' },
};

function TowerHeader({ icon: Icon, title, sub, accent = 'emerald' }: { icon: React.ComponentType<{ className?: string }>; title: string; sub: string; accent?: 'emerald' | 'amber' | 'zinc' }) {
  const tone = accent === 'amber' ? 'bg-amber-100 text-amber-700' : accent === 'zinc' ? 'bg-zinc-100 text-zinc-600' : 'bg-emerald-100 text-emerald-700';
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-5 h-5" /></span>
      <div>
        <h2 className="text-[16px] font-bold text-zinc-900 leading-tight">{title}</h2>
        <p className="text-[11.5px] text-zinc-500 leading-tight">{sub}</p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, dir = 'rtl', type = 'text' }: { label: string; value: string; onChange: (v: string) => void; dir?: 'rtl' | 'ltr'; type?: string }) {
  return (
    <label className="block">
      <span className="label-caps block mb-1">{label}</span>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} dir={dir} className="h-9 bg-white border-[#e0e0da] font-data text-[12px]" />
    </label>
  );
}

// ─────────────────────────────────────────── tower 1: מגדל-פיקוח ──
function Watchtower({ saos, onSealed }: { saos: SaosStatus | null; onSealed: () => void }) {
  const [kernel, setKernel] = useState<KernelResult | null>(null);
  const [kernelBusy, setKernelBusy] = useState(false);
  const [stamps, setStamps] = useState(6);
  const [sealBusy, setSealBusy] = useState(false);
  const [sealMsg, setSealMsg] = useState<string | null>(null);

  async function runKernel() {
    setKernelBusy(true);
    try { const r = await fetch('/api/saos/kernel', { cache: 'no-store' }); const j = await r.json(); if (j.ok) setKernel(j.result); } catch { /* */ }
    setKernelBusy(false);
  }

  async function doSeal() {
    setSealBusy(true); setSealMsg(null);
    try {
      const r = await fetch('/api/saos/seal', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ stamps }) });
      const j = await r.json();
      setSealMsg(j.ok ? `חותם חדש נרשם — root ${String(j.seal?.root || '').slice(0, 12)}…` : (j.error || 'נכשל'));
      if (j.ok) onSealed();
    } catch { setSealMsg('שגיאת רשת'); }
    setSealBusy(false);
  }

  return (
    <div className="space-y-4">
      {/* anchor matrix */}
      <section className="sv-card p-4">
        <TowerHeader icon={Anchor} title="מטריצת-העגינה" sub="ארבע רשתות — שערים כנים, בלי תיאטרון" />
        <div className="grid gap-2 sm:grid-cols-2">
          {(saos?.matrix || []).map(row => {
            const st = MATRIX_STATE[row.status] || MATRIX_STATE.transit;
            return (
              <div key={row.network} className="sv-well p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-data text-[12px] font-bold text-zinc-900" dir="ltr">{row.network}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 leading-relaxed">{row.detail}</p>
                {row.gate && <p className="font-data text-[9.5px] text-amber-700" dir="ltr">gate: {row.gate}</p>}
                {row.recovery && <p className="text-[10.5px] text-zinc-500 leading-relaxed">{row.recovery}</p>}
              </div>
            );
          })}
          {!saos && <div className="col-span-2 py-4 text-center text-[11px] text-zinc-400">טוען...</div>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* kernel selftest */}
        <section className="sv-card p-4">
          <TowerHeader icon={ShieldCheck} title="בדיקת-עצמי של הגרעין" sub="7 בדיקות-תכונה: דטרמיניזם · GAS · dedupe · שימור-ערך · fail-closed" />
          <button onClick={runKernel} disabled={kernelBusy} className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[12px] font-bold transition-colors inline-flex items-center gap-2">
            {kernelBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {kernelBusy ? 'מריץ...' : 'הרץ selftest'}
          </button>
          {kernel && (
            <div className="mt-3 space-y-1">
              {kernel.checks.map(c => (
                <div key={c.name} className="flex items-center gap-2 rounded-lg border border-[#eeeeea] px-3 py-1.5">
                  {c.pass ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                  <span className="font-data text-[10.5px] font-semibold text-zinc-800 shrink-0" dir="ltr">{c.name}</span>
                  <span className="text-[10.5px] text-zinc-500 truncate" dir="ltr">{c.detail}</span>
                </div>
              ))}
              <div className={`mt-2 rounded-lg px-3 py-2 text-[11.5px] font-semibold ${kernel.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
                {kernel.ok ? 'הגרעין תקין — כל התכונות עוברות' : 'נכשל — בדוק את הבדיקות שלמעלה'}
              </div>
            </div>
          )}
        </section>

        {/* sealing pulse */}
        <section className="sv-card p-4">
          <TowerHeader icon={Stamp} title="פעימת-עגינה" sub="kernel replay → stateRoot → מטריצת Merkle → DB → קבלה משורשרת-האש" />
          <div className="flex items-end gap-2 flex-wrap">
            <div className="w-28"><Field label="חותמות (3–24)" value={String(stamps)} onChange={v => setStamps(Math.min(24, Math.max(3, Number(v) || 3)))} dir="ltr" type="number" /></div>
            <button onClick={doSeal} disabled={sealBusy} className="h-9 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white text-[12px] font-bold transition-colors inline-flex items-center gap-2">
              {sealBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stamp className="w-3.5 h-3.5" />}
              {sealBusy ? 'אוטם...' : 'אטום עכשיו'}
            </button>
          </div>
          {sealMsg && <p className="mt-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{sealMsg}</p>}
          <div className="mt-4 space-y-1.5 max-h-56 overflow-y-auto scroll-slim">
            <div className="label-caps mb-1">חותמות אחרונות ({saos?.seals.length ?? 0})</div>
            {(saos?.seals || []).slice(0, 8).map(s => (
              <div key={s.id} className="rounded-lg border border-[#eeeeea] px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-data text-[10px] text-zinc-800 truncate" dir="ltr" title={s.root}>root {s.root.slice(0, 18)}…</div>
                  <div className="font-data text-[9px] text-zinc-400" dir="ltr">{s.leaves} leaves · gas {s.gasUsed}</div>
                </div>
                <span className="font-data text-[9.5px] text-zinc-400 shrink-0">{fmtAgo(s.createdAt)}</span>
              </div>
            ))}
            {saos && saos.seals.length === 0 && <div className="py-3 text-center text-[11px] text-zinc-400">אין חותמות — אטום את הראשונה</div>}
          </div>
        </section>
      </div>

      {/* historic anchors */}
      {saos && saos.historic.length > 0 && (
        <section className="sv-card p-4">
          <TowerHeader icon={Landmark} title="עוגנים היסטוריים בשרשרת" sub="רפרנסים חיים — ניתנים לאימות בהיסטוריית הרשתות" />
          <div className="grid gap-2 sm:grid-cols-2">
            {saos.historic.map((h, i) => (
              <div key={i} className="sv-well px-3 py-2.5 flex items-center justify-between gap-2">
                <span className="font-data text-[11px] font-bold text-zinc-800" dir="ltr">{h.network}</span>
                <span className="font-data text-[10px] text-zinc-500 truncate flex-1 text-center" dir="ltr" title={h.txRef}>{h.txRef}</span>
                <span className="text-[10px] font-semibold text-emerald-700 shrink-0">{h.state}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────── tower 2: אנרגיה ──
function EnergyTower() {
  const [trx, setTrx] = useState('6500');
  const [txs, setTxs] = useState('4');
  const [rc, setRc] = useState('0.6');
  const [tron, setTron] = useState<TronPlan | null>(null);
  const [hive, setHive] = useState<HivePlan | null>(null);
  const [busy, setBusy] = useState(false);

  const runTron = useCallback(async () => {
    setBusy(true);
    try { const r = await fetch(`/api/saos/energy?net=tron&trx=${Number(trx) || 0}&txs=${Number(txs) || 0}`, { cache: 'no-store' }); const j = await r.json(); if (j.ok) setTron(j.plan); } catch { /* */ }
    setBusy(false);
  }, [trx, txs]);

  const runHive = useCallback(async () => {
    try { const r = await fetch(`/api/saos/energy?net=hive&rc=${Number(rc) || 0}`, { cache: 'no-store' }); const j = await r.json(); if (j.ok) setHive(j.plan); } catch { /* */ }
  }, [rc]);

  useEffect(() => { const t = setTimeout(() => { runTron(); runHive(); }, 0); return () => clearTimeout(t); }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* TRON energize */}
      <section className="sv-card p-4">
        <TowerHeader icon={Zap} title="מחשבון TRON energize" sub="freezeBalanceV2 + delegateResource — החתיכה שחסרה בכל הארכיון" />
        <div className="flex items-end gap-2 flex-wrap">
          <div className="w-32"><Field label="TRX להימור" value={trx} onChange={setTrx} dir="ltr" type="number" /></div>
          <div className="w-32"><Field label="יישובים/יום" value={txs} onChange={setTxs} dir="ltr" type="number" /></div>
          <button onClick={runTron} disabled={busy} className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[12px] font-bold transition-colors inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}חשב
          </button>
        </div>
        {tron && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              { l: 'אנרגיה יומית', v: tron.dailyEnergy.toLocaleString('en-US') },
              { l: 'עלות שריפה/TX', v: `${tron.burnCostPerTxTrx} TRX` },
              { l: 'עלות שריפה/יום', v: `${tron.burnCostPerDayTrx} TRX` },
              { l: 'נקודת איזון', v: `${tron.breakEvenTxs} TX/יום` },
            ].map(x => (
              <div key={x.l} className="sv-well px-3 py-2">
                <div className="label-caps">{x.l}</div>
                <div className="font-data text-[15px] font-semibold text-zinc-900" dir="ltr">{x.v}</div>
              </div>
            ))}
            <div className="col-span-2 mt-1 space-y-1">
              {tron.txPlan.map(s => (
                <div key={s.step} className="rounded-lg border border-[#eeeeea] px-3 py-2">
                  <div className="text-[11px] font-semibold text-zinc-800">{s.step}</div>
                  <div className="font-data text-[9.5px] text-zinc-500 truncate" dir="ltr" title={s.call}>{s.call}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* HIVE RC recovery */}
      <section className="sv-card p-4">
        <TowerHeader icon={Clock} title="תוכנית התאוששות Hive RC" sub="regen ~20%/יום — ספי 8%/12% לעגינה קלה וכבדה" accent="amber" />
        <div className="flex items-end gap-2">
          <div className="w-32"><Field label="RC נוכחי (%)" value={rc} onChange={setRc} dir="ltr" type="number" /></div>
          <button onClick={runHive} className="h-9 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-bold transition-colors inline-flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" />עדכן
          </button>
        </div>
        {hive && (
          <div className="mt-4 space-y-1.5">
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-800 font-semibold">{hive.verdict}</div>
            {hive.path.map((p, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-[#eeeeea] px-3 py-2">
                <span className="w-6 h-6 rounded-full bg-zinc-100 text-zinc-600 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-semibold text-zinc-800">{p.step}</div>
                  <div className="text-[10px] text-zinc-500">{p.detail}</div>
                </div>
                {p.hours > 0 && <span className="font-data text-[10.5px] text-amber-700 shrink-0" dir="ltr">{p.hours}h</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────── tower 3: כלכלה ──
function EconomyTower() {
  const [pool, setPool] = useState('10000');
  const [fee, setFee] = useState('0.3');
  const [rounds, setRounds] = useState('1800');
  const [perRound, setPerRound] = useState('0.4');
  const [inbound, setInbound] = useState('3000');
  const [rate, setRate] = useState('1000');
  const [door, setDoor] = useState('250');
  const [doorFee, setDoorFee] = useState('2');
  const [fly, setFly] = useState('2');
  const [res, setRes] = useState<EconomyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const q = new URLSearchParams({ pool, fee, rounds, perRound, inbound, rate, door, doorFee, fly });
      const r = await fetch(`/api/saos/economy?${q}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) setRes(j.result);
    } catch { /* */ }
    setBusy(false);
  }
  useEffect(() => { const t = setTimeout(run, 0); return () => clearTimeout(t); }, []);

  return (
    <section className="sv-card p-4">
      <TowerHeader icon={Coins} title="סימולטור זרמי הכלכלה" sub="ארבעה זרמי מימוש + גלגל-חור: רווח → אנרגיה → עגינה נוספת" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Field label="מחזור בריכות/יום" value={pool} onChange={setPool} dir="ltr" type="number" />
        <Field label="עמלת בריכה (%)" value={fee} onChange={setFee} dir="ltr" type="number" />
        <Field label="סבבי grid/יום" value={rounds} onChange={setRounds} dir="ltr" type="number" />
        <Field label="רווח/סבב" value={perRound} onChange={setPerRound} dir="ltr" type="number" />
        <Field label="מסילה נכנסת" value={inbound} onChange={setInbound} dir="ltr" type="number" />
        <Field label="שער מסילה" value={rate} onChange={setRate} dir="ltr" type="number" />
        <Field label="קריאות door/יום" value={door} onChange={setDoor} dir="ltr" type="number" />
        <Field label="עמלת door" value={doorFee} onChange={setDoorFee} dir="ltr" type="number" />
        <Field label="גלגל-חור (%)" value={fly} onChange={setFly} dir="ltr" type="number" />
        <div className="flex items-end"><button onClick={run} disabled={busy} className="w-full h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[12px] font-bold transition-colors inline-flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Coins className="w-3.5 h-3.5" />}הרץ
        </button></div>
      </div>
      {res && (
        <div className="mt-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
            <div className="sv-well px-3 py-2"><div className="label-caps">סה״כ/יום</div><div className="font-data text-[15px] font-semibold text-emerald-700" dir="ltr">{res.totalPerDay.toLocaleString('en-US')}</div></div>
            <div className="sv-well px-3 py-2"><div className="label-caps">מושקע חזרה</div><div className="font-data text-[15px] font-semibold text-amber-700" dir="ltr">{res.reinvestedPerDay.toLocaleString('en-US')}</div></div>
            <div className="sv-well px-3 py-2"><div className="label-caps">נשמר בקופה</div><div className="font-data text-[15px] font-semibold text-zinc-900" dir="ltr">{res.retainedPerDay.toLocaleString('en-US')}</div></div>
            <div className="sv-well px-3 py-2"><div className="label-caps">אנרגיה ממומנת</div><div className="font-data text-[15px] font-semibold text-zinc-900" dir="ltr">{typeof res.energyFunded === 'object' && res.energyFunded ? `${Number(res.energyFunded.trx).toLocaleString('en-US')} TRX · ${res.energyFunded.settlements} settle` : '—'}</div></div>
          </div>
          <div className="space-y-1.5">
            {res.streams.map(s => (
              <div key={s.name} className="flex items-center gap-3 rounded-lg border border-[#eeeeea] px-3 py-2">
                <span className="font-data text-[10px] text-zinc-400 shrink-0 w-24 truncate" dir="ltr">{s.name}</span>
                <span className="text-[11px] text-zinc-600 flex-1 min-w-0">{s.he} <span className="text-zinc-400">· {s.note}</span></span>
                <span className="font-data text-[12px] font-semibold text-emerald-700 shrink-0" dir="ltr">{s.amount.toLocaleString('en-US')}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11.5px] text-emerald-900 leading-relaxed">{res.verdict}</div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────── tower 4: הוכחות ──
function ProofsTower({ saos }: { saos: SaosStatus | null }) {
  const [pack, setPack] = useState<VerifyPack | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await fetch('/api/saos/verify-pack', { cache: 'no-store' }); setPack(await r.json()); } catch { /* */ }
    setBusy(false);
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const lastSeal = saos?.seals?.[0];
  const hasPack = pack?.ok && pack.tree?.root;

  return (
    <section className="sv-card p-4">
      <TowerHeader icon={FileCheck2} title="חבילת-הוכחות (verify-pack)" sub="עץ Merkle + הוכחות הכלה — כל אחד יכול לאמת בלי לסמוך עלינו" />
      <button onClick={load} disabled={busy} className="h-9 px-3.5 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 text-[12px] text-zinc-700 transition-colors inline-flex items-center gap-2 disabled:opacity-50">
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />רענן חבילה
      </button>
      {hasPack && (
        <div className="mt-4 space-y-3">
          {pack.allVerified ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12px] font-semibold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />כל {pack.tree?.leaves ?? 0} העלים אומתו מול השורש — rootMatches: {String(pack.rootMatches)}
            </div>
          ) : (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] font-semibold text-rose-700 flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />יש עלים שלא אומתו — בדוק למטה
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sv-well px-3 py-2.5">
              <div className="label-caps mb-1">מרקל-רוט</div>
              <div className="font-data text-[10px] text-zinc-800 break-all leading-relaxed" dir="ltr">{pack.tree?.root ?? "—"}</div>
            </div>
            <div className="sv-well px-3 py-2.5">
              <div className="label-caps mb-1">stateRoot</div>
              <div className="font-data text-[10px] text-zinc-800 break-all leading-relaxed" dir="ltr">{pack.seal?.stateRoot || '—'}</div>
            </div>
            <div className="sv-well px-3 py-2.5">
              <div className="label-caps mb-1">מבנה</div>
              <div className="font-data text-[12px] font-semibold text-zinc-800" dir="ltr">{pack.tree?.leaves ?? 0} leaves · {pack.tree?.levels ?? 0} levels</div>
              <div className="font-data text-[9.5px] text-zinc-400" dir="ltr">{pack.seal?.createdAt ? new Date(pack.seal.createdAt).toLocaleString('he-IL') : ''}</div>
            </div>
          </div>
          <div>
            <div className="label-caps mb-1.5">עלים מאומתים ({(pack.proofs || []).length})</div>
            <div className="space-y-1 max-h-72 overflow-y-auto scroll-slim">
              {(pack.proofs || []).map(p => (
                <div key={p.index} className="flex items-center gap-3 rounded-lg border border-[#eeeeea] px-3 py-2">
                  {p.verified ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                  <span className="font-data text-[10px] text-zinc-500 shrink-0 w-14" dir="ltr">#{p.index}</span>
                  <span className="font-data text-[10px] text-zinc-700 truncate flex-1" dir="ltr" title={p.leaf}>{p.leaf}</span>
                </div>
              ))}
            </div>
          </div>
          {pack.howToVerify && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800">
                <ChevronDown className="w-3.5 h-3.5" />איך לאמת בעצמך
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-[10px] leading-relaxed font-data text-zinc-300 overflow-x-auto whitespace-pre-wrap" dir="ltr">{pack.howToVerify}</pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}
      {pack?.ok && !hasPack && (
        <div className="mt-4 rounded-xl border border-dashed border-[#d8d8d1] bg-zinc-50 px-4 py-6 text-center">
          <FileCheck2 className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
          <p className="text-[12px] text-zinc-500 leading-relaxed">{pack.message || 'אין חותם עדיין'}</p>
          <p className="text-[11px] text-zinc-400 mt-1">{lastSeal ? `החותם האחרון: ${lastSeal.root.slice(0, 14)}…` : 'עבור אל מגדל-הפיקוח ואטום חותם ראשון'}</p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────── tower 5: פורץ דרך ──
function ResearchTower() {
  const [res, setRes] = useState<Research | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(1);

  useEffect(() => {
    (async () => {
      setBusy(true);
      try { const r = await fetch('/api/saos/research', { cache: 'no-store' }); const j = await r.json(); if (j.ok) setRes(j); } catch { /* */ }
      setBusy(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      {res && (
        <section className="sv-card p-4">
          <TowerHeader icon={Gavel} title={`פסק-הדין — נבחר: ${res.synthesis.chosen}`} sub="דירוג כל 10 הארכיונים עם ראיות והרציונל" />
          <div className="grid gap-2 lg:grid-cols-2 mb-3">
            <div className="sv-well p-3">
              <div className="label-caps mb-1.5">למה הנבחר</div>
              <ul className="space-y-1">
                {res.synthesis.why.map((w, i) => (
                  <li key={i} className="text-[11px] text-zinc-600 leading-relaxed flex gap-1.5"><span className="text-emerald-600 shrink-0">•</span>{w}</li>
                ))}
              </ul>
            </div>
            <div className="sv-well p-3">
              <div className="label-caps mb-1.5">מפת-דרכים</div>
              <ol className="space-y-1">
                {res.synthesis.roadmap.map((r, i) => (
                  <li key={i} className="text-[11px] text-zinc-600 leading-relaxed flex gap-1.5"><span className="font-data text-[9px] text-zinc-400 shrink-0 mt-0.5" dir="ltr">{i + 1}</span>{r}</li>
                ))}
              </ol>
            </div>
          </div>
          <div className="space-y-1.5">
            {res.findings.sort((a, b) => a.rank - b.rank).map(f => (
              <div key={f.rank} className="rounded-xl border border-[#eeeeea] overflow-hidden">
                <button onClick={() => setOpen(open === f.rank ? null : f.rank)} className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-zinc-50 transition-colors text-right">
                  <span className={`w-7 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center shrink-0 ${f.rank === 1 ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500'}`} dir="ltr">{f.rank}</span>
                  <span className="font-data text-[11.5px] font-semibold text-zinc-800 flex-1 min-w-0 truncate" dir="ltr">{f.archive}</span>
                  <div className="hidden sm:flex items-center gap-1.5 w-28 shrink-0">
                    <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden flex-1"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${f.score}%` }} /></div>
                    <span className="font-data text-[10px] text-zinc-500" dir="ltr">{f.score}</span>
                  </div>
                </button>
                {open === f.rank && (
                  <div className="px-3.5 pb-3 pt-1 border-t border-[#f4f4f0] space-y-2">
                    <p className="text-[11.5px] text-zinc-600 leading-relaxed">{f.verdict}</p>
                    {f.salvage.length > 0 && (
                      <div>
                        <div className="label-caps mb-1">נשמר לארכיון</div>
                        <div className="flex flex-wrap gap-1">{f.salvage.map((s, i) => <span key={i} className="font-data text-[9.5px] bg-zinc-100 border border-[#e8e8e3] rounded-md px-1.5 py-0.5 text-zinc-600" dir="ltr">{s}</span>)}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {busy && !res && <div className="py-8 text-center text-[12px] text-zinc-400">טוען פסק-דין...</div>}
    </div>
  );
}

// ─────────────────────────────────────────── shell ──
export function TowersView({ saos, onSaosRefresh }: { saos: SaosStatus | null; onSaosRefresh: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight leading-tight text-zinc-900">חמשת המגדלים</h1>
        <p className="text-[12px] text-zinc-500 mt-0.5">פלטפורמת העגינה הריבונית — {saos?.motto || 'אנחנו מנצחים את הבלוקצ׳יין'}</p>
      </div>
      <Tabs defaultValue="watch" dir="rtl" className="w-full">
        <TabsList className="bg-white border border-[#e8e8e3] rounded-xl p-1 h-auto w-full justify-start overflow-x-auto scroll-slim gap-0.5 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
          {[
            { id: 'watch', label: 'מגדל-פיקוח', icon: Landmark },
            { id: 'energy', label: 'אנרגיה', icon: Zap },
            { id: 'economy', label: 'כלכלה', icon: Coins },
            { id: 'proofs', label: 'הוכחות', icon: FileCheck2 },
            { id: 'research', label: 'פורץ דרך', icon: Gavel },
          ].map(t => (
            <TabsTrigger key={t.id} value={t.id} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-zinc-600 gap-1.5 whitespace-nowrap">
              <t.icon className="w-3.5 h-3.5" />{t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="watch" className="mt-4 animate-rise"><Watchtower saos={saos} onSealed={onSaosRefresh} /></TabsContent>
        <TabsContent value="energy" className="mt-4 animate-rise"><EnergyTower /></TabsContent>
        <TabsContent value="economy" className="mt-4 animate-rise"><EconomyTower /></TabsContent>
        <TabsContent value="proofs" className="mt-4 animate-rise"><ProofsTower saos={saos} /></TabsContent>
        <TabsContent value="research" className="mt-4 animate-rise"><ResearchTower /></TabsContent>
      </Tabs>
    </div>
  );
}
