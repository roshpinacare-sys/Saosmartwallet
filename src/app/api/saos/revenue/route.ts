import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/* ══ מנוע-ההרווח הריבוני (roast-80) — ה-API של "איך זה מרוויח" ═══════════════
 * GET /api/saos/revenue → מטריצת-אמת אחת: מה-יש-ביד → מה-מרוויח-עכשיו →
 * מה-זרם-היום → מה-חסום-בכנות. הכל מהמנוע-החי (:3010) + המושל-הכלכלי (:3005).
 * ציבורי-קריאה (אפס-סודות — כמו-כל-GET של-המנוע); cache-10s מול-הדמון. */

const DEX = 'http://127.0.0.1:3010/saos-dex/api/dex';
const GOVERNOR = 'http://127.0.0.1:3005/status';

type Json = Record<string, unknown>;

async function j(url: string, timeoutMs = 2500): Promise<Json | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as Json;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function prom(text: string, key: string): number | null {
  const m = text.match(new RegExp(`^${key} (-?[0-9.eE+-]+)$`, 'm'));
  return m ? Number(m[1]) : null;
}

let cache: { at: number; body: Json } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 10_000) {
    return NextResponse.json(cache.body);
  }

  const [econ, state, proto, wallets, doorRaw, govRaw] = await Promise.all([
    j(`${DEX}/economy`),
    j(`${DEX}/state`),
    j(`${DEX}/protorev`),
    j(`${DEX}/wallets`),
    j(`${DEX}/door`),
    j(GOVERNOR, 1500),
  ]);

  const metricsText = await fetch(`${DEX}/metrics`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');

  // FIX: המנוע מקנן את המצב תחת .state ({"ok","version","state":{...}})
  const inner = ((state?.state as Json | undefined) ?? state ?? {}) as Json;
  const height = Number(inner.height ?? 0);
  const halted = prom(metricsText, 'saos_halted') ?? (inner.halted ? 1 : 0);
  const runwayHours = prom(metricsText, 'saos_runway_hours');
  const runwayLevel = metricsText.match(/^saos_runway_level "([a-z]+)"/m)?.[1] ?? null;
  const burnPerBlock = prom(metricsText, 'saos_burn_per_block');

  const ve = (econ?.ve ?? {}) as Json;
  const revenue = (econ?.revenue ?? {}) as Json;
  const epoch = (econ?.epoch ?? {}) as Json;
  const income = (inner.income ?? {}) as Json;
  const protoState = (proto?.state ?? {}) as Json;
  const protoAux = (proto?.revAux ?? {}) as Json;

  const treasury = ((wallets?.wallets ?? []) as Json[]).find((w) => w.name === 'treasury') as
    | { credits?: number; balances?: Record<string, number> }
    | undefined;
  const tb = treasury?.balances ?? {};

  // מחירי-עזר מהפורטפוליו (ערך-הליבה-במונחי-USDS)
  const portfolio = await j(`${DEX}/portfolio?who=treasury`);
  const portfolioRoot = (portfolio?.portfolio ?? {}) as Json;
  const priceMap: Record<string, number> = { ...((portfolioRoot.prices ?? {}) as Record<string, number>) };
  // FIX: מחירי-LP וטוקנים-מיוחדים חיים-בשורות-הספרים (books[].lines[].price) — לא-במפה-העליונה
  for (const book of ((portfolioRoot.books ?? []) as Json[])) {
    for (const line of ((book.lines ?? []) as Json[])) {
      const asset = String(line.asset ?? '');
      const price = Number(line.price ?? 0);
      if (asset && price > 0 && !priceMap[asset]) priceMap[asset] = price;
    }
  }
  const coreBook = (((portfolioRoot.books ?? []) as Json[]).find((b) => b.name === 'core') ?? {}) as Json;
  const coreValueUsdsMu = Number(coreBook.valueUsdsMu ?? 0);

  // LP-שורות של-האוצר (העמדות-שמרוויחות-עמלות-מכל-סוואפ-בבריכות)
  const lpRows = Object.entries(tb)
    .filter(([k]) => k.startsWith('LP|'))
    .map(([k, amt]) => {
      const pair = k.slice(3);
      const p = priceMap[k] ?? 0;
      return { pair, amountMu: Number(amt), priceMu: p, valueUsdsMu: Math.floor((Number(amt) * p) / 1000) };
    })
    .filter((r) => r.amountMu > 0)
    .sort((x, y) => y.valueUsdsMu - x.valueUsdsMu);

  // מסילות-חסומות/מוגנות (אמת-חיה מהדלת)
  const door = (doorRaw?.door ?? doorRaw ?? {}) as Json;
  const custody = (door.custody ?? {}) as Json;
  const anchors = (door.anchors ?? {}) as Json;
  const tronA = (anchors.tron ?? {}) as Json;
  const solA = (anchors.sol ?? {}) as Json;
  const ethA = (anchors.eth ?? (anchors.evm ?? {})) as Json;

  const blocked: Json[] = [];
  if (Number(custody.tronSun ?? 0) <= 0 || Number(tronA.gapSun ?? 0) > 0) {
    blocked.push({
      rail: 'WTRX', reason: 'פקדת-TRX-חסרה — רצפת-bandwidth 0.3-TRX',
      custody: `${Number(custody.tronSun ?? 0)} sun`, gap: String(tronA.gapSun ?? '—'),
      unlock: 'הפקדה-הראשונה של-המפעיל תממן-עיגון-ופקדות',
    });
  }
  if (Number(solA.gapLamports ?? 0) <= 0) {
    blocked.push({
      rail: 'WSOL', reason: 'מוגן-תחת-רצפת-הגיבוי (roast-78) — הטבעה-חדשה-רק-מעל-התביעות',
      custody: `${Number(custody.solLamports ?? 0)} lamports`, gap: '0',
      unlock: 'פקדת-SOL-חוץ-טרייה (txid-אמת) או-המתנה-לצבירה',
    });
  }
  if (Number(ethA.gapWei ?? 0) > 0) {
    blocked.push({
      rail: 'WETH', reason: 'דלק-העיגון-מתחת-רצפת-הגנה (roast-77) — המתנה-כלכלית-כנה',
      custody: `${Number(custody.evmWei ?? 0)} wei`, gap: String(ethA.gapWei ?? '—'),
      unlock: 'מימון-דלק-ETH-חדש',
    });
  }

  const gov = (govRaw && (govRaw as Json).ok ? govRaw : null) as Json | null;

  const body: Json = {
    ok: true,
    ts: Date.now(),
    chain: { height, halted, runwayHours, runwayLevel, burnPerBlock },
    streams: [
      {
        id: 've-pot',
        title: 'קרן-ה-ve (Aerodrome ve(3,3))',
        status: Number(ve.totalPoints ?? 0) > 0 ? 'armed' : 'idle',
        detail: `אוצר-נעול ${Number(ve.vaultMu ?? 0)}µ SAOS × 208שב' · כוח ${Number(ve.totalPoints ?? 0)} · קרן-חיה ${Number(ve.potMu ?? 0)}µ`,
        flow: `קציר-כל-אפוק (${Number(epoch.every ?? 1200)} בלוקים ≈ שעה) — כמצביע-יחיד 100%-הקרן → אוצר`,
        evidence: { positions: ve.positions ?? [], votes: ve.votes ?? [], potMu: ve.potMu ?? 0, epochLeft: epoch.blocksLeft ?? 0 },
      },
      {
        id: 'protorev',
        title: 'שולחן-הארב (ProtoRev)',
        status: Number(protoState.runs ?? 0) > 0 ? 'earning' : 'idle',
        detail: `${Number(protoState.runs ?? 0)} ריצות · רווח-מצטבר ${Number(protoState.profitMu ?? 0)}µ · דחיות-מדיניות ${Number(protoState.rejections ?? 0)}`,
        flow: 'ארב-פנימי-בין-בריכות-עצמנו — רווח → revAux → מחזור-ההכנסות (40% שריפה · 40% קרן-ve · 20% אוצר)',
        evidence: { runs: protoState.runs ?? 0, profitMu: protoState.profitMu ?? 0, lastH: protoState.lastH ?? 0, revAuxProtorevMu: protoAux.protorevMu ?? 0 },
      },
      {
        id: 'fee-flywheel',
        title: 'גלגל-העמלות (זירה → מדידה → דלק)',
        status: 'earning',
        detail: `עמלות-בריכות-Σ ${Number(income.poolFeesMu ?? 0)}µ · מדידה-לא-קצורה ${Number(income.feeMeterMu ?? 0)}µ · מוטבל-לדלק ${Number(inner.gasFundedMu ?? 0)}µ`,
        flow: 'כל-סוואפ משלם-עמלה-דינמית → מדידה → mint_fuel-מגובה → סולם-הדלק → ציטוטים-חיים-ממשיכים',
        evidence: { swaps: inner.swaps ?? 0, fills: inner.fills ?? 0, ladder: inner.ladder ?? {} },
      },
      {
        id: 'router-burn',
        title: 'ראוטר-ההכנסות (קנייה-ושריפה)',
        status: Number(revenue.cycles ?? 0) > 0 ? 'earning' : 'idle',
        detail: `${Number(revenue.cycles ?? 0)} מחזורים · שריפה-מצטברת ${Number(revenue.burnedSaosMu ?? 0)}µ SAOS · קרן-ve-מומנה ${Number(revenue.vePaidMu ?? 0)}µ`,
        flow: '40%-שריפה (ΣSAOS-יורד — דפלציוני-אמת) · 40%-קרן-ve · 20%-אוצר · 10%-מזרקת-דלק',
        evidence: { burnedSaosMu: revenue.burnedSaosMu ?? 0, saosSupplyMu: revenue.saosSupplyMu ?? 0, blocksLeft: revenue.blocksLeft ?? 0 },
      },
    ],
    holdings: {
      treasuryCredits: treasury?.credits ?? 0,
      balances: tb,
      lpRows,
      coreValueUsdsMu,
      note: 'ערך-הליבה-כולל-LP-אוצר — כולו-על-השרשרת-שלנו, ניתן-לפדות-ב-pool_rmw',
    },
    governor: gov
      ? {
          online: true,
          uptimeSec: Number(gov.uptimeSec ?? 0),
          ticks: Number(gov.ticks ?? 0),
          lastErr: gov.lastErr ?? '',
          veLockMu: Number(gov.veLockMu ?? 0),
          votePool: gov.votePool ?? '',
          lastPotMu: Number(gov.lastPotMu ?? 0),
          lastEpoch: Number(gov.lastEpoch ?? -1),
          reports: ((gov.reports ?? []) as Json[]).slice(0, 6),
          actions: ((gov.actions ?? []) as Array<{ ts: number; kind: string; text: string }>).slice(0, 10),
        }
      : { online: false, note: 'המושל-לא-מגיב — השרשרת-ממשיכה-לשלם-בעצמה (הקציר-קנוני-בגרעין), המושל-רק-משגיח' },
    blocked,
    note: 'אפס-הדמיה: כל-מספר-מהמנוע-החי או-מהמושל; מה-שחסום-מדווח-חסום-עם-הסיבה',
  };

  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
