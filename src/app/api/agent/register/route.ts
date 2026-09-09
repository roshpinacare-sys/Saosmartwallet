// Register a new agent node — returns the API token ONCE (shown only here).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { sha256Hex, randomToken } from '@/lib/vault';
import { audit, relayBroadcast } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized — התחבר קודם עם מפתח' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  const capabilities = String(body.capabilities || 'chat,task').trim();
  if (!name) return NextResponse.json({ ok: false, error: 'נדרש שם סוכן' }, { status: 400 });

  const token = randomToken(24);
  const agent = await db.agentNode.upsert({
    where: { name },
    create: { name, tokenHash: sha256Hex(token), capabilities },
    update: { tokenHash: sha256Hex(token), capabilities, status: 'active' },
  });

  await audit('agent-registered', `${name} caps=${capabilities} by=${owner.label}`);
  await relayBroadcast('agent', { type: 'registered', name, capabilities });
  await db.chatMessage.create({
    data: { author: 'system', role: 'system', content: `סוכן "${name}" חובר לרשת (יכולות: ${capabilities}). טוקן נמסר לבעלים.` },
  });

  return NextResponse.json({ ok: true, agent: { name: agent.name, capabilities: agent.capabilities }, token });
}
