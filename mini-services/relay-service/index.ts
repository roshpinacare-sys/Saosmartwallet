// Sovereign Relay — realtime event bus (socket.io) for the operator UI.
// Browser connects via /?XTransformPort=3003 (Caddy) — path must stay '/'.
// Next.js API routes push events to the INTERNAL admin port 3004 (/emit).
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
// FIX(Roast-63 · L3): fs-היה-בשימוש-לפני-הייבוא-שלו (עבד-רק-בזכות-ESM-hoisting — מוקש-TDZ)
try { fs.writeFileSync('/tmp/relay-hot-probe', new Date().toISOString()) } catch {}
import { Server } from 'socket.io';

// Load project root .env (mini-service has its own cwd)
// FIX(Roast-66 · env-allowlist-parity): היה — טעינת-**כל**-ה-.env ל-process.env של
// התהליך-הזה, כולל SOVEREIGN_VAULT_SECRET (מפתח-ה-AES של-הכספת!) — הפרה-ישירה
// של-הצהרת-65-b-M5 ("רק-למותר") שכן-כאן-נשכחה. עכשיו: allowlist-דני-ברירת-מחדל —
// רק-מה-שהתהליך-באמת-צורך (SOVEREIGN_RELAY_TOKEN). וגם-פרסר-קצת-מודע-יותר (מרכאות/הערות).
if (!process.env.SOVEREIGN_RELAY_TOKEN) {
  try {
    // FIX(Roast-63): import.meta.dir הוא-Bun-בלבד — cast-מפורש (tsc-נקי)
    const bunMeta = import.meta as unknown as { dir: string };
    const ALLOWED = new Set(['SOVEREIGN_RELAY_TOKEN']);
    for (const line of fs.readFileSync(path.join(bunMeta.dir, '../../.env'), 'utf8').split('\n')) {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) continue;
      const m = raw.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || !m[1]) continue;
      const v = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)$/, '$1');
      if (m[1] && ALLOWED.has(m[1]) && !process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* .env optional */ }
}

const PUBLIC_PORT = 3003; // socket.io for browser (via Caddy XTransformPort)
const ADMIN_PORT = 3004; // internal emit endpoint (server-to-server only)
const RELAY_TOKEN = process.env.SOVEREIGN_RELAY_TOKEN || '';

const io = new Server(createServer(), {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on('connection', (socket) => {
  console.log('[relay] client connected', socket.id);
  socket.emit('hello', { service: 'sovereign-relay', ts: Date.now() });
  socket.on('disconnect', () => console.log('[relay] client disconnected', socket.id));
});


// ─── guardian_boot — keep the main platform (:3000) alive ───────────────────
// This mini-service is orphan-adopted by init at container boot, so its process
// tree SURVIVES shell-command reaping. The main dev server does not have that
// privilege: every shell-spawned instance is reaped when its command exits.
// Fix: spawn it from HERE (idempotent, port-checked) and re-check every 30s —
// a real watchdog so "the platform is down" can never happen silently again.
import { spawn as spawnChild } from 'node:child_process';
import net from 'node:net';

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port });
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), 900).unref?.();
  });
}

async function guardianBoot(): Promise<void> {
  try {
    if (await portBusy(3000)) return;
    // FIX(Roast-66 · spawn-env-minimal): היה — env: {...process.env} — כל-סביבת
    // ההורה (כולל-כל-מה-שנטען-מה-.env) זלגה-לילד. Next.js טוען-את-.env-שלו-בעצמו —
    // הילד-צריך-רק-בסיס. סודות-לא-נכללים-כלל (allow-list במקום deny-list).
    // FIX(Task 72 · types): @types/node-חדש מחייב NODE_ENV ב-ProcessEnv.
    const childEnv: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TERM: process.env.TERM,
      LANG: process.env.LANG,
      TMPDIR: process.env.TMPDIR,
    };
    // FIX(Roast-66 · spawn-stdio+verify): היה — stdio:'ignore' + אפס-אימות-שגר
    // (דפוס-65-b-M6-הישן: EADDRINUSE/קריסות-שגר שותקות; TOCTOU probe→bind).
    // עכשיו: stdout/stderr → קובץ-לוג (0600) + poll-אימות-עד-90ש׳ עם-פסק-כן.
    let logFd: number;
    try { logFd = fs.openSync('/home/z/my-project/guardian-spawn.log', 'a', 0o600); }
    catch { logFd = fs.openSync('/dev/null', 'a'); }
    const child = spawnChild('bun', ['run', 'dev'], {
      cwd: '/home/z/my-project',
      env: childEnv,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    child.on('error', (e: Error) => console.log('[guardian] spawn error:', e.message));
    console.log('[guardian] main platform spawning on :3000 (pid', child.pid + ')');
    void (async () => {
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (child.killed) return;
        if (await portBusy(3000)) {
          console.log(`[guardian] launch-verified: main platform responding on :3000 (after ~${(i + 1) * 2}s)`);
          return;
        }
      }
      console.log('[guardian] launch-verification FAILED: port 3000 did not come up in 90s — inspect /home/z/my-project/guardian-spawn.log');
    })();
  } catch (e) {
    console.log('[guardian] boot skipped:', e instanceof Error ? e.message : e);
  }
}
void guardianBoot();
setInterval(() => { void guardianBoot(); }, 30_000).unref?.();
// ────────────────────────────────────────────────────────────────────────────

// FIX(Roast-63 · M9): loopback-בלבד — הדפדפן-מגיע-דרך-Caddy-בלבד
io.httpServer?.listen(PUBLIC_PORT, '127.0.0.1', () => console.log(`[relay] socket.io on :${PUBLIC_PORT} (loopback)`));

// internal admin server — broadcast endpoint
const admin = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/emit') {
    if (!RELAY_TOKEN || req.headers['x-relay-token'] !== RELAY_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const { event, payload } = JSON.parse(body);
        if (typeof event !== 'string' || !event) throw new Error('bad event');
        io.emit(event, payload ?? {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 100) }));
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});
admin.listen(ADMIN_PORT, '127.0.0.1', () => console.log(`[relay] admin emit on 127.0.0.1:${ADMIN_PORT}`));
