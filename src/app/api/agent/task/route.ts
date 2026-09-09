// Tasks bridge — agents: GET open tasks / claim / report results.
// Auth: Bearer <token>.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentFrom } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const agent = await agentFrom(req);
  if (!agent) return NextResponse.json({ ok: false, error: 'invalid agent token' }, { status: 401 });
  const tasks = await db.taskItem.findMany({
    where: { OR: [{ assignedTo: agent.name }, { assignedTo: '' }], status: { in: ['open', 'claimed'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ ok: true, tasks });
}

export async function POST(req: NextRequest) {
  const agent = await agentFrom(req);
  if (!agent) return NextResponse.json({ ok: false, error: 'invalid agent token' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  if (action === 'claim') {
    const t = await db.taskItem.updateMany({ where: { id: String(body.taskId || ''), status: 'open' }, data: { status: 'claimed', assignedTo: agent.name } });
    if (!t.count) return NextResponse.json({ ok: false, error: 'task not claimable' }, { status: 409 });
    await audit('task-claimed', `${agent.name} → ${body.taskId}`);
    await relayBroadcast('task', { type: 'claimed', taskId: body.taskId, agent: agent.name });
    return NextResponse.json({ ok: true });
  }

  if (action === 'result') {
    const status = body.status === 'failed' ? 'failed' : 'done';
    const t = await db.taskItem.updateMany({
      where: { id: String(body.taskId || ''), OR: [{ assignedTo: agent.name }, { assignedTo: '' }] },
      data: { status, result: String(body.result || '').slice(0, 4000) },
    });
    if (!t.count) return NextResponse.json({ ok: false, error: 'task not found for agent' }, { status: 404 });
    await audit('task-result', `${agent.name} → ${body.taskId} = ${status}`);
    await relayBroadcast('task', { type: 'result', taskId: body.taskId, status, agent: agent.name });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'unknown action (claim|result)' }, { status: 400 });
}
