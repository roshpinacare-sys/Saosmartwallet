'use client';

// ─── אחוזת-האמת · Estate View ──────────────────────────────────────────────
// סריקה-חיה של כל-מה-שהאחוזה הריבונית מחזיקה באמת — כל-מספר מ-RPC ציבורי.
// התשובה הכנה לשאלה: "אם אני רוצה לממש עכשיו — כמה אפשר לממש באמת?"
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Landmark, Lock, Unlock, ArrowUpRight, AlertTriangle, ShieldCheck, Search } from 'lucide-react';
import { authHeaders, fmtAgo } from '@/components/sv/shared';

interface HeadInfo { account: string; liquid: number; spOwn?: number; spDelegatedOut?: number; hpOwn?: number; hpDelegatedOut?: number; bpOwn?: number; bpDelegatedOut?: number; sbd?: number; hbd?: number; savings?: number }
interface Prices { [sym: string]: { usd: number; src: string } }
interface EstateData {
  ok: boolean; cached?: boolean; at: string;
  heads: Record<string, HeadInfo>;
  heTokens: Array<{ symbol: string; balance: number }>;
  wallets: {
    evm: Array<{ entity: string; address: string; chains: Record<string, number> }>;
    sol: Array<{ entity: string; address: string; sol: number }>;
    tron: Array<{ entity: string; address: string; trx: number }>;
    btc: Array<{ entity: string; address: string; btc: number }>;
  };
  prices: Prices;
  totals: Record<string, number>;
  cashOut: {
    eth: { inDexLiquidity: number; realEstateEth: number; sweepGasEth: number; sweepGasGwei: number; netAfterSweepEth: number; fundedAddresses: number; verdict: string };
    paths: Array<{ name: string; amount: number; sym: string; usd: number; locked?: boolean }>;
  };
  tronLegacy?: Array<{ name: string; address: string; trx: number; trc10: Array<{ id: string; value: number }> }>;
  fleetHive?: { rows: Array<{ account: string; liquid: number; hbd: number }>; liquidTotal: number };
  scan?: { sweep: string; checked: string; zero: string; resolved: string };
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 3 : 2 })}`;

function Card({ title, icon: Icon, children, testid }: { title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; testid?: string }) {
  return (
    <section className="dx-card rounded-2xl p-4 md:p-5" data-testid={testid}>
      <h2 className="flex items-center gap-2 text-[13px] font-bold mb-3.5 text-[color:var(--text-1)]">
        {Icon && <Icon className="w-4 h-4 text-[color:var(--pink)]" />}{title}
      </h2>
      {children}
    </section>
  );
}

export function EstateView() {
  const [data, setData] = useState<EstateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/vault/estate', { cache: 'no-store', headers: authHeaders() });
      const j = await r.json();
      if (j.ok) setData(j);
      else setErr(j.error === 'unauthorized' ? 'התחבר כדי לסרוק את האחוזה' : (j.error || 'נכשל'));
    } catch { setErr('שגיאת רשת'); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const p = (sym: string) => data?.prices[sym]?.usd ?? 0;
  const grand = data?.totals?.grandUsd ?? 0;
  const unlocked = data?.cashOut.paths.filter(x => !x.locked).reduce((a, x) => a + x.usd, 0) ?? 0;
  const locked = data?.cashOut.paths.filter(x => x.locked).reduce((a, x) => a + x.usd, 0) ?? 0;

  return (
    <div className="space-y-4 md:space-y-5">
      {/* hero */}
      <section className="dx-card rounded-2xl p-5 md:p-6 border-[color:var(--pink)]/25 relative overflow-hidden">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Landmark className="w-4 h-4 text-[color:var(--pink)]" />
              <h1 className="text-lg md:text-xl font-black tracking-tight">אחוזת-האמת</h1>
              {data?.cached && <span className="dx-chip h-6 px-2 text-[9px] text-[color:var(--amber)]">CACHE</span>}
            </div>
            <p className="text-[12px] text-[color:var(--text-2)] max-w-xl leading-relaxed">
              סריקה-חיה של כל-מה-שהאחוזה מחזיקה בפועל על השרשראות — ראשים, 12 ארנקי-חיילים, 7 רשתות-EVM.
              אפס יתרות-ספר; כל-מספר מ-RPC ציבורי. {data ? <span className="dx-num text-[color:var(--text-3)]" dir="ltr">· {fmtAgo(data.at)}</span> : null}
            </p>
          </div>
          <button onClick={load} disabled={loading} className="dx-cta h-10 px-4 text-[13px] flex items-center gap-2 disabled:opacity-50" data-testid="estate-refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> סריקה מחדש
          </button>
        </div>
        {err && <div className="mt-3 text-[12px] text-[color:var(--red)] flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
        {!err && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="dx-raised rounded-xl p-3">
              <div className="text-[10px] text-[color:var(--text-3)] mb-1">שווי-אחוזה גולמי</div>
              <div className="text-xl md:text-2xl font-black dx-num text-[color:var(--text-1)]" data-testid="estate-grand">{data ? usd(grand) : '—'}</div>
            </div>
            <div className="dx-raised rounded-xl p-3">
              <div className="text-[10px] text-[color:var(--text-3)] mb-1 flex items-center gap-1"><Unlock className="w-3 h-3 text-[color:var(--green)]" />ממשה-עכשיו (נזיל)</div>
              <div className="text-xl md:text-2xl font-black dx-num text-[color:var(--green)]" data-testid="estate-liquid">{data ? usd(unlocked) : '—'}</div>
            </div>
            <div className="dx-raised rounded-xl p-3">
              <div className="text-[10px] text-[color:var(--text-3)] mb-1 flex items-center gap-1"><Lock className="w-3 h-3 text-[color:var(--amber)]" />נעול (vested)</div>
              <div className="text-xl md:text-2xl font-black dx-num text-[color:var(--amber)]" data-testid="estate-locked">{data ? usd(locked) : '—'}</div>
            </div>
          </div>
        )}
      </section>

      {data && (
        <>
          {/* התשובה לשאלת-ה-ETH */}
          <Card title="התשובה הכנה: כמה אפשר לממש עכשיו?" icon={ShieldCheck} testid="estate-cashout">
            <div className="rounded-xl border border-[color:var(--line)] p-4 bg-[color:var(--raised)]/60">
              <div className="text-[12px] font-bold mb-2">איתריום — תשובה ישירה</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
                <div className="dx-raised rounded-lg p-2.5">
                  <div className="text-[9.5px] text-[color:var(--text-3)]">נזילות-ETH בתוך ה-DEX</div>
                  <div className="dx-num font-bold text-[color:var(--red)]">0 ETH</div>
                  <div className="text-[9px] text-[color:var(--text-3)]">אין שוק-ETH — כנות מלאה</div>
                </div>
                <div className="dx-raised rounded-lg p-2.5">
                  <div className="text-[9.5px] text-[color:var(--text-3)]">ETH אמיתי באחוזה</div>
                  <div className="dx-num font-bold text-[color:var(--text-1)]">{data.cashOut.eth.realEstateEth.toPrecision(3)} ETH</div>
                  <div className="text-[9px] text-[color:var(--text-3)]">{data.cashOut.eth.fundedAddresses} ארנקים · {usd(data.totals.evmEthUsd || 0)}</div>
                </div>
                <div className="dx-raised rounded-lg p-2.5">
                  <div className="text-[9.5px] text-[color:var(--text-3)]">עלות-איחוד (גז @{data.cashOut.eth.sweepGasGwei.toFixed(1)}gwei)</div>
                  <div className="dx-num font-bold text-[color:var(--amber)]">{data.cashOut.eth.sweepGasEth.toFixed(6)} ETH</div>
                </div>
                <div className="dx-raised rounded-lg p-2.5">
                  <div className="text-[9.5px] text-[color:var(--text-3)]">נטו אחרי-איחוד</div>
                  <div className="dx-num font-bold text-[color:var(--green)]">{data.cashOut.eth.netAfterSweepEth.toPrecision(3)} ETH</div>
                </div>
              </div>
              <p className="text-[11px] text-[color:var(--text-2)] leading-relaxed">{data.cashOut.eth.verdict}</p>
            </div>

            <div className="mt-3.5">
              <div className="text-[12px] font-bold mb-2">מסלולי-מימוש (דרך שוק-חוץ)</div>
              <div className="max-h-80 overflow-y-auto rounded-xl border border-[color:var(--line)]">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-[color:var(--raised)] text-[color:var(--text-3)]">
                    <tr className="text-[10px]">
                      <th className="text-right font-medium py-2 px-3">מסלול</th>
                      <th className="text-left font-medium py-2 px-2">כמות</th>
                      <th className="text-left font-medium py-2 px-3">שווי</th>
                    </tr>
                  </thead>
                  <tbody className="dx-num">
                    {data.cashOut.paths.map((x, i) => (
                      <tr key={i} className="border-t border-[color:var(--line)]">
                        <td className="py-2 px-3 text-[color:var(--text-2)] font-sans">
                          {x.name}
                          {x.locked && <Lock className="w-3 h-3 inline text-[color:var(--amber)] ms-1.5" />}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap" dir="ltr">{x.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} {x.sym}</td>
                        <td className={`py-2 px-3 whitespace-nowrap font-bold ${x.locked ? 'text-[color:var(--amber)]' : 'text-[color:var(--green)]'}`} dir="ltr">{usd(x.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* ראשים */}
          <Card title="ראשי-השרשראות (headcorner) — נזיל + vested חי" icon={Landmark} testid="estate-heads">
            <div className="grid md:grid-cols-3 gap-3">
              {(['steem', 'hive', 'blurt'] as const).map(chain => {
                const h = data.heads[chain];
                if (!h) return <div key={chain} className="dx-raised rounded-xl p-4 text-[11px] text-[color:var(--text-3)]">{chain}: RPC לא זמין — כנה</div>;
                const vested = h.spOwn ?? h.hpOwn ?? h.bpOwn ?? 0;
                const delOut = h.spDelegatedOut ?? h.hpDelegatedOut ?? h.bpDelegatedOut ?? 0;
                const liquid = h.liquid + (h.sbd ?? 0);
                const price = p(chain);
                return (
                  <div key={chain} className="dx-raised rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-bold uppercase tracking-wide">{chain}</span>
                      <span className="dx-chip h-5 px-1.5 text-[9px] dx-num" dir="ltr">{price ? `$${price.toPrecision(4)}` : 'אין-מחיר'}</span>
                    </div>
                    <div className="space-y-1 text-[11px] dx-num" dir="ltr">
                      <div className="flex justify-between"><span className="text-[color:var(--text-3)] font-sans">liquid</span><span className="font-bold">{h.liquid.toFixed(3)} {chain === 'steem' ? `+ ${h.sbd?.toFixed(2)} SBD` : ''}</span></div>
                      <div className="flex justify-between"><span className="text-[color:var(--text-3)] font-sans">vested own</span><span className="text-[color:var(--amber)]">{vested.toFixed(2)} {chain === 'hive' ? 'HP' : chain === 'blurt' ? 'BP' : 'SP'}</span></div>
                      {delOut > 0 && <div className="flex justify-between"><span className="text-[color:var(--text-3)] font-sans">delegated out</span><span>{delOut.toFixed(2)}</span></div>}
                      <div className="flex justify-between border-t border-[color:var(--line)] pt-1"><span className="text-[color:var(--text-3)] font-sans">USD liquid</span><span className="font-bold text-[color:var(--green)]">{usd(price * (h.liquid + (chain === 'steem' ? (h.sbd ?? 0) : 0)))}</span></div>
                      <div className="flex justify-between"><span className="text-[color:var(--text-3)] font-sans">USD vested</span><span className="text-[color:var(--amber)]">{usd(price * vested)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
            {data.heTokens.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.heTokens.map(t => (
                  <span key={t.symbol} className="dx-chip h-6 px-2 text-[9.5px] dx-num" dir="ltr">{t.symbol} {t.balance < 1 ? t.balance.toPrecision(3) : t.balance.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
                ))}
              </div>
            )}
          </Card>

          {/* ארנקי-החיילים */}
          <Card title="12 ארנקי-החיילים — יתרות חיות בכל-הרשתות" icon={ShieldCheck} testid="estate-wallets">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="dx-raised rounded-xl p-3.5">
                <div className="text-[11px] font-bold mb-2 flex items-center justify-between">
                  <span>EVM (7 רשתות)</span>
                  <span className="dx-num text-[color:var(--green)]" dir="ltr">{usd(data.totals.evmEthUsd || 0)}</span>
                </div>
                {data.wallets.evm.length === 0 ? (
                  <div className="text-[10.5px] text-[color:var(--text-3)]">אפס יתרות EVM — כנה</div>
                ) : (
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {data.wallets.evm.map(w => (
                      <div key={w.address} className="flex items-center justify-between text-[10.5px] dx-num" dir="ltr">
                        <span className="text-[color:var(--text-2)]">{w.entity.replace('wallet:', '')} {w.address.slice(0, 8)}…</span>
                        <span className="font-bold">{Object.entries(w.chains).map(([k, v]) => `${k}:${v.toPrecision(3)}`).join(' ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="dx-raised rounded-xl p-3.5">
                <div className="text-[11px] font-bold mb-2 flex items-center justify-between">
                  <span>Solana / TRON / BTC</span>
                  <span className="dx-num text-[color:var(--green)]" dir="ltr">{usd((data.totals.solUsd || 0) + (data.totals.tronUsd || 0) + (data.totals.btcUsd || 0))}</span>
                </div>
                {data.wallets.sol.length === 0 && data.wallets.tron.length === 0 && data.wallets.btc.length === 0 ? (
                  <div className="text-[10.5px] text-[color:var(--text-3)]">אפס יתרות SOL/TRON/BTC — כנה</div>
                ) : (
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {data.wallets.sol.map(w => (
                      <div key={w.address} className="flex items-center justify-between text-[10.5px] dx-num" dir="ltr">
                        <span className="text-[color:var(--text-2)]">{w.entity.replace('wallet:', '')} {w.address.slice(0, 8)}…</span>
                        <span className="font-bold">{w.sol.toPrecision(3)} SOL</span>
                      </div>
                    ))}
                    {data.wallets.tron.map(w => (
                      <div key={w.address} className="flex items-center justify-between text-[10.5px] dx-num" dir="ltr">
                        <span className="text-[color:var(--text-2)]">{w.entity.replace('wallet:', '')} {w.address.slice(0, 8)}…</span>
                        <span className="font-bold">{w.trx} TRX</span>
                      </div>
                    ))}
                    {data.wallets.btc.map(w => (
                      <div key={w.address} className="flex items-center justify-between text-[10.5px] dx-num" dir="ltr">
                        <span className="text-[color:var(--text-2)]">{w.entity.replace('wallet:', '')} {w.address.slice(0, 8)}…</span>
                        <span className="font-bold">{w.btc.toPrecision(3)} BTC</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 text-[10.5px] text-[color:var(--text-3)] leading-relaxed">
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[color:var(--amber)]" />
              <span>
                המפתחות-הפרטיים של כל-הארנקים נשמרים מוצפנים בכספת (12/12 אומתו מול-הכתובות — מסלול ed25519 ל-SOL, keccak ל-EVM).
                מסילות-העיגון של Solana ו-Ethereum כבר חיות על ארנק-cashmachine.
              </span>
            </div>
          </Card>

          {/* סריקת-60: צי-HIVE + טרון-לגסי */}
          {(data.fleetHive || data.tronLegacy) && (
            <Card title="סריקת-על 60 — מה שנמצא ברשת מעבר לראשים" icon={Search} testid="estate-scan60">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="dx-raised rounded-xl p-3.5">
                  <div className="text-[11px] font-bold mb-2 flex items-center justify-between">
                    <span>צי-HIVE מצטבר (כל החשבונות)</span>
                    <span className="dx-num text-[color:var(--green)]" dir="ltr">{usd(data.totals.fleetHiveUsd || 0)}</span>
                  </div>
                  {data.fleetHive && data.fleetHive.rows.length > 0 ? (
                    <div className="space-y-1 max-h-44 overflow-y-auto">
                      {data.fleetHive.rows.map(r => (
                        <div key={r.account} className="flex items-center justify-between text-[10.5px] dx-num" dir="ltr">
                          <span className="text-[color:var(--text-2)]">{r.account}</span>
                          <span className="font-bold">{r.liquid.toFixed(3)} HIVE{r.hbd > 0 ? ` + ${r.hbd.toFixed(3)} HBD` : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10.5px] text-[color:var(--text-3)]">לא נמדד — כנה</div>
                  )}
                </div>
                <div className="dx-raised rounded-xl p-3.5">
                  <div className="text-[11px] font-bold mb-2 flex items-center justify-between">
                    <span>טרון-לגסי (מנמוניק #2 בכספת)</span>
                    <span className="dx-num text-[color:var(--green)]" dir="ltr">{usd(data.totals.tronLegacyUsd || 0)}</span>
                  </div>
                  {data.tronLegacy && data.tronLegacy.length > 0 ? (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {data.tronLegacy.map(r => (
                        <div key={r.address} className="text-[10.5px] dx-num" dir="ltr">
                          <div className="flex items-center justify-between">
                            <span className="text-[color:var(--text-2)]">{r.name} {r.address.slice(0, 10)}…</span>
                            <span className="font-bold">{r.trx} TRX</span>
                          </div>
                          {r.trc10.length > 0 && (
                            <div className="text-[9px] text-[color:var(--text-3)] font-sans" dir="rtl">
                              טוקני-סקאם-ידועים (TRC-10) — שווי אפס: {r.trc10.length} מזהים
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10.5px] text-[color:var(--text-3)]">אפס יתרות — כנה</div>
                  )}
                  <div className="mt-2 text-[9.5px] text-[color:var(--text-3)] font-sans leading-relaxed">
                    הכתובות נגזרו מהמנמוניק המוצפן שבכספת; ה-TRX יכול להתרכז ב-TVN3 ולממש (דורש החלטת-מפעיל).
                  </div>
                </div>
              </div>
              {data.scan && (
                <div className="mt-3 rounded-xl border border-[color:var(--line)] p-3 text-[10.5px] leading-relaxed space-y-1">
                  <div className="text-[color:var(--text-2)]"><span className="font-bold">נבדק חי:</span> {data.scan.checked}</div>
                  <div className="text-[color:var(--text-3)]"><span className="font-bold">אפסים-כנים:</span> {data.scan.zero}</div>
                  <div className="text-[color:var(--amber)]"><span className="font-bold">תעלומות-שנפתרו:</span> {data.scan.resolved}</div>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
