// Shared chat — owner session read/send. Agents post via /api/agent/message.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const messages = await db.chatMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 80 });
  return NextResponse.json({ ok: true, messages: messages.reverse() });
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const content = String(body.content || '').trim().slice(0, 4000);
  if (!content) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });
  const msg = await db.chatMessage.create({ data: { author: 'owner', role: 'owner', content } });
  await audit('owner-message', content.slice(0, 120));
  await relayBroadcast('chat', { id: msg.id, author: 'owner', role: 'owner', content: msg.content, createdAt: msg.createdAt });
  return NextResponse.json({ ok: true, id: msg.id });
}
