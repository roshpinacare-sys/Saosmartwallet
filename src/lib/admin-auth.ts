/**
 * admin-auth.ts — owner gate for key-management (Model 1 Week 1 declared gap)
 * ================================================================================
 * The DEVELOPER console mints and revokes PRODUCT API keys. Until now that
 * surface was open (honestly declared as "owner-side, later-week auth"). This
 * closes it with the same discipline as the keys themselves:
 *
 *   · credential = "saos_admin_" + 24 random bytes base64url — shown ONCE
 *   · only SHA-256(token) is stored (DB AdminCredential, singleton row)
 *   · env SAOS_ADMIN_TOKEN overrides the DB credential when set (ops path)
 *   · comparison is timing-safe; fail-closed on missing/unbootstrapped state
 *   · bootstrap = POST /api/developer/admin/bootstrap — creates the credential
 *     exactly once (fixed singleton id; concurrent bootstrap loses) and
 *     returns the plaintext exactly once; afterwards it only reports 409.
 *
 * Read-only console data (GET keys/usage — prefixes and counters, no secrets)
 * stays open for the sandbox console UX; every MUTATING route is gated.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";

const ADMIN_SINGLETON_ID = "admin-primary";

export function hashAdminToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function envAdminToken(): string | null {
  const t = process.env.SAOS_ADMIN_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export interface AdminBootstrapResult {
  /** true = the credential was created NOW and `token` carries the ONLY copy. */
  created: boolean;
  /** Plaintext token — returned exactly once, never again. */
  token: string | null;
  /** Which source governs admin auth after this call. */
  source: "env" | "db";
}

/**
 * Bootstrap-once credential creation. When SAOS_ADMIN_TOKEN is set the env
 * path governs and there is nothing to bootstrap. The DB singleton row is
 * created with a FIXED id, so concurrent bootstraps resolve to one credential
 * (the loser gets P2002 and reports exists).
 */
export async function bootstrapAdminCredential(): Promise<AdminBootstrapResult> {
  if (envAdminToken()) return { created: false, token: null, source: "env" };
  const existing = await db.adminCredential.findUnique({ where: { id: ADMIN_SINGLETON_ID } });
  if (existing) return { created: false, token: null, source: "db" };
  const token = `saos_admin_${randomBytes(24).toString("base64url")}`;
  try {
    await db.adminCredential.create({
      data: { id: ADMIN_SINGLETON_ID, tokenHash: hashAdminToken(token), label: "bootstrap" },
    });
  } catch {
    // Lost a bootstrap race — the winner holds the only plaintext copy.
    return { created: false, token: null, source: "db" };
  }
  return { created: true, token, source: "db" };
}

/**
 * Fail-closed admin gate for mutating routes. Returns null when the request
 * carries a valid admin token; otherwise a ready-to-return 401 Response.
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const token = bearerToken(req);
  const unauthorized = (detail: string): Response =>
    Response.json(
      { ok: false, error: `admin authorization failed: ${detail}` },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  const env = envAdminToken();
  if (env) {
    if (token && timingSafeHexEqual(hashAdminToken(token), hashAdminToken(env))) return null;
    return unauthorized("expected the SAOS_ADMIN_TOKEN bearer");
  }
  const cred = await db.adminCredential.findUnique({ where: { id: ADMIN_SINGLETON_ID } });
  if (!cred) {
    return unauthorized("no admin credential yet — POST /api/developer/admin/bootstrap once, then use its token");
  }
  if (token && timingSafeHexEqual(hashAdminToken(token), cred.tokenHash)) return null;
  return unauthorized("invalid or missing admin bearer token");
}
