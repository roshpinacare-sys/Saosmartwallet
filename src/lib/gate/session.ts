/**
 * SOVEREIGN GATE — persistent sessions ("תישאר מחובר").
 * Cookie token (httpOnly, 30d) → sha256 hash stored server-side.
 * Compromise of the DB does NOT leak usable tokens (hashes only).
 * The session also carries the MASTER KEY sealed under scrypt(token, sealSalt):
 * the raw token exists only in the browser cookie, so the DB alone can neither
 * restore a session nor open the vault — but a logged-in operator can view
 * keys even right after a server restart. No passphrase involved.
 */
import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sha256hex, randomToken, GateError, Seal, sealWith, openWith, deriveKek } from "./crypto";

export const GATE_COOKIE = "gate_session";
const SESSION_DAYS = 30;

export interface SessionInfo {
  kind: string; // operator | account
  name: string;
  scopes: string[];
  canOpenMaster: boolean; // session carries a sealed master (or one is in memory)
}

export async function createSession(kind: string, name: string, scopes: string[], master?: Buffer): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  let encMaster: string | null = null;
  let sealSalt: string | null = null;
  if (master && master.length === 32) {
    sealSalt = crypto.randomBytes(16).toString("hex");
    const s: Seal = sealWith(deriveKek(token, sealSalt), master.toString("hex"));
    encMaster = JSON.stringify(s);
  }
  await db.gateSession.create({
    data: { tokenHash: sha256hex(token), kind, name, scopes: JSON.stringify(scopes), encMaster, sealSalt, expiresAt },
  });
  const jar = await cookies();
  jar.set(GATE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // sandbox preview runs behind the gateway (http hop)
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  return token;
}

export async function getSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  const token = jar.get(GATE_COOKIE)?.value;
  if (!token) return null;
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) return null;
  await db.gateSession.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  let scopes: string[] = [];
  try { scopes = JSON.parse(row.scopes); } catch { scopes = []; }
  return { kind: row.kind, name: row.name, scopes, canOpenMaster: Boolean(row.encMaster) };
}

/**
 * Re-open the vault master from THIS session's cookie token (no passphrase,
 * no key re-entry — "פשוט להתחבר ולעבוד"). Returns null when impossible.
 */
export async function openSessionMaster(): Promise<Buffer | null> {
  const jar = await cookies();
  const token = jar.get(GATE_COOKIE)?.value;
  if (!token) return null;
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now() || !row.encMaster || !row.sealSalt) return null;
  try {
    const s = JSON.parse(row.encMaster) as Seal;
    const masterHex = openWith(deriveKek(token, row.sealSalt), s);
    const master = Buffer.from(masterHex, "hex");
    if (master.length !== 32) return null;
    return master;
  } catch {
    return null;
  }
}

/** On fresh login: revoke stale operator sessions (they predate key-sealed sessions). */
export async function revokeOtherSessions() {
  await db.gateSession.updateMany({ where: { kind: "operator", revoked: false }, data: { revoked: true } }).catch(() => {});
}

export async function requireOperator(): Promise<SessionInfo> {
  const s = await getSession();
  if (!s || s.kind !== "operator") throw new GateError("operator-only", "פעולה זו מותרת למפעיל-מחובר בלבד");
  return s;
}

export async function revokeSession() {
  const jar = await cookies();
  const token = jar.get(GATE_COOKIE)?.value;
  if (token) {
    await db.gateSession.updateMany({ where: { tokenHash: sha256hex(token) }, data: { revoked: true } });
  }
  jar.delete(GATE_COOKIE);
}

/** Bearer-token auth for attached agents. Returns agent row or throws. */
export async function requireAgent(req: Request) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : (req.headers.get("x-agent-token") || "").trim();
  if (!token) throw new GateError("agent-token-missing", "דרוש טוקן-סוכן (Authorization: Bearer …)");
  const agent = await db.gateAgent.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!agent || !agent.active) throw new GateError("agent-token-invalid", "טוקן-סוכן לא תקין");
  await db.gateAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
  return agent;
}

/** Random token generator re-export for route use (keeps crypto import surface small). */
export const newToken = () => randomToken(32);
export const _crypto = crypto;
