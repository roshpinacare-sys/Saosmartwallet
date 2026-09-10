/**
 * ROAST round 7 — the consolidated LIVE SUITE.
 * The sandbox reaper silently kills the dev-server process group every few
 * minutes (re-proven live ×5 this round; environmental, documented since r2).
 * r5's workaround generalized: ONE bun process that (1) ensures a server is
 * up (spawns one if needed), (2) runs the full authenticated plane + fuzz +
 * editor-loop validation in that window, (3) revives the server if the reaper
 * strikes mid-run, (4) cleans up after itself. Every step prints honest state.
 */
import crypto from "crypto";
import { db } from "../src/lib/db";
import { sha256hex, randomToken } from "../src/lib/gate/crypto";

const BASE = "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function serverUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(6_000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await serverUp()) {
    console.log("server: already up");
    return;
  }
  console.log("server: down — spawning…");
  const { spawn } = await import("node:child_process");
  const proc = spawn("bun", ["run", "dev"], {
    cwd: "/home/z/my-project",
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  for (let i = 0; i < 12; i++) {
    await sleep(5_000);
    if (await serverUp()) {
      console.log(`server: up after ${(i + 1) * 5}s (pid ${proc.pid})`);
      return;
    }
  }
  throw new Error("server did not come up in 60s");
}

async function withToken(): Promise<string> {
  const token = randomToken(32);
  await db.gateSession.create({
    data: {
      tokenHash: sha256hex(token),
      kind: "operator",
      name: "operator",
      scopes: JSON.stringify(["*"]),
      encMaster: null,
      sealSalt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return token;
}

async function authPlane(token: string): Promise<void> {
  const H = { Cookie: `gate_session=${token}` };
  const page = await fetch(`${BASE}/`, { headers: H });
  const html = await page.text();
  console.log(`[auth] console page: ${page.status} · ${html.length} chars · chrome=${/כספת|מודולים/.test(html)}`);

  for (const path of ["/api/gate/status", "/api/gate/modules", "/api/gate/messages"]) {
    const r = await fetch(`${BASE}${path}`, { headers: H });
    console.log(`[auth] ${path}: ${r.status}`);
  }
  const heart = await fetch(`${BASE}/api/gate/heart`, { headers: H });
  const hj = (await heart.json()) as { ok?: boolean; counts?: { queued?: number } };
  console.log(`[auth] /heart: ${heart.status} ok=${hj.ok} queued=${hj.counts?.queued}`);

  const reveal = await fetch(`${BASE}/api/gate/reveal`, { headers: H, method: "POST", body: JSON.stringify({ id: "x" }) });
  console.log(`[auth] /reveal without master: ${reveal.status} (fail-closed expected)`);

  const fuzzes: Array<[string, string, string]> = [
    ["/api/gate/login", "POST", "{not-json"],
    ["/api/gate/login", "POST", JSON.stringify({ key: 5 })],
    ["/api/gate/login", "POST", JSON.stringify({ key: "x".repeat(100000) })],
    ["/api/gate/setup", "POST", JSON.stringify({ passphrase: "123" })],
    ["/api/vault/backup", "POST", "{broken"],
    ["/api/gate/run", "POST", JSON.stringify({})],
  ];
  for (const [path, method, body] of fuzzes) {
    const r = await fetch(`${BASE}${path}`, { headers: H, method, body });
    console.log(`[fuzz] ${method} ${path} (${body.length}b): ${r.status}`);
  }

  const lock = await fetch(`${BASE}/api/gate/lock`, { method: "POST", body: "{}" });
  const dk = await fetch(`${BASE}/api/developer/keys`);
  const du = await fetch(`${BASE}/api/developer/usage`);
  console.log(`[r6-closures] anon lock=${lock.status} devKeys=${dk.status} devUsage=${du.status} (expect 400/401/401)`);
}

async function editorValidation(): Promise<void> {
  const sched = await db.gateSchedule.findFirst({ where: { label: { startsWith: "editor:" }, enabled: true } });
  if (!sched) throw new Error("editor schedule missing");
  const busy = await db.gateRun.count({ where: { agentName: sched.agentName, status: { in: ["queued", "running"] } } });
  if (busy > 0) {
    console.log("[editor] an editor run is already active — following it instead of enqueuing a new one");
  } else {
    const run = await db.gateRun.create({
      data: {
        agentName: sched.agentName,
        goal: String(sched.goal || "").slice(0, 1200),
        doneMeans: String(sched.doneMeans || "[]"),
        modules: String(sched.modules || "[]"),
        brain: sched.brain || "zai:default",
        checker: "zai:default",
        budget: 8,
        status: "queued",
        origin: "schedule",
        meta: JSON.stringify({ scheduleId: sched.id, scheduleLabel: sched.label, validationNote: "roast-r7 consolidated live validation" }),
      },
    });
    console.log(`[editor] enqueued ${run.id}`);
  }

  const started = Date.now();
  while (Date.now() - started < 8 * 60_000) {
    await sleep(15_000);
    if (!(await serverUp())) {
      console.log(`[editor] ${Math.round((Date.now() - started) / 1000)}s — server DIED mid-run, reviving (the queue re-claims by design)`);
      await ensureServer();
      continue;
    }
    const cur = await db.gateRun.findFirst({
      where: { agentName: sched.agentName, status: { in: ["queued", "running", "done", "blocked", "failed"] }, meta: { contains: "validationNote" } },
      orderBy: { createdAt: "desc" },
    });
    if (!cur) continue;
    if (["done", "blocked", "failed"].includes(cur.status)) {
      console.log(`[editor] FINAL ${cur.status} after ${Math.round((Date.now() - started) / 1000)}s`);
      console.log(`[editor] report: ${String(cur.report || "(empty)").replace(/\n/g, " | ").slice(0, 800)}`);
      return;
    }
    console.log(`[editor] ${Math.round((Date.now() - started) / 1000)}s status=${cur.status}`);
  }
  console.log("[editor] timeout after 8min — run still in flight (5-min root-post pacing is legal; verify later)");
}

async function main() {
  console.log(`R7 LIVE SUITE @ ${new Date().toISOString()}`);
  await ensureServer();
  const token = await withToken();
  try {
    try {
      await authPlane(token);
    } catch (e) {
      console.log(`[auth] server died mid-plane (${e instanceof Error ? e.message : String(e)}) — reviving once and retrying`);
      await ensureServer();
      await authPlane(token);
    }
    await ensureServer();
    await editorValidation();
  } finally {
    await db.gateSession.delete({ where: { tokenHash: sha256hex(token) } }).catch(() => {});
    console.log("cleanup: test session revoked");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 600));
  process.exit(1);
});
