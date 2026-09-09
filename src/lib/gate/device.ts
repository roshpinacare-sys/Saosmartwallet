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
 */
import crypto from "crypto";
import { db } from "@/lib/db";
import { sha256hex, randomToken, sealWith, openWith, deriveKek, GateError, Seal } from "./crypto";

export const DEVICE_DAYS = 90;

export interface ArmedDevice {
  id: string;
  token: string; // shown ONCE — the browser keeps it, the server keeps only the hash
  label: string;
  expiresAt: Date;
}

export async function armDevice(master: Buffer, label: string): Promise<ArmedDevice> {
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

/** Verify a device token and re-open the master — or throw a GateError. */
export async function deviceMaster(token: string): Promise<{ master: Buffer; device: { id: string; label: string } }> {
  const row = await db.gateDevice.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) {
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

/** A friendly label from the request's User-Agent (never the raw UA string). */
export function deviceLabelFrom(ua: string | null): string {
  const s = (ua || "").toLowerCase();
  const browser = s.includes("edg/") ? "Edge" : s.includes("chrome") && !s.includes("chromium") ? "Chrome" : s.includes("firefox") ? "Firefox" : s.includes("safari") ? "Safari" : "דפדפן";
  const os = s.includes("android") ? "Android" : s.includes("iphone") || s.includes("ipad") ? "iOS" : s.includes("windows") ? "Windows" : s.includes("mac os") ? "macOS" : s.includes("linux") ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ") || "המכשיר שלי";
}
