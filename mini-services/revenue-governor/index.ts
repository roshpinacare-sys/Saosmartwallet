// Revenue Governor (roast-80) — המושל-הכלכלי האוטונומי של SAOS
// ═══════════════════════════════════════════════════════════════════════════
// תפקיד: לוודא שההון-של-האוצר באמת מרוויח — בלי-הדמיה, בלי-הטבעה-חופשית:
//  1. ARM: אם-אין-עמדת-ve-לאוצר או-הצבעה-חסרה → batch-אטומי (ve_lock+ve_vote)
//     על issuer=treasury דרך דלת-ה-batch של הדמון (אותו-שער-מפעיל-של-הקונסולה).
//  2. WATCH: כל-אפוק (1200 בלוקים) — קציר-קרן-ה-ve נמדד (pot לפני/אחרי) +
//     רווח-אוצר + שריפה + מדידת-עמלות; דוח מלא משודר-לכל-הסוכנים בריליי.
//  3. ALERT: halt · runway-crit · הצבעה-שנפלה — כולם משודרים ומתועדים.
// אין-מסד · אין-מצב-קבוע-חוץ-מהשרשרת: השרשרת-היא-האמת; המושל רק מוודא-שהיא
// מכוונת-להרווח. כשל-דמון → economic-wait כנה (הדמון-מושבת ע"י dex-watchdog).
//
// סודות: allowlist דני (אותו-דפוס-ריליי-79) — רק DEX_OPERATOR_TOKEN +
// SOVEREIGN_RELAY_TOKEN נטענים; אף-ערך-לא-מודפס, אף-לוג-לא-מכיל-סודות.

import { createServer } from 'http';
import fs from 'fs';
import path from 'path';

// ── env allowlist (roast-66 pattern) ──────────────────────────────────────────
const ALLOWED = new Set(['DEX_OPERATOR_TOKEN', 'SOVEREIGN_RELAY_TOKEN']);
if (!process.env.DEX_OPERATOR_TOKEN || !process.env.SOVEREIGN_RELAY_TOKEN) {
  try {
    const bunMeta = import.meta as unknown as { dir: string };
    for (const line of fs.readFileSync(path.join(bunMeta.dir, '../../.env'), 'utf8').split('\n')) {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) continue;
      const m = raw.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || !m[1]) continue;
      const v = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)$/, '$1');
      if (ALLOWED.has(m[1]) && !process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* .env optional — fail-closed בהמשך */ }
}

const PORT = 3005;
const DEX = 'http://127.0.0.1:3010/saos-dex/api/dex';
const RELAY_EMIT = 'http://127.0.0.1:3004/emit';
const LOOP_MS = 30_000;
const ARM_COOLDOWN_MS = 10 * 60_000;
const VE_LOCK_MU = 1_000_000;   // 20% בערך מ-SAOS-אוצר — כוח-הצבעה-שולט
const VE_WEEKS = 208;           // מקסימום-Aerodrome — נקודות-מלאות
const VOTE_POOL = 'SAOS/USDS';  // הבריכה-העמוקה-ביותר — הליבה
const MIN_CREDITS = 1_000;

// ── Roast-83 · מנוע-הדלק-האוטונומי ──────────────────────────────────────────
// הלקח-המבני-של-81/82: המכונה-כולה-יושבת-דאון-מזילות-דלק (runway-crit) כשאף-אחד
// לא-ממיר-עמלות-מדודות-חזרה-לקרדיטים. המושל-עכשיו-מנהל-את-זה-אוטונומית:
// mintable = treasuryProfit + (feeMeter − רצפת-הסולם) — האוטומט **לא-נוגע**
// ברצפת-הסולם (8,000µ — מנוע-הערך). מזריק-קודם-לאוצר (דלק-שער-ה-batch),
// אחר-כך-לארנה (מנוע-העירוי-של-החיילים). כנות: אין-הטבעה-חופשית — כל-µ
// מגובה-בעמלות-שנמדדו-בפועל; אין-מה-להטביע → skip-כנה-מתועד.
const LADDER_FUEL_FLOOR = 8_000;   // אותה-רצפה-קנונית-של-הגרעין (LADDER_FUEL_FLOOR)
const FUEL_TREASURY_FLOOR = 1_500; // אוצר-חייב-דלק-לשער-ה-batch
const FUEL_ARENA_FLOOR = 6_000;    // מתחת-זה-החיילים-מתים-רעב
const FUEL_ARENA_TARGET = 12_000;  // יעד-מילוי-ארנה (~2.5h-שריפה)
const FUEL_MINT_CAP = 25_000;      // תקרה-פר-tick (הגרעין-מתיר-100k — אנחנו-שמרניים)
const FUEL_COOLDOWN_MS = 5 * 60_000;
const FUEL_MIN_MINT = 500;
let lastFuelAttempt = 0;

const OP_TOKEN = process.env.DEX_OPERATOR_TOKEN || '';
const RELAY_TOKEN = process.env.SOVEREIGN_RELAY_TOKEN || '';

type Journal = { ts: number; kind: string; text: string };
type Report = {
  ts: number; h: number; epoch: number;
  potHarvestMu: number; potLeftMu: number; vePoints: number; votePool: string;
  treasuryProfitMu: number; burnedSaosMu: number; feeMeterMu: number;
  protorevProfitMu: number; protorevRuns: number; gasFundedMu: number;
};

const bootTs = Date.now();
const actions: Journal[] = [];
const reports: Report[] = [];
let lastEpoch = -1;
let lastPotMu = -1;
let lastArmAttempt = 0;
let ticks = 0;
let lastErr = '';

function log(kind: string, text: string): void {
  const j: Journal = { ts: Date.now(), kind, text };
  actions.unshift(j);
  if (actions.length > 40) actions.length = 40;
  try {
    const bunMeta = import.meta as unknown as { dir: string };
    fs.appendFileSync(path.join(bunMeta.dir, 'governor.log'), JSON.stringify(j) + '\n');
  } catch { /* לוג-אופציונלי */ }
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 6000): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch { return null; }
  finally { clearTimeout(t); }
}

function emit(event: string, payload: Record<string, unknown>): void {
  if (!RELAY_TOKEN) { log('emit-skip', 'relay token missing (allowlist) — event dropped honestly'); return; }
  const body = JSON.stringify({ event, payload });
  fetch(RELAY_EMIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-relay-token': RELAY_TOKEN },
    body,
  }).then((r) => { if (!r.ok) log('emit-fail', `relay emit ${r.status} for ${event}`); })
    .catch(() => { /* relay down — economic wait, no crash */ });
}

// ── ARM: ציוד-אסטרטגיית-ה-ve של האוצר (idempotent) ───────────────────────────
async function armIfNeeded(): Promise<void> {
  const now = Date.now();
  const econ = await fetchJson(`${DEX}/economy`);
  if (!econ) { return; } // דמון-לא-זמין — ה-tick ידווח כנה
  const ve = (econ.ve ?? {}) as Record<string, unknown>;
  const positions = (ve.positions ?? []) as Array<Record<string, unknown>>;
  const votes = (ve.votes ?? []) as Array<Record<string, unknown>>;
  const pos = positions.find((p) => p.who === 'treasury' && p.locked === true);
  const vote = votes.find((v) => v.who === 'treasury');
  if (pos && vote) return; // חמוש-ומוצב — אין-פעולה

  if (now - lastArmAttempt < ARM_COOLDOWN_MS) return;
  lastArmAttempt = now;

  const wallets = await fetchJson(`${DEX}/wallets`);
  const tw = ((wallets?.wallets ?? []) as Array<Record<string, unknown>>).find((w) => w.name === 'treasury') as
    | { credits?: number; balances?: Record<string, number> }
    | undefined;
  const saos = tw?.balances?.SAOS ?? 0;
  const credits = tw?.credits ?? 0;

  const ops: Array<Record<string, unknown>> = [];
  if (!pos) {
    if (saos < VE_LOCK_MU) { log('arm-skip', `treasury SAOS ${saos}µ < ${VE_LOCK_MU}µ — honest hold (need deposit)`); return; }
    ops.push({ type: 've_lock', asset: 'SAOS', amount: VE_LOCK_MU, weeks: VE_WEEKS });
  }
  if (pos && !vote) ops.push({ type: 've_vote', pair: VOTE_POOL }); // עמדה-קיימת, הצבעה-נפלה
  if (ops.length === 0) return;
  if (credits < MIN_CREDITS) { log('arm-skip', `treasury credits ${credits} < ${MIN_CREDITS} — gas honest hold`); return; }

  if (!OP_TOKEN) { log('arm-fail', 'DEX_OPERATOR_TOKEN missing — fail-closed, cannot arm'); return; }
  const r = await fetchJson(`${DEX}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-saos-operator': OP_TOKEN, 'x-saos-dex-console': '1' },
    body: JSON.stringify({ issuer: 'treasury', ops }),
  }, 8000);
  if (r?.ok) {
    log('arm', `batch queued: ${ops.map((o) => String(o.type)).join('+')} — treasury ve earning stream armed`);
    emit('governor-action', { kind: 'arm', detail: ops.map((o) => String(o.type)).join('+'), ts: now });
  } else {
    const err = String((r as { error?: string })?.error ?? 'unreachable');
    log('arm-fail', `batch rejected: ${err}`);
    lastArmAttempt = now; // cooldown נאכף
  }
}

// ── FUEL: הזרקת-דלק-אוטונומית מגובה-עמלות-מדודות (roast-83) ─────────────────
async function fuelIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastFuelAttempt < FUEL_COOLDOWN_MS) return;
  const st = await fetchJson(`${DEX}/state`);
  if (!st) return; // דמון-לא-זמין — ה-tick ידווח כנה
  const s = (st.state ?? st) as Record<string, unknown>;
  const profit = Number(s.treasuryProfit ?? 0);
  const meter = Number(s.feeMeter ?? 0);
  const wl = await fetchJson(`${DEX}/wallets`);
  const list = (wl?.wallets ?? []) as Array<{ name?: string; credits?: number }>;
  const cOf = (n: string): number => Number(list.find((w) => w.name === n)?.credits ?? 0);
  const treC = cOf("treasury");
  const arC = cOf("arena");
  const needs: Array<{ to: string; want: number }> = [];
  if (treC < FUEL_TREASURY_FLOOR) needs.push({ to: "treasury", want: FUEL_TREASURY_FLOOR - treC });
  if (arC < FUEL_ARENA_FLOOR) needs.push({ to: "arena", want: FUEL_ARENA_TARGET - arC });
  if (needs.length === 0) return; // הכל-מפוזר — אין-פעולה
  const mintable = profit + Math.max(0, meter - LADDER_FUEL_FLOOR);
  let budget = Math.min(mintable, FUEL_MINT_CAP);
  if (budget < FUEL_MIN_MINT) {
    log("fuel-skip", `mintable ${Math.floor(mintable)}µ < ${FUEL_MIN_MINT}µ (profit ${profit}µ · meter ${meter}µ · floor ${LADDER_FUEL_FLOOR}) — honest hold until real fees`);
    lastFuelAttempt = now;
    return;
  }
  const ops: Array<Record<string, unknown>> = [];
  for (const n of needs) {
    const amt = Math.min(n.want, budget);
    if (amt < FUEL_MIN_MINT) break;
    const flat = Math.floor(amt);
    ops.push({ type: "mint_fuel", amount: flat, to: n.to });
    budget -= flat;
  }
  if (ops.length === 0) return;
  if (!OP_TOKEN) { log("fuel-fail", "DEX_OPERATOR_TOKEN missing — fail-closed, cannot fuel"); lastFuelAttempt = now; return; }
  const r = await fetchJson(`${DEX}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-saos-operator": OP_TOKEN, "x-saos-dex-console": "1" },
    body: JSON.stringify({ issuer: "treasury", ops }),
  }, 8000);
  lastFuelAttempt = Date.now();
  if (r?.ok) {
    const detail = ops.map((o) => `${o.amount}µ→${o.to}`).join(" + ");
    log("fuel", `mint_fuel queued: ${detail} (backed: profit ${profit}µ + meter ${meter}µ)`);
    emit("governor-action", { kind: "fuel", detail, ts: lastFuelAttempt });
  } else {
    log("fuel-fail", `batch rejected: ${String((r as { error?: string })?.error ?? "unreachable")}`);
  }
}

// ── WATCH: קציר-אפוק + דוח-הכנסות ────────────────────────────────────────────
function parseProm(text: string, key: string): number | null {
  const m = text.match(new RegExp(`^${key} ([0-9.eE+-]+)$`, 'm'));
  return m ? Number(m[1]) : null;
}

async function tick(): Promise<void> {
  ticks++;
  try {
    await fuelIfNeeded(); // Roast-83: דלק-לפני-הכל — בלי-זה-אף-מנוע-לא-מסתובב
    await armIfNeeded();

    const econ = await fetchJson(`${DEX}/economy`);
    if (!econ) { lastErr = 'dex-economy-unreachable'; return; }
    const h = Number(econ.height ?? 0);
    const epoch = (econ.epoch ?? {}) as { index?: number };
    const ve = (econ.ve ?? {}) as Record<string, unknown>;
    const revenue = (econ.revenue ?? {}) as Record<string, unknown>;
    const potMu = Number(ve.potMu ?? 0);
    const epIdx = Number(epoch.index ?? 0);

    const proto = await fetchJson(`${DEX}/protorev`);
    const protoState = (proto?.state ?? {}) as { runs?: number; profitMu?: number };

    let runwayHours: number | null = null;
    const metrics = await fetch(`${DEX}/metrics`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
    if (metrics) runwayHours = parseProm(metrics, 'saos_runway_hours');
    const halted = parseProm(metrics, 'saos_halted');

    if (lastEpoch >= 0 && epIdx !== lastEpoch) {
      // אפוק-התהפך — הקציר ≈ הקרן-שהייתה-לפני-הפליפ (ה-pot-הנוכחי = צבירה-חדשה)
      const harvested = Math.max(0, lastPotMu);
      const rep: Report = {
        ts: Date.now(), h, epoch: epIdx,
        potHarvestMu: harvested, potLeftMu: potMu,
        vePoints: Number(ve.totalPoints ?? 0), votePool: VOTE_POOL,
        treasuryProfitMu: Number(revenue.treasuryProfitMu ?? 0),
        burnedSaosMu: Number(revenue.burnedSaosMu ?? 0),
        feeMeterMu: 0, gasFundedMu: 0, // מושלמים-מה-state-מיד-להלן
        protorevProfitMu: protoState.profitMu ?? 0, protorevRuns: protoState.runs ?? 0,
      };
      // השלמת-שדות מה-state (feeMeter/gasFunded — מדידות-חיות)
      const st = await fetchJson(`${DEX}/state`);
      const income = (st?.income ?? {}) as Record<string, number>;
      rep.feeMeterMu = Number(income.feeMeterMu ?? 0);
      rep.gasFundedMu = Number((st as Record<string, unknown>).gasFundedMu ?? 0);
      reports.unshift(rep);
      if (reports.length > 48) reports.length = 48;
      emit('revenue-report', rep as unknown as Record<string, unknown>);
      log('report', `epoch ${epIdx}: pot harvested ~${rep.potHarvestMu}µ, left ${rep.potLeftMu}µ, burn Σ ${rep.burnedSaosMu}µ, protorev ${rep.protorevProfitMu}µ/${rep.protorevRuns} runs`);
    }
    lastEpoch = epIdx;
    lastPotMu = potMu;

    if (halted && halted > 0) emit('governor-action', { kind: 'halt', detail: `chain halted @h${h}`, ts: Date.now() });
    if (runwayHours !== null && runwayHours < 1) emit('governor-action', { kind: 'runway-crit', detail: `runway ${runwayHours}h @h${h}`, ts: Date.now() });
    lastErr = '';
  } catch (e) {
    lastErr = String(e).slice(0, 120);
  }
}

// ── STATUS (:3005) — לפלטפורמה ולסוכנים ──────────────────────────────────────
const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/status' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, service: 'revenue-governor', bootTs, uptimeSec: Math.floor((Date.now() - bootTs) / 1000),
      ticks, lastErr, lastEpoch, lastPotMu,
      veLockMu: VE_LOCK_MU, veWeeks: VE_WEEKS, votePool: VOTE_POOL,
      reports: reports.slice(0, 12), actions: actions.slice(0, 16),
    }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[governor] revenue-governor on 127.0.0.1:${PORT} — ve ${VE_LOCK_MU}µ × ${VE_WEEKS}w → ${VOTE_POOL}`);
});

// ── resilience (roast-79-e lesson) ───────────────────────────────────────────
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e).slice(0, 160)));
process.on('uncaughtException', (e) => log('uncaughtException', String(e).slice(0, 160)));

void tick();
setInterval(() => { void tick(); }, LOOP_MS);
log('boot', 'revenue-governor up — treasury earning streams under watch');
