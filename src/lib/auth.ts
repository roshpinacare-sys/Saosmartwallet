// Sessions + authorization. Owner sessions via httpOnly cookie (30 days, "stay logged in").
// Agent calls authenticate per-request with Bearer tokens (hashed at rest).
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

export async function sessionFrom(req: NextRequest): Promise<{ id: string; scope: string; label: string } | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findFirst({ where: { tokenHash: sha256Hex(token), revoked: false, expiresAt: { gt: new Date() } } });
  if (!s) return null;
  return { id: s.id, scope: s.scope, label: s.label };
}

export async function requireOwner(req: NextRequest): Promise<{ id: string; scope: string; label: string } | null> {
  const s = await sessionFrom(req);
  return s && s.scope === 'owner' ? s : null;
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
    secure: false, // sandbox preview is http; cookie stays inside the tunnel
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
