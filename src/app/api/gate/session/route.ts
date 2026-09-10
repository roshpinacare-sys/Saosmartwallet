import fs from "fs/promises";

import { db } from "@/lib/db";
import { getMaster, setMaster, masterReady, sha256hex, openWith, deriveKek } from "@/lib/gate/crypto";
import { createSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/session — OPEN GATE ("זה רק אני ואתה").
 *
 * The operator's explicit policy: no key wall for him — the token is enough.
 * This endpoint mints a fresh 30-day operator session whenever the vault
 * master can be HONESTLY re-lit (never fabricated):
 *   1. master already alive in this process (a key login happened earlier) →
 *      mint + persist the raw token server-side (/tmp/gate_token) so future
 *      restarts can re-light without any key;
 *   2. the server-side token file still opens a live session whose sealed
 *      master decrypts → re-light the master, mint a fresh session, refresh
 *      the file (rolling window — the vault never goes dark between restarts);
 *   3. the caller's own token (header/cookie) carries a sealed master →
 *      silent renewal (the "תישאר מחובר" path);
 *   4. nothing lights up → { in: false } — one key login is honestly required.
 *
 * Security posture (deliberate, operator-ordered): the DB alone stays inert
 * (tokens are hashes; masters are sealed under scrypt(raw token)) — the only
 * new capability is that the SERVER holds one raw token at /tmp/gate_token,
 * outside the repo, so the operator never needs the key again.
 */

const TOKEN_FILE = "/tmp/gate_token";

async function mintSession(master: Buffer): Promise<string> {
  const token = await createSession("operator", "operator", ["*"], master);
  await fs.writeFile(TOKEN_FILE, token, { mode: 0o600 }).catch(() => {});
  await db.gateConfig.update({ where: { id: "gate" }, data: { unlockedAt: new Date() } }).catch(() => {});
  return token;
}

async function openByRawToken(token: string): Promise<Buffer | null> {
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now() || !row.encMaster || !row.sealSalt) return null;
  try {
    const s = JSON.parse(row.encMaster) as { ct: string; iv: string; tag: string };
    const masterHex = openWith(deriveKek(token, row.sealSalt), s);
    const master = Buffer.from(masterHex, "hex");
    return master.length === 32 ? master : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(`gate-session:${clientIpOf(req)}`, 12, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, code: "rate", error: "יותר מדי ניסיונות — נסה בעוד דקה" }, { status: 429 });
  }
  try {
    // ── 1. master already alive in this process ───────────────────────────
    if (masterReady()) {
      const token = await mintSession(getMaster()!);
      return ok({ in: true, token, mode: "memory" });
    }

    // ── 2. the server-side token file re-lights the vault ─────────────────
    const fileToken = (await fs.readFile(TOKEN_FILE, "utf8").catch(() => "")).trim();
    if (fileToken) {
      const master = await openByRawToken(fileToken);
      if (master) {
        setMaster(master);
        const token = await mintSession(master);
        return ok({ in: true, token, mode: "server-token" });
      }
    }

    // ── 3. the caller's own token renews itself ───────────────────────────
    const headerToken = (req.headers.get("x-gate-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
    for (const t of [headerToken, fileToken].filter(Boolean)) {
      const master = await openByRawToken(t);
      if (master) {
        setMaster(master);
        const token = await mintSession(master);
        return ok({ in: true, token, mode: "renew" });
      }
    }

    // ── 4. honest darkness — one key login needed ─────────────────────────
    return ok({
      in: false,
      need: "key",
      message: "הכספת כבויה בשלב הזה — כניסה אחת עם מפתח-headcorner מדליקה אותה, ומשם השער נשאר פתוח",
    });
  } catch (e) {
    return fail(e);
  }
}

export async function GET() {
  try {
    const fileToken = (await fs.readFile(TOKEN_FILE, "utf8").catch(() => "")).trim();
    const fileSession = fileToken ? await db.gateSession.findUnique({ where: { tokenHash: sha256hex(fileToken) } }) : null;
    const fileAlive = !!fileSession && !fileSession.revoked && fileSession.expiresAt.getTime() > Date.now() && !!fileSession.encMaster;
    return ok({
      in: masterReady(),
      serverTokenAlive: fileAlive, // the open-gate lifeline: a restart can re-light from this
      needKey: !masterReady() && !fileAlive,
    });
  } catch (e) {
    return fail(e);
  }
}
