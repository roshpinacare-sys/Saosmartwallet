// Sessions + authorization. Owner sessions live in TWO carriers so they survive
// every environment: (1) httpOnly cookie (same-origin contexts) AND (2) Bearer
// token stored in the client's localStorage (cross-origin iframe previews,
// where third-party cookies are blocked). Agents authenticate per-request with
// Bearer tokens (hashed at rest).
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { sha256Hex, randomToken } from '@/lib/vault';

export const SESSION_COOKIE = 'sv_session';
const SESSION_DAYS = 30;

export async function createSession(scope: 'owner' | 'agent', label: string, keyRef?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.session.create({
    data: { tokenHash: sha256Hex(token), scope, label, keyRef: keyRef || null, expiresAt },
  });
  return { token, expiresAt };
}

// Extract the session token from either carrier. Bearer wins (explicit client intent).
function tokenFrom(req: NextRequest): string {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m && m[1].trim()) return m[1].trim();
  return req.cookies.get(SESSION_COOKIE)?.value || '';
}

export async function sessionFrom(req: NextRequest): Promise<{ id: string; scope: string; label: string } | null> {
  const token = tokenFrom(req);
  if (!token) return null;
  const s = await db.session.findFirst({ where: { tokenHash: sha256Hex(token), revoked: false, expiresAt: { gt: new Date() } } });
  if (!s) return null;
  return { id: s.id, scope: s.scope, label: s.label };
}

// FIX(Roast-64-a · F1/CRITICAL): allowlist-מפעיל — scope='owner' לבדו אינו די:
// ה-login מעניק owner לכל-חשבון שמפתחו מתאים (כל ארנק בעולם!). עכשיו: owner אמת =
// רק חשבון-המפעיל (env או ברירת-המחדל headcorner), מזוהה-לפי ה-label שה-login
// יוצר: `owner:<account>`. כל-label אחר → null (fail-closed).
export const OPERATOR_ACCOUNT = (process.env.SAOS_OPERATOR_ACCOUNT ?? "headcorner").toLowerCase();

export async function requireOwner(req: NextRequest): Promise<{ id: string; scope: string; label: string } | null> {
  const s = await sessionFrom(req);
  return s && s.scope === 'owner' && s.label === `owner:${OPERATOR_ACCOUNT}` ? s : null;
}

// FIX(Roast-63 · H1): ownerLock — עד-היום-הדגל-רק-הוצג-ב-UI ואף-מוטציה-לא-בדקה-אותו.
// עכשיו: קריאה-קנונית-להמוטציות. אין-שורה-בטבלה = נעול-כברירת-מחדל (fail-closed,
// בהתאם-ל-schema: default(true)).
export async function ownerLockActive(): Promise<boolean> {
  const g = await db.guardState.findUnique({ where: { id: 'singleton' } });
  return g ? g.ownerLock === true : true;
}

// Agent Bearer token → AgentNode (updates lastSeenAt).
export async function agentFrom(req: NextRequest): Promise<{ id: string; name: string; capabilities: string } | null> {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const node = await db.agentNode.findFirst({ where: { tokenHash: sha256Hex(m[1]), status: 'active' } });
  if (!node) return null;
  await db.agentNode.update({ where: { id: node.id }, data: { lastSeenAt: new Date() } });
  return { id: node.id, name: node.name, capabilities: node.capabilities };
}

export function cookieOptions(maxAgeSeconds = SESSION_DAYS * 24 * 3600) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false, // sandbox preview is http; the Bearer carrier covers iframes
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
