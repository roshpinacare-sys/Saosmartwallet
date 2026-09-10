// Agent → chat: an attached agent posts a message to the shared room.
// Auth: Bearer <token> (registered via /api/agent/register).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentFrom } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import { scrub } from '@/lib/secret-scrub';

export async function POST(req: NextRequest) {
  const agent = await agentFrom(req);
  if (!agent) return NextResponse.json({ ok: false, error: 'invalid agent token' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  // FIX(Roast-65-b · M11): סריקת-סודות לפני-ה-persist — ChatMessage.content הוא
  // בור-סודות-בהיסטוריה-תמידית; דפוסי-WIF/hex64/xprv/מנטרה/PAT מרוסקים כאן.
  const content = scrub(String(body.content || '').trim().slice(0, 4000));
  if (!content) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });

  const msg = await db.chatMessage.create({ data: { author: agent.name, role: 'agent', content } });
  await audit('agent-message', `${agent.name}: ${content.slice(0, 120)}`);
  await relayBroadcast('chat', { id: msg.id, author: agent.name, role: 'agent', content: msg.content, createdAt: msg.createdAt });
  return NextResponse.json({ ok: true, id: msg.id });
}
