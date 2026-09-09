'use client';

// ─── עיגונים · Anchors — הוכחות-חיים על שרשראות-ציבור ──────────────────────
// Relay → Steem/Hive/TRON (txid + סיירים) · חותמות-מרקל חיות ·
// מפת-הנזילות-החוץ (onramp) · כנות מלאה: מה-חי, מה-מושבת ולמה.

import { useCallback, useEffect, useState } from 'react';
import { Anchor, ExternalLink, RefreshCcw, ShieldCheck, ShieldAlert, Landmark, Loader2 } from 'lucide-react';
import { fmtInt, type World } from './common';

type RelayChain = {
  enabled: boolean; status: string; lastTxid: string | null; lastHeight: number | null;
  lastAt: number | null; lastError: string | null; anchored: number; verified: number;
  mismatches: number; endpointHost?: string;
  breaker?: { state: string; failures: number; trips: number };
};
type RelayData = {
  enabled: boolean; account: string; queue: number; tronIdentity?: string;
  metrics: Record<string, number>; chains: Record<string, RelayChain>;
};
type ProofData = {
  ok: boolean; empty?: boolean; message?: string;
  seal?: { fromHeight: number; toHeight: number; root: string; stateRoot: string; leaves: number; digest: string };
  verified?: boolean; recomputedRoot?: string; error?: string;
};
type OnrampData = {
  at?: string; stale?: boolean; needsOperator?: string[];
  accounts: Array<{ account: string; role: string; liquidHive: number; hbd: number; hp: number; rcEffective: number; anchorCapacityPerDay: number; movableNow: boolean; why?: string }>;
  tokens?: Array<{ symbol?: string; account?: string; balance?: string | number }>;
  totals?: Record<string, unknown>; note?: string;
};

const EXPLORERS: Record<string, (tx: string) => string> = {
  steem: tx => `https://steemworld.org/tx/${tx}`,
  hive: tx => `https://hiveblocks.com/tx/${tx}`,
  tron: tx => `https://tronscan.org/#/transaction/${tx}`,
};

export function AnchorsView({ world }: { world: World | null }) {
  const [relay, setRelay] = useState<RelayData | null>(null);
  const [proof, setProof] = useState<ProofData | null>(null);
  const [onramp, setOnramp] = useState<OnrampData | null>(null);
  const [loading, setLoading] = useState(true);
  const [onrampLoading, setOnrampLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        fetch('/saos-dex/api/dex/relay', { cache: 'no-store' }).then(x => x.json()).catch(() => null),
        fetch('/saos-dex/api/dex/proofs', { cache: 'no-store' }).then(x => x.json()).catch(() => null),
      ]);
      if (r?.ok) setRelay(r.relay);
      setProof(p);
    } catch { /* */ }
    setLoading(false);
  }, []);

  const loadOnramp = useCallback(async (force = false) => {
    setOnrampLoading(true);
    try {
      const j = await fetch(`/saos-dex/api/dex/onramp${force ? '?force=1' : ''}`, { cache: 'no-store' }).then(x => x.json());
      if (j.ok) setOnramp(j.onramp);
    } catch { /* */ }
    setOnrampLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load(); loadOnramp(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadOnramp]);

  const seals = world?.proofs.seals ?? [];
  const chains = relay ? Object.entries(relay.chains) : [];

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-6" data-testid="anchors-view">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Anchor className="w-5 h-5 text-[color:var(--pink)]" />
            עיגון-רשת חי
          </h2>
          <p className="text-xs text-[color:var(--text-2)] mt-0.5">
            כל חותם-מרקל של השרשרת הריבונית נעגן בשרשראות-ציבור עם txid ואימות-קריאה-חוזרת
          </p>
        </div>
        <button onClick={() => load()} className="dx-ghost h-9 px-4 text-xs flex items-center gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin-slow" /> : <RefreshCcw className="w-3.5 h-3.5" />} רענון
        </button>
      </div>

      {/* relay chains */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="relay-chains">
        {chains.map(([name, c]) => {
          const live = c.enabled && c.status !== 'disabled';
          const exp = EXPLORERS[name];
          return (
            <div key={name} className="dx-card p-4" data-testid={`relay-${name}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm uppercase dx-num" dir="ltr">{name}</span>
                <span className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full ${live ? 'bg-[color:var(--green-soft)] text-[color:var(--green)]' : 'bg-[color:var(--amber-soft)] text-[color:var(--amber)]'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-[color:var(--green)] pulse-ring' : 'bg-[color:var(--amber)]'}`} />
                  {c.enabled ? 'חי' : 'מושבת'}
                </span>
              </div>
              <div className="dx-raised p-2.5 mt-3 space-y-1.5 text-[11px]">
                <div className="flex justify-between"><span className="text-[color:var(--text-2)]">עגונו</span><span className="dx-num">{fmtInt(c.anchored)}</span></div>
                <div className="flex justify-between"><span className="text-[color:var(--text-2)]">אומתו</span><span className="dx-num text-[color:var(--green)]">{fmtInt(c.verified)}</span></div>
                <div className="flex justify-between"><span className="text-[color:var(--text-2)]">אי-התאמות</span><span className={`dx-num ${c.mismatches ? 'text-[color:var(--red)]' : ''}`}>{fmtInt(c.mismatches)}</span></div>
                {c.breaker && (
                  <div className="flex justify-between">
                    <span className="text-[color:var(--text-2)]">שובר-מעגל</span>
                    <span className={`dx-num ${c.breaker.state === 'closed' ? 'text-[color:var(--green)]' : 'text-[color:var(--amber)]'}`}>{c.breaker.state}</span>
                  </div>
                )}
              </div>
              {c.lastTxid && exp ? (
                <a href={exp(c.lastTxid)} target="_blank" rel="noreferrer"
                  className="dx-raised mt-2 p-2.5 flex items-center justify-between gap-2 hover:border-[color:var(--line-strong)] transition-colors">
                  <span className="dx-num text-[10px] text-[color:var(--text-2)] truncate" dir="ltr">{c.lastTxid}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 text-[color:var(--text-3)]" />
                </a>
              ) : (
                <p className="text-[10px] text-[color:var(--text-3)] mt-2 leading-relaxed">
                  {c.lastError || 'המתנה-כלכלית — העיגון ידלק כשהתקציב יאפשר'}
                </p>
              )}
            </div>
          );
        })}
        {chains.length === 0 && !loading && (
          <div className="dx-card p-6 text-center text-sm text-[color:var(--text-2)] md:col-span-3">
            מודול-העיגון טרם נטען
          </div>
        )}
      </div>

      {/* relay global metrics */}
      {relay && (
        <div className="dx-card p-4 flex flex-wrap gap-x-6 gap-y-2 text-xs" data-testid="relay-metrics">
          <span className="text-[color:var(--text-2)]">חשבון-עוגן: <span className="dx-num text-[color:var(--text-1)]">{relay.account}</span></span>
          <span className="text-[color:var(--text-2)]">שידורים: <span className="dx-num text-[color:var(--text-1)]">{fmtInt(relay.metrics.broadcasts || 0)}</span></span>
          <span className="text-[color:var(--text-2)]">אימותים: <span className="dx-num text-[color:var(--green)]">{fmtInt(relay.metrics.verified || 0)}</span></span>
          <span className="text-[color:var(--text-2)]">המתנות-כלכליות: <span className="dx-num">{fmtInt(relay.metrics.economicWaits || 0)}</span></span>
          {relay.tronIdentity && (
            <span className="text-[color:var(--text-2)] w-full truncate">TRON: <span className="dx-num text-[color:var(--text-1)]" dir="ltr">{relay.tronIdentity}</span></span>
          )}
        </div>
      )}

      {/* merkle seal — live verify */}
      <div className="dx-card p-4 md:p-5" data-testid="merkle-panel">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-[color:var(--green)]" />
          חותם-מרקל אחרון · אימות-עצמי
        </h3>
        {proof?.seal ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="גובה" value={`${proof.seal.fromHeight}–${proof.seal.toHeight}`} />
              <Stat label="עלים" value={String(proof.seal.leaves)} />
              <Stat label="אימות עצמאי" value={proof.verified ? 'עובר' : (proof.error ? 'DB כבוי' : 'נכשל')} ok={proof.verified ? true : undefined} />
              <Stat label="digest" value={proof.seal.digest.slice(0, 10) + '…'} />
            </div>
            <div className="dx-raised p-3" dir="ltr">
              <div className="text-[9px] label-caps">MERKLE ROOT</div>
              <div className="dx-num text-[11px] break-all mt-0.5">{proof.seal.root}</div>
              <div className="text-[9px] label-caps mt-2">STATE ROOT</div>
              <div className="dx-num text-[11px] break-all mt-0.5 text-[color:var(--text-2)]">{proof.seal.stateRoot}</div>
              {proof.recomputedRoot && (
                <div className="text-[9px] label-caps mt-2">RECOMPUTED {proof.verified ? '✓' : '✗'}</div>
              )}
            </div>
            {proof.error && (
              <p className="text-[11px] text-[color:var(--amber)] flex items-start gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {proof.error} — השרשרת עצמה ממשיכה (evidence-port fail-open מבוקר)
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--text-2)]">{proof?.message || 'טוען ראיות…'}</p>
        )}
        {/* seals history */}
        {seals.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[color:var(--line)]">
            <div className="text-[11px] label-caps mb-2">חותמות אחרונות ({seals.length})</div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {seals.slice(0, 8).map((s, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] px-1">
                  <span className="dx-num text-[color:var(--text-2)]" dir="ltr">h{s.fromHeight}–h{s.toHeight}</span>
                  <span className="dx-num text-[color:var(--text-3)]" dir="ltr">{s.root.slice(0, 16)}…</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* onramp — external liquidity map */}
      <div className="dx-card p-4 md:p-5" data-testid="onramp-panel">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Landmark className="w-4 h-4 text-[color:var(--amber)]" />
            מפת-הנזילות-החוץ האמתית
          </h3>
          <button onClick={() => loadOnramp(true)} className="dx-ghost h-8 px-3 text-[11px] flex items-center gap-1.5">
            {onrampLoading ? <Loader2 className="w-3 h-3 animate-spin-slow" /> : <RefreshCcw className="w-3 h-3" />}
            מדידה כפויה
          </button>
        </div>
        {onramp ? (
          <div className="space-y-2">
            <p className="text-[11px] text-[color:var(--text-2)]">{onramp.note}</p>
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {onramp.accounts.map(a => (
                <div key={a.account} className="dx-raised p-2.5 flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold dx-num" dir="ltr">@{a.account}</div>
                    <div className="text-[10px] text-[color:var(--text-3)]">{a.role} · RC {fmtInt(a.rcEffective / 1e6)}M</div>
                  </div>
                  <div className="text-left" dir="ltr">
                    <div className="dx-num text-xs">{a.liquidHive.toFixed(3)} HIVE{a.hbd ? ` · ${a.hbd.toFixed(3)} HBD` : ''}{a.hp > 1 ? ` · ${a.hp.toFixed(1)} HP` : ''}</div>
                    <div className="text-[10px] text-[color:var(--text-3)]">~{a.anchorCapacityPerDay} עיגונים/יום</div>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${a.movableNow ? 'bg-[color:var(--green-soft)] text-[color:var(--green)]' : 'bg-[color:var(--amber-soft)] text-[color:var(--amber)]'}`}>
                    {a.movableNow ? 'ניתן להזזה' : 'דרושה החלטת בעלים'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[color:var(--text-2)]">טוען מפת-נזילות…</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="dx-raised p-2.5">
      <div className="text-[9px] label-caps">{label}</div>
      <div className={`dx-num text-xs mt-0.5 ${ok === true ? 'text-[color:var(--green)]' : ok === false ? 'text-[color:var(--red)]' : ''}`}>{value}</div>
    </div>
  );
}
