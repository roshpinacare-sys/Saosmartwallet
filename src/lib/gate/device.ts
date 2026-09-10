/**
 * SOVEREIGN GATE — trusted devices ("זכור אותי בצורה בטוחה").
 *
 * The operator logs in once with a live key; afterwards THIS browser can
 * re-open the vault without ever pasting a key again — WITHOUT weakening
 * the vault:
 *
 *  · a random 32-byte device token is minted and shown exactly once —
 *    it lives ONLY in the operator's browser localStorage (like the agent
 *    token: the server stores sha256(token) only).
 *  · the vault master key is sealed AGAIN under scrypt(deviceToken,
 *    deviceSalt) and THAT ciphertext is what the DB holds.
 *  → DB alone (hash + ciphertext) can neither log in nor open the vault.
 *    Possession of the device IS the factor. Losing the device? Revoke the
 *    row (or let the 90-day expiry pass) and the ciphertext is inert.
 *
 * ROAST r9 — the devices plane became SELF-MANAGING (חוכמה-תפעולית):
 *  · gap-31  revocation now SCRUBS encMaster + deviceSalt to null — the
 *            sealed master physically leaves the DB; "inert by data, not
 *            by flag". (Live proof r9: revoked row qtc1mlt7 still carried
 *            a 210-char ciphertext — one UPDATE away from alive.)
 *  · gap-33  sessions minted via a device login carry viaDevice; revoking
 *            the device closes those doors too (the caller's own session
 *            is kept — he is holding the console).
 *  · gap-34  re-arming a known device ROTATES it in place (same row, new
 *            token, fresh 90 days) instead of duplicating rows.
 *  · gap-35  the live-device trust surface is capped (DEVICE_MAX_LIVE);
 *            exceeding it revokes (and scrubs) the oldest live device —
 *            with a disclosed gate message.
 */
import crypto from "crypto";
import { db } from "@/lib/db";
import { sha256hex, randomToken, sealWith, openWith, deriveKek, GateError, Seal } from "./crypto";

export const DEVICE_DAYS = 90;
export const DEVICE_MAX_LIVE = 10; // bound the sealed-master copies (each device = one live sealed master)
export const DEVICE_WARN_DAYS = 7; // heart warns when a device is this close to expiry

export interface ArmedDevice {
  id: string;
  token: string; // shown ONCE — the browser keeps it, the server keeps only the hash
  label: string;
  expiresAt: Date;
}

export interface RevokeOutcome {
  devices: number; // device rows revoked (and scrubbed)
  sessionsKilled: number; // live sessions minted via those devices that were closed
}

/* ── arming / rotation ─────────────────────────────────────────────── */

/**
 * ROAST r9 gap-34: if the caller already holds a LIVE device token, arming
 * ROTATES that device in place — same row, new token, fresh 90 days — instead
 * of minting yet another duplicate (the roster had 3× "Edge · Windows").
 * Rotation is the renewal path the 90-day contract never had.
 */
export async function armDevice(master: Buffer, label: string, rotateToken?: string): Promise<ArmedDevice> {
  if (rotateToken) {
    const row = await db.gateDevice.findUnique({ where: { tokenHash: sha256hex(rotateToken) } });
    if (row && !row.revoked && row.expiresAt.getTime() > Date.now() && row.encMaster && row.deviceSalt) {
      const token = randomToken(32);
      const deviceSalt = crypto.randomBytes(16).toString("hex");
      const encMaster = JSON.stringify(sealWith(deriveKek(token, deviceSalt), master.toString("hex")));
      const updated = await db.gateDevice.update({
        where: { id: row.id },
        data: {
          label: label.slice(0, 80) || row.label,
          tokenHash: sha256hex(token),
          encMaster,
          deviceSalt,
          lastUsedAt: new Date(),
          expiresAt: new Date(Date.now() + DEVICE_DAYS * 24 * 3600 * 1000),
        },
      });
      return { id: updated.id, token, label: updated.label, expiresAt: updated.expiresAt };
    }
    // unknown/expired token → fall through to a fresh arm (honest new device)
  }

  await enforceDeviceCap();
  const token = randomToken(32);
  const deviceSalt = crypto.randomBytes(16).toString("hex");
  const encMaster = JSON.stringify(sealWith(deriveKek(token, deviceSalt), master.toString("hex")));
  const row = await db.gateDevice.create({
    data: {
      label: label.slice(0, 80) || "המכשיר שלי",
      tokenHash: sha256hex(token),
      encMaster,
      deviceSalt,
      expiresAt: new Date(Date.now() + DEVICE_DAYS * 24 * 3600 * 1000),
    },
  });
  return { id: row.id, token, label: row.label, expiresAt: row.expiresAt };
}

/**
 * ROAST r9 gap-35 — the trust surface polices itself: at the cap, the OLDEST
 * live device is revoked (scrubbed) to make room. Disclosed, bounded, and
 * honest: every sealed master copy is an attack surface; growth must displace,
 * not accumulate.
 */
export async function enforceDeviceCap(): Promise<string[]> {
  const live = await db.gateDevice.findMany({
    where: { revoked: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true },
  });
  if (live.length < DEVICE_MAX_LIVE) return [];
  const evict = live.slice(0, live.length - DEVICE_MAX_LIVE + 1);
  for (const d of evict) {
    await revokeDeviceRows({ id: d.id }, null, `תקרת-מכשירים (${DEVICE_MAX_LIVE}) — הוותיק נשלל לפנות-מקום`);
  }
  return evict.map((d) => d.id);
}

/** Read-only: who WOULD be evicted next (proof helper — no mutation). */
export async function nextEvictionCandidate(): Promise<{ id: string; label: string } | null> {
  const live = await db.gateDevice.findMany({
    where: { revoked: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true },
    take: 1,
  });
  return live[0] && live.length >= DEVICE_MAX_LIVE ? live[0] : null;
}

/* ── verification ──────────────────────────────────────────────────── */

/** Verify a device token and re-open the master — or throw a GateError. */
export async function deviceMaster(token: string): Promise<{ master: Buffer; device: { id: string; label: string } }> {
  const row = await db.gateDevice.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || !row.encMaster || !row.deviceSalt || row.expiresAt.getTime() < Date.now()) {
    throw new GateError("device-invalid", "המכשיר הזה לא מוכר, נשלל או פג-תוקף");
  }
  try {
    const s = JSON.parse(row.encMaster) as Seal;
    const master = Buffer.from(openWith(deriveKek(token, row.deviceSalt), s), "hex");
    if (master.length !== 32) throw new Error("bad master length");
    return { master, device: { id: row.id, label: row.label } };
  } catch {
    throw new GateError("device-invalid", "אימות-המכשיר נדחה — GCM סירב לפתוח");
  }
}

/* ── revocation (scrub + door-closing) ─────────────────────────────── */

/**
 * ROAST r9 — the ONE revocation path. Revoking is no longer a boolean flip:
 *  1. the row is marked revoked AND its ciphertext + salt are scrubbed to
 *     null (gap-31: inert by data, not by flag);
 *  2. live sessions minted via the revoked devices are closed (gap-33) —
 *     EXCEPT `keepTokenHash`, the caller's own session.
 * `note` becomes the tail of the gate message (audit trail).
 */
export async function revokeDeviceRows(
  where: { id?: string; all?: boolean },
  keepTokenHash: string | null,
  note?: string,
): Promise<RevokeOutcome> {
  const filter = where.all ? { revoked: false } : { id: where.id, revoked: false };
  const targets = await db.gateDevice.findMany({
    where: filter,
    select: { id: true, label: true, encMaster: true, deviceSalt: true },
  });
  if (!targets.length) return { devices: 0, sessionsKilled: 0 };
  const ids = targets.map((t) => t.id);

  // gap-31: the ciphertext physically leaves the DB — revoked means SCRUBBED.
  const r = await db.gateDevice.updateMany({
    where: { id: { in: ids } },
    data: { revoked: true, encMaster: null, deviceSalt: null },
  });

  // gap-33: close the doors those devices opened — keep the operator's own.
  const doors = await db.gateSession.findMany({
    where: { viaDevice: { in: ids }, revoked: false, expiresAt: { gt: new Date() } },
    select: { id: true, tokenHash: true },
  });
  const killable = doors.filter((s) => !keepTokenHash || s.tokenHash !== keepTokenHash);
  let sessionsKilled = 0;
  if (killable.length) {
    const kr = await db.gateSession.updateMany({
      where: { id: { in: killable.map((s) => s.id) } },
      data: { revoked: true },
    });
    sessionsKilled = kr.count;
  }

  const hadCiphertext = targets.filter((t) => t.encMaster && t.deviceSalt).length;
  const tail = note ? ` · ${note}` : "";
  const doorNote = sessionsKilled ? ` · ${sessionsKilled} סשנים שנפתחו דרכו/ם נשללו` : "";
  const scrubNote = r.count === 1
    ? `הצופן נמחק מה-DB (${hadCiphertext === 1 ? "היה" : "לא היה"})`
    : `${hadCiphertext}/${r.count} צופנים נמחקו מה-DB`;
  if (r.count === 1) {
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `מכשיר-מהימן נשלל (${targets[0].label}) — ${scrubNote}${doorNote}${tail}` },
    });
  } else if (r.count > 1) {
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `${r.count} מכשירים-מהימנים נשללו — ${scrubNote}${doorNote}${tail}` },
    });
  }
  return { devices: r.count, sessionsKilled };
}

/** A friendly label from the request's User-Agent (never the raw UA string). */
export function deviceLabelFrom(ua: string | null): string {
  const s = (ua || "").toLowerCase();
  const browser = s.includes("edg/") ? "Edge" : s.includes("chrome") && !s.includes("chromium") ? "Chrome" : s.includes("firefox") ? "Firefox" : s.includes("safari") ? "Safari" : "דפדפן";
  const os = s.includes("android") ? "Android" : s.includes("iphone") || s.includes("ipad") ? "iOS" : s.includes("windows") ? "Windows" : s.includes("mac os") ? "macOS" : s.includes("linux") ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ") || "המכשיר שלי";
}
