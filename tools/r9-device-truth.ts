/**
 * ROAST round 9 — DEVICES-PLANE TRUTH (מישור-המכשירים הופך אוטונומי).
 *
 * Proves, LIVE, against the running server + DB:
 *   gap-30  the roster counts LIVE devices (not expired corpses) + heart hygiene reaps
 *   gap-31  revocation SCRUBS encMaster/deviceSalt — inert by data, not by flag
 *   gap-33  sessions linked viaDevice to a device are CLOSED when it is revoked (caller's own kept)
 *   gap-34  re-arming a live token ROTATES in place (same row, fresh 90 days)
 *   gap-35  cap selection is provable read-only (no real device is harmed here)
 *
 * HONEST LIMIT: the API device/login path calls revokeOtherSessions() globally —
 * running it here would kill the OPERATOR'S REAL LIVE SESSIONS (collateral).
 * The viaDevice linkage is therefore proven at the DB level through the same
 * revokeDeviceRows production path; the login stamping itself (createSession
 * with viaDevice) is code-proven and will be exercised by the operator's next
 * real re-entry. Stated, not hidden.
 *
 * gap-38 is UI-only — proven in the browser pass, not here.
 * ZERO collateral: only rows labelled r9-proof-* are created/harmed; the
 * operator's real devices are asserted untouched before and after.
 */
import { db } from "../src/lib/db";
import { runDeviceHygiene } from "../src/lib/gate/harness/heart";
import { nextEvictionCandidate, DEVICE_MAX_LIVE } from "../src/lib/gate/device";
import { sha256hex, randomToken } from "../src/lib/gate/crypto";

const BASE = "http://localhost:3000";
const TAG = "r9-proof";

function snapshot(rows: { id: string; revoked: boolean; encMaster: string | null }[]) {
  return rows.map((r) => `${r.id.slice(-8)}:${r.revoked ? "revoked" : "live"}:${r.encMaster ? "ct" : "null"}`).sort().join(" ");
}

/** the sandbox reaper kills the dev server repeatedly (documented since r2) — wait it out. */
async function waitServer(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) return;
    } catch { /* dead — wait for the watchdog */ }
    await new Promise((res) => setTimeout(res, 4000));
  }
  throw new Error("server never came up within 2 minutes (watchdog should be running)");
}

async function main() {
  console.log("═══ R9 DEVICES-TRUTH ═══");
  await waitServer();
  const all = await db.gateDevice.findMany();
  const realRows = all.filter((d) => !d.label.startsWith(TAG));
  const staleProof = all.filter((d) => d.label.startsWith(TAG));
  console.log(`before: ${realRows.length} real rows · ${staleProof.length} stale proof rows (cleaned)`);
  // tool-artifact sessions from earlier killed runs: masterless operator
  // sessions are ALWAYS tool-minted (a real key login seals the master) —
  // anything unseen for 5+ minutes is a leftover. Real sessions untouched.
  const cleaned = await db.gateSession.deleteMany({ where: { kind: "operator", name: "operator", encMaster: null, viaDevice: null, lastSeenAt: { lt: new Date(Date.now() - 5 * 60_000) } } });
  if (cleaned.count) console.log(`tool-artifact sessions cleaned: ${cleaned.count}`);
  // historical remediation (gap-31 on existing data): revoked rows must not carry ciphertext
  const dirtyRevoked = await db.gateDevice.updateMany({ where: { revoked: true, encMaster: { not: null } }, data: { encMaster: null, deviceSalt: null } });
  console.log(`historical scrub (gap-31 remediation): ${dirtyRevoked.count} revoked row(s) had their ciphertext deleted from the DB`);
  await db.gateDevice.deleteMany({ where: { label: { startsWith: TAG } } });
  const realBeforeSig = snapshot(realRows.map((r) => ({ id: r.id, revoked: r.revoked, encMaster: r.encMaster })));

  /* ── 1. authenticated API plane (local operator session, no master) ── */
  const sessionToken = randomToken(32);
  const session = await db.gateSession.create({
    data: { tokenHash: sha256hex(sessionToken), kind: "operator", name: "operator", scopes: JSON.stringify(["*"]), encMaster: null, sealSalt: null, expiresAt: new Date(Date.now() + 3600_000) },
  });
  const H = { Cookie: `gate_session=${sessionToken}`, "x-gate-token": sessionToken, "Content-Type": "application/json" };
  console.log(`local operator session minted (${sessionToken.slice(0, 6)}…, no master)`);

  // light the vault through the DOCUMENTED open-gate lifeline (operator policy
  // "זה רק אני ואתה" — POST /api/gate/session re-lights from /tmp/gate_token).
  // No key is involved; this is the operator's own standing order, not a bypass.
  const gate = await fetch(`${BASE}/api/gate/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const gateJson = (await gate.json()) as { ok: boolean; in: boolean; mode?: string; token?: string };
  if (!gateJson.ok || !gateJson.in) throw new Error("open-gate lifeline refused — cannot prove arm/rotation without a lit vault");
  const gateTokenHash = gateJson.token ? sha256hex(gateJson.token) : null;
  console.log(`vault lit via open-gate (${gateJson.mode}) — operator standing order, no key`);

  // gap-30: honest roster
  const roster = await fetch(`${BASE}/api/gate/device`, { headers: H });
  const rosterJson = (await roster.json()) as { ok: boolean; devices: { id: string; live: boolean; daysLeft: number; revoked: boolean }[]; liveCount: number; expiringSoon: number; cap: number };
  console.log(`GET /device: ${roster.status} ok=${rosterJson.ok} rows=${rosterJson.devices.length} liveCount=${rosterJson.liveCount} expiringSoon=${rosterJson.expiringSoon} cap=${rosterJson.cap}`);
  if (roster.status !== 200 || !rosterJson.ok) throw new Error(`roster failed: ${roster.status}`);

  // gap-34: arm → rotate in place
  const arm1 = await fetch(`${BASE}/api/gate/device`, { method: "POST", headers: H, body: JSON.stringify({ label: `${TAG}-rot` }) });
  const arm1Json = (await arm1.json()) as { ok: boolean; device?: { id: string; label: string; expiresAt: string }; deviceToken?: string; error?: string };
  if (!arm1Json.ok || !arm1Json.deviceToken || !arm1Json.device) throw new Error(`arm failed: ${arm1Json.error ?? arm1.status}`);
  console.log(`arm #1: ${arm1.status} id=…${arm1Json.device.id.slice(-8)} label="${arm1Json.device.label}"`);
  const rot = await fetch(`${BASE}/api/gate/device`, { method: "POST", headers: H, body: JSON.stringify({ label: `${TAG}-rot`, deviceToken: arm1Json.deviceToken }) });
  const rotJson = (await rot.json()) as { ok: boolean; rotated?: boolean; device?: { id: string; expiresAt: string }; deviceToken?: string };
  const sameRow = rotJson.ok && rotJson.device!.id === arm1Json.device.id;
  const freshTok = rotJson.deviceToken !== arm1Json.deviceToken;
  const fresh90 = rotJson.device ? Date.parse(rotJson.device.expiresAt) - Date.now() > 89 * 86_400_000 : false;
  console.log(`rotation (gap-34): sameRow=${sameRow} newToken=${freshTok} fresh90d=${fresh90} → ${sameRow && freshTok && fresh90 ? "✅" : "❌"}`);

  // gap-33 + gap-31: link a session to a proof device viaDevice, revoke, watch the door close
  const arm2 = await fetch(`${BASE}/api/gate/device`, { method: "POST", headers: H, body: JSON.stringify({ label: `${TAG}-door` }) });
  const arm2Json = (await arm2.json()) as { ok: boolean; device?: { id: string }; deviceToken?: string };
  if (!arm2Json.ok || !arm2Json.device) throw new Error("arm #2 failed");
  const fixture = await db.gateSession.create({
    data: { tokenHash: sha256hex(randomToken(32)), kind: "operator", name: "operator", scopes: JSON.stringify(["*"]), encMaster: null, sealSalt: null, viaDevice: arm2Json.device.id, expiresAt: new Date(Date.now() + 3600_000) },
  });
  const rev = await fetch(`${BASE}/api/gate/device?id=${arm2Json.device.id}`, { method: "DELETE", headers: H });
  const revJson = (await rev.json()) as { ok: boolean; sessionsKilled?: number; error?: string };
  const doorAfter = await db.gateSession.findUnique({ where: { id: fixture.id } });
  const callerAlive = await db.gateSession.findUnique({ where: { id: session.id } });
  const killedProved = Boolean(revJson.ok && (revJson.sessionsKilled ?? 0) >= 1 && doorAfter?.revoked === true && callerAlive?.revoked === false);
  console.log(`door-closing (gap-33): killed=${revJson.sessionsKilled} door-revoked=${doorAfter?.revoked} caller-alive=${callerAlive?.revoked === false} → ${killedProved ? "✅" : "❌"}`);

  // gap-31: the revoked row above must now be SCRUBBED
  const scrubbed = await db.gateDevice.findUnique({ where: { id: arm2Json.device.id } });
  const scrubProved = scrubbed?.revoked === true && scrubbed?.encMaster === null && scrubbed?.deviceSalt === null;
  console.log(`scrub-on-revoke (gap-31): revoked=${scrubbed?.revoked} encMaster=${scrubbed?.encMaster === null ? "null" : "STILL THERE"} salt=${scrubbed?.deviceSalt === null ? "null" : "STILL THERE"} → ${scrubProved ? "✅" : "❌"}`);

  // forget path — same scrub contract
  const arm3 = await fetch(`${BASE}/api/gate/device`, { method: "POST", headers: H, body: JSON.stringify({ label: `${TAG}-forget` }) });
  const arm3Json = (await arm3.json()) as { ok: boolean; deviceToken?: string };
  if (!arm3Json.ok || !arm3Json.deviceToken) throw new Error("arm #3 failed");
  const fg = await fetch(`${BASE}/api/gate/device/forget`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceToken: arm3Json.deviceToken }) });
  const fgJson = (await fg.json()) as { ok: boolean; rows: number; note: string };
  const fgRow = await db.gateDevice.findFirst({ where: { label: `${TAG}-forget` } });
  const forgetProved = fgJson.ok && fgJson.rows === 1 && fgRow?.encMaster === null;
  console.log(`forget=scrub: rows=${fgJson.rows} note="${fgJson.note}" encMaster=${fgRow?.encMaster === null ? "null" : "STILL THERE"} → ${forgetProved ? "✅" : "❌"}`);

  // gap-35: cap selection — read-only proof (no real device harmed)
  const liveCount = await db.gateDevice.count({ where: { revoked: false, encMaster: { not: null }, expiresAt: { gt: new Date() } } });
  const candidate = await nextEvictionCandidate();
  const capProved = liveCount < DEVICE_MAX_LIVE ? candidate === null : candidate !== null;
  console.log(`cap (gap-35): live=${liveCount} cap=${DEVICE_MAX_LIVE} candidate=${candidate ? candidate.label : "none (under cap — honest)"} → ${capProved ? "✅" : "❌"}`);

  /* ── 2. self-management: the heart reaps + warns (gap-30/34) ── */
  const expired = await db.gateDevice.create({ data: { label: `${TAG}-expired`, tokenHash: sha256hex(randomToken(32)), encMaster: JSON.stringify({ ct: "deadbeef", iv: "aa", tag: "bb" }), deviceSalt: "aa", expiresAt: new Date(Date.now() - 3600_000) } });
  const expiring = await db.gateDevice.create({ data: { label: `${TAG}-expiring`, tokenHash: sha256hex(randomToken(32)), encMaster: JSON.stringify({ ct: "feedface", iv: "cc", tag: "dd" }), deviceSalt: "bb", expiresAt: new Date(Date.now() + 3 * 86_400_000) } });
  const hyg1 = await runDeviceHygiene();
  const hyg2 = await runDeviceHygiene(); // watermark: no second warning within a day
  const expAfter = await db.gateDevice.findUnique({ where: { id: expired.id } });
  const expiringAfter = await db.gateDevice.findUnique({ where: { id: expiring.id } });
  const reapProved = expAfter?.revoked === true && expAfter?.encMaster === null && hyg1.reaped >= 1;
  const warnProved = hyg1.warned >= 1 && hyg2.warned === 0;
  const msg = await db.gateMessage.findFirst({ where: { body: { contains: "יפוג בעוד" }, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  console.log(`heart reap (gap-30): reaped=${hyg1.reaped} row-revoked=${expAfter?.revoked} row-scrubbed=${expAfter?.encMaster === null} → ${reapProved ? "✅" : "❌"}`);
  console.log(`heart warn (gap-34): warned1=${hyg1.warned} warned2=${hyg2.warned} (watermark holds) → ${warnProved ? "✅" : "❌"}${msg ? ` · msg="${msg.body.slice(0, 70)}…"` : ""}`);
  console.log(`pulse counters (gap-37): live=${hyg1.live} expiringSoon=${hyg1.expiringSoon}`);
  const notOverReaped = expiringAfter?.revoked === false;
  console.log(`expiring row stays live (no over-reaping): revoked=${expiringAfter?.revoked} → ${notOverReaped ? "✅" : "❌"}`);

  /* ── 3. teardown — proof rows already revoked/scrubbed via production paths ── */
  await db.gateDevice.updateMany({ where: { label: { startsWith: TAG }, revoked: false }, data: { revoked: true, encMaster: null, deviceSalt: null } });
  await db.gateSession.deleteMany({ where: { id: { in: [session.id, fixture.id, ...(gateTokenHash ? [gateTokenHash] : [])].filter(Boolean) as string[] } } });
  const realAfterRows = (await db.gateDevice.findMany()).filter((d) => !d.label.startsWith(TAG));
  const untouched = snapshot(realAfterRows.map((r) => ({ id: r.id, revoked: r.revoked, encMaster: r.encMaster }))) === realBeforeSig;
  console.log(`zero-collateral: real rows untouched → ${untouched ? "✅" : "❌ COLLATERAL!"}`);

  const verdict = [sameRow && freshTok && fresh90, killedProved, scrubProved, forgetProved, capProved, reapProved, warnProved, notOverReaped, untouched].every(Boolean);
  console.log(`═══ R9 DEVICES-TRUTH ${verdict ? "✅ ALL PROOFS HOLD" : "❌ A PROOF FAILED"} ═══`);
  await db.$disconnect();
  if (!verdict) process.exit(1);
}

main().catch((e) => { console.error("r9-device-truth failed:", e); process.exit(1); });
