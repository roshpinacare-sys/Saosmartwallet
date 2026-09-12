// flow-autopilot (Task 71-h) — המנוע-האוטונומי של-מנוע-הזרימה
// ═════════════════════════════════════════════════════════════════════════════
// תפקיד: להריץ את-לולאות-הזרימה-בעצמו — בלי-לחיצות-מפעיל:
//   תביעה (STEEM/HIVE) → קיוריישן (STEEM/HIVE/BLURT · משקל-מהקונפיג) →
//   הצבעה-עצמית (100% על הפוסט-שלנו בחלון-התגמול) → פרסום-דוח-טלמטריה-חי.
// כל-פעולה עוברת דרך /api/saos/flow של-הפלטפורמה — אותו-אימות, אותו-ביקורת,
// אותו-ריליי. אין-חתימות-כאן: השירות רק מחליט מתי-מה-ובאיזה-משקל.
//
// אמת: אותות-טריים מ-flow/autopilot_signals (בלי-מטמון) · שום-מספר-לא-מומצא.
// סודות: מפתח-האב (headcorner.txt שורה-2) עובר בזיכרון-בלבד → סשן-owner;
// אף-ערך-סודי לא נכתב לדיסק ולא מודפס. state-בלבד (בלי-סודות) ב-data/.
//
// בקרות-בטיחות: VP-גאט (≥90% לקיוריישן, ≥85% להצבעה-עצמית) · מרווח-3h-בין-הצבעות-לשרשרת ·
// דה-דופ-voted-מהשרשרת · מרווח-פרסום-24h (וגם-20h-בשרת) · fail-honest בכל-כישלון.

import { createServer } from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3020;
const FLOW_URL = 'http://127.0.0.1:3000/api/saos/flow';
const LOGIN_URL = 'http://127.0.0.1:3000/api/vault/login';
const ONCE = process.env.AUTOPILOT_ONCE === '1';

const meta = import.meta as unknown as { dir: string };
const ROOT = path.join(meta.dir, '..', '..');
const KEY_FILE = path.join(ROOT, 'upload', 'headcorner.txt');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'autopilot-state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'autopilot-config.json');
const LOG_FILE = path.join(meta.dir, 'autopilot.log');

interface AutopilotConfig {
  enabled: boolean;
  intervalMin: number;   // 15-720
  weightPct: number;     // STEEM curation weight 0.1-100
  hiveWeightPct: number; // 0 = off
  blurtWeightPct: number;// 0 = off
  selfvoteEnabled: boolean;
  publishEnabled: boolean;
}
const DEFAULTS: AutopilotConfig = {
  enabled: true, intervalMin: 60, weightPct: 10,
  hiveWeightPct: 1, blurtWeightPct: 1, selfvoteEnabled: true, publishEnabled: true,
};

interface Signals {
  ok?: boolean;
  steem?: { vpPct?: number | null; rcPct?: number | null; claimable?: { steem: number; sbd: number; vests: number } | null };
  latestPost?: { permlink: string; title: string; created: string; ageH: number; hasSelfVote: boolean; pendingSbd: number } | null;
  hive?: { vpPct?: number | null; claimable?: number | null };
  blurt?: { vpPct?: number | null; claimable?: number | null };
}

interface Action { ts: number; kind: string; detail: string }
interface State {
  ok: true; service: 'flow-autopilot'; bootTs: number;
  enabled: boolean; cycles: number;
  lastCycleAt: number | null; nextCycleAt: number | null;
  intervalMin: number; weightPct: number;
  voteAt: Record<string, number>;
  totals: { claims: number; votes: number; selfvotes: number; publishes: number };
  lastActions: Action[]; errors: Action[];
}

const bootTs = Date.now();
let token: string | null = null;
let state: State = {
  ok: true, service: 'flow-autopilot', bootTs,
  enabled: true, cycles: 0,
  lastCycleAt: null, nextCycleAt: null,
  intervalMin: DEFAULTS.intervalMin, weightPct: DEFAULTS.weightPct,
  voteAt: {},
  totals: { claims: 0, votes: 0, selfvotes: 0, publishes: 0 },
  lastActions: [], errors: [],
};
let running = false;

// FIX(71-h, measured live): in-memory voteAt was lost on restart — the very first
// boot cycle re-voted (new candidates, no spacing). Restore persisted counters +
// vote spacing from the state file at boot; identity = same machine, same purpose.
try {
  const prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<State>;
  if (prev && prev.service === 'flow-autopilot') {
    state.cycles = Number(prev.cycles ?? 0);
    state.voteAt = { ...(prev.voteAt ?? {}) };
    state.totals = { claims: 0, votes: 0, selfvotes: 0, publishes: 0, ...(prev.totals ?? {}) };
    state.lastActions = (prev.lastActions ?? []).slice(0, 30);
    state.errors = (prev.errors ?? []).slice(0, 12);
    log('boot', `state restored — cycles=${state.cycles} voteAt entries=${Object.keys(state.voteAt).length}`);
  }
} catch { /* fresh boot — honest */ }

function log(kind: string, detail: string): void {
  const a: Action = { ts: Date.now(), kind, detail: detail.slice(0, 220) };
  state.lastActions.unshift(a);
  if (state.lastActions.length > 30) state.lastActions.length = 30;
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(a) + '\n'); } catch { /* log optional */ }
}
function err(kind: string, detail: string): void {
  const a: Action = { ts: Date.now(), kind, detail: detail.slice(0, 220) };
  state.errors.unshift(a);
  if (state.errors.length > 12) state.errors.length = 12;
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(a) + '\n'); } catch { /* */ }
}
function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  } catch (e) { err('persist-fail', String(e).slice(0, 120)); }
}

function readConfig(): AutopilotConfig {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<AutopilotConfig>;
    const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    };
    return {
      enabled: typeof j.enabled === 'boolean' ? j.enabled : DEFAULTS.enabled,
      intervalMin: clamp(j.intervalMin, 15, 720, DEFAULTS.intervalMin),
      weightPct: clamp(j.weightPct, 0.1, 100, DEFAULTS.weightPct),
      hiveWeightPct: clamp(j.hiveWeightPct, 0, 100, DEFAULTS.hiveWeightPct),
      blurtWeightPct: clamp(j.blurtWeightPct, 0, 100, DEFAULTS.blurtWeightPct),
      selfvoteEnabled: typeof j.selfvoteEnabled === 'boolean' ? j.selfvoteEnabled : DEFAULTS.selfvoteEnabled,
      publishEnabled: typeof j.publishEnabled === 'boolean' ? j.publishEnabled : DEFAULTS.publishEnabled,
    };
  } catch { return { ...DEFAULTS }; }
}

// ── auth: master-key → owner-session (same fast path as the operator console) ──
async function login(): Promise<boolean> {
  let wif = '';
  try {
    const lines = fs.readFileSync(KEY_FILE, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) { err('login', 'key file empty — fail-closed'); return false; }
    wif = lines[lines.length - 1]; // line 2 = master key (line 1 = label)
  } catch (e) { err('login', `key file unreadable: ${String(e).slice(0, 80)}`); return false; }
  try {
    const r = await fetch(LOGIN_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wif }), signal: AbortSignal.timeout(20000),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; token?: string; master?: boolean };
    if (j.ok && j.token) {
      token = j.token;
      log('login', `owner session granted (master-agreement, master=${String(!!j.master)}) — token kept in memory only`);
      return true;
    }
    err('login', `login rejected (${r.status}) — fail-closed`);
    return false;
  } catch (e) { err('login', String(e).slice(0, 120)); return false; }
  finally { wif = ''; token = token ?? null; }
}

async function flowPost(action: string, params: Record<string, unknown>, execute: boolean): Promise<Record<string, unknown> | null> {
  const call = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (execute && token) headers.authorization = `Bearer ${token}`;
    return fetch(FLOW_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ action, execute, params }), signal: AbortSignal.timeout(90000),
    });
  };
  let r = await call();
  if (r.status === 401 && execute) { // session expired — re-login once, retry once
    if (await login()) r = await call();
  }
  try { return (await r.json()) as Record<string, unknown>; }
  catch { return null; }
}

async function getSignals(): Promise<Signals | null> {
  try {
    const r = await fetch(FLOW_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'autopilot_signals', execute: false, params: {} }),
      signal: AbortSignal.timeout(60000),
    });
    return (await r.json()) as Signals;
  } catch { return null; }
}

// ── cycle steps (each independent, each fail-honest) ─────────────────────────
async function stepClaim(chain: 'steem' | 'hive', s: Signals): Promise<void> {
  const claimable = chain === 'steem'
    ? (s.steem?.claimable ? (s.steem.claimable.steem + s.steem.claimable.sbd + s.steem.claimable.vests) : null)
    : (s.hive?.claimable ?? null);
  if (claimable === null) { err(`claim-${chain}`, 'signals missing claimable — honest skip'); return; }
  if (claimable <= 0) { log(`claim-${chain}`, 'nothing claimable (honest zero)'); return; }
  const res = await flowPost(`${chain}_claim`, {}, true);
  if (res && res.ok) {
    const claimed = String((res.result as { claimed?: string })?.claimed ?? 'ok');
    state.totals.claims += 1;
    log(`claim-${chain}`, `claimed: ${claimed}`);
  } else {
    err(`claim-${chain}`, String(res?.error ?? 'no-response'));
  }
}

async function stepVote(chain: 'steem' | 'hive' | 'blurt', weightPct: number, vpPct: number | null | undefined, action: string): Promise<void> {
  if (weightPct <= 0) return;
  if (vpPct === null || vpPct === undefined) { err(`vote-${chain}`, 'VP unknown — honest skip (fail-closed on mana)'); return; }
  if (vpPct < 90) { log(`vote-${chain}`, `VP ${vpPct.toFixed(1)}% < 90 — regenerating, honest skip`); return; }
  const since = Date.now() - (state.voteAt[chain] ?? 0);
  if (since < 3 * 3600_000) return; // 3h spacing per chain
  const pick = await flowPost('autovote_pick', { chain }, false);
  const cands = (pick?.candidates ?? []) as Array<{ author: string; permlink: string; ageH: number; title: string; voted: boolean }>;
  const cand = cands.find((c) => !c.voted && c.author && c.permlink);
  if (!cand) { log(`vote-${chain}`, 'no fresh un-voted candidate (trending 1-18h) — honest skip'); return; }
  const res = await flowPost(action, { author: cand.author, permlink: cand.permlink, weightPct }, true);
  if (res && res.ok) {
    state.voteAt[chain] = Date.now();
    state.totals.votes += 1;
    log(`vote-${chain}`, `voted @${cand.author}/${cand.permlink.slice(0, 70)} weight=${weightPct}% (age ${cand.ageH.toFixed(0)}h)`);
  } else {
    err(`vote-${chain}`, `@${cand.author}: ${String(res?.error ?? 'no-response')}`);
  }
}

async function stepSelfvote(s: Signals): Promise<void> {
  const p = s.latestPost;
  if (!p) { log('selfvote', 'no root post — honest skip'); return; }
  if (p.hasSelfVote) { log('selfvote', 'already self-voted (chain truth) — skip'); return; }
  if (p.ageH < 0.5 || p.ageH > 168) { log('selfvote', `age ${p.ageH}h outside payout window — skip`); return; }
  if ((s.steem?.vpPct ?? 0) < 85) { log('selfvote', `VP ${(s.steem?.vpPct ?? 0).toFixed(1)}% < 85 — skip`); return; }
  const res = await flowPost('steem_selfvote', { weightPct: 100 }, true);
  if (res && res.ok) {
    state.totals.selfvotes += 1;
    log('selfvote', `self-voted 100% on ${p.permlink.slice(0, 44)} — dual-return locked`);
  } else {
    err('selfvote', String(res?.error ?? 'no-response'));
  }
}

async function stepPublish(s: Signals): Promise<void> {
  const p = s.latestPost;
  if (p && p.ageH < 24) { log('publish', `last post age ${p.ageH}h < 24h — honest skip (anti-spam)`); return; }
  const res = await flowPost('steem_publish', {}, true); // server builds the live-telemetry report
  if (res && res.ok) {
    const permlink = String((res.result as { permlink?: string })?.permlink ?? 'flow-report');
    state.totals.publishes += 1;
    log('publish', `published ${permlink} — live telemetry report on-chain`);
  } else {
    err('publish', String(res?.error ?? 'no-response'));
  }
}

// ── one cycle ────────────────────────────────────────────────────────────────
async function cycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cfg = readConfig();
    state.enabled = cfg.enabled;
    state.intervalMin = cfg.intervalMin;
    state.weightPct = cfg.weightPct;
    if (!cfg.enabled) {
      state.lastCycleAt = Date.now();
      state.nextCycleAt = state.lastCycleAt + cfg.intervalMin * 60_000;
      log('cycle', 'disabled by operator config — heartbeat only');
      persist();
      return;
    }
    if (!token) await login();
    if (!token) {
      err('cycle', 'no owner session — cycle aborted (fail-closed)');
      state.nextCycleAt = Date.now() + 5 * 60_000; // short backoff, then retry auth
      persist(); return;
    }

    const s = await getSignals();
    if (!s || !s.ok) {
      err('cycle', 'signals unavailable — honest skip of this cycle');
      state.lastCycleAt = Date.now();
      state.nextCycleAt = state.lastCycleAt + 5 * 60_000; // short backoff on RPC failure
      persist(); return;
    }

    await stepClaim('steem', s);
    await stepClaim('hive', s);
    await stepVote('steem', cfg.weightPct, s.steem?.vpPct, 'steem_vote');
    await stepVote('hive', cfg.hiveWeightPct, s.hive?.vpPct, 'hive_vote');
    await stepVote('blurt', cfg.blurtWeightPct, s.blurt?.vpPct, 'blurt_vote');
    await stepSelfvote(s);
    await stepPublish(s);

    state.cycles += 1;
    state.lastCycleAt = Date.now();
    state.nextCycleAt = state.lastCycleAt + cfg.intervalMin * 60_000;
    log('cycle', `#${state.cycles} done — claims=${state.totals.claims} votes=${state.totals.votes} selfvotes=${state.totals.selfvotes} publishes=${state.totals.publishes}`);
    persist();
  } catch (e) {
    err('cycle', String(e).slice(0, 200));
    state.nextCycleAt = Date.now() + 5 * 60_000;
    persist();
  } finally {
    running = false;
  }
}

// ── status server (:3020) — state only, no secrets ───────────────────────────
const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/status' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[flow-autopilot] on 127.0.0.1:${PORT} — claim→curation→selfvote→publish, every ${state.intervalMin}min`);
});

process.on('unhandledRejection', (e) => { err('unhandledRejection', String(e).slice(0, 160)); persist(); });
process.on('uncaughtException', (e) => { err('uncaughtException', String(e).slice(0, 160)); persist(); });

void cycle();
if (!ONCE) {
  // due-gate: the minute tick only fires a cycle when intervalMin has elapsed
  setInterval(() => {
    const due = state.nextCycleAt === null || Date.now() >= state.nextCycleAt;
    if (due) void cycle();
  }, 60_000);
}
