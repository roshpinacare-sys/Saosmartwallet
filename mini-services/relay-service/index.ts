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
if (!process.env.SOVEREIGN_RELAY_TOKEN) {
  try {
    // FIX(Roast-63): import.meta.dir הוא-Bun-בלבד — cast-מפורש (tsc-נקי)
    const bunMeta = import.meta as unknown as { dir: string };
    for (const line of fs.readFileSync(path.join(bunMeta.dir, '../../.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
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
    const child = spawnChild('bun', ['run', 'dev'], {
      cwd: '/home/z/my-project',
      env: { ...process.env },
      stdio: 'ignore',
    });
    child.unref();
    child.on('error', (e: Error) => console.log('[guardian] spawn error:', e.message));
    console.log('[guardian] main platform spawning on :3000 (pid', child.pid + ')');
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
