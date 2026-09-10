/**
 * ROAST round 9 — LIVE forensics of the devices plane (מישור-המכשירים).
 * Read-only probe: what does the DB actually hold vs what the UI claims.
 */
import { db } from "../src/lib/db";

async function main() {
  const now = Date.now();
  const devices = await db.gateDevice.findMany({ orderBy: { createdAt: "desc" } });
  console.log(`=== GateDevice: ${devices.length} rows total ===`);
  for (const d of devices) {
    const expired = d.expiresAt.getTime() < now;
    const state = d.revoked ? "REVOKED" : expired ? "EXPIRED-not-revoked" : "LIVE";
    console.log(
      `- ${d.id.slice(-8)} "${d.label}" · ${state} · created ${d.createdAt.toISOString().slice(0, 16)} · lastUsed ${d.lastUsedAt.toISOString().slice(0, 16)} · expires ${d.expiresAt.toISOString().slice(0, 10)} · encMaster=${d.encMaster ? d.encMaster.length + "ch" : "null"} · salt=${d.deviceSalt ? "yes" : "null"}`,
    );
  }
  const liveCount = devices.filter((d) => !d.revoked && d.expiresAt.getTime() >= now).length;
  const uiActiveCount = devices.filter((d) => !d.revoked).length; // what the UI currently calls "פעילים"
  console.log(`UI "פעילים" would say: ${uiActiveCount} · honest live: ${liveCount}`);

  const sessions = await db.gateSession.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
  console.log(`=== GateSession (last ${sessions.length}) ===`);
  for (const s of sessions) {
    const alive = !s.revoked && s.expiresAt.getTime() >= now;
    console.log(
      `- ${s.id.slice(-8)} kind=${s.kind} ${alive ? "ALIVE" : "dead"} · created ${s.createdAt.toISOString().slice(0, 16)} · hasMaster=${Boolean(s.encMaster)} · viaDevice=${(s as unknown as { viaDevice?: string }).viaDevice ?? "(no column)"}`,
    );
  }
  const liveSessions = await db.gateSession.count({ where: { revoked: false, expiresAt: { gt: new Date(now) } } });
  console.log(`live sessions: ${liveSessions}`);

  await db.$disconnect();
}
main().catch((e) => { console.error("probe failed:", e); process.exit(1); });
