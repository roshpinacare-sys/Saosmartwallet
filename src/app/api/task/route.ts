// Owner-side task management — create tasks for agents, list everything.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';

export async function GET(req: NextRequest) {
  // READ is public (personal system); POST stays owner-only.
  const tasks = await db.taskItem.findMany({ orderBy: { createdAt: 'desc' }, take: 60 });
  return NextResponse.json({ ok: true, tasks });
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || '').trim().slice(0, 200);
  const detail = String(body.detail || '').trim().slice(0, 4000);
  const assignedTo = String(body.assignedTo || '').trim().toLowerCase();
  if (!title) return NextResponse.json({ ok: false, error: 'title required' }, { status: 400 });
  const t = await db.taskItem.create({ data: { title, detail, createdBy: 'owner', assignedTo } });
  await audit('task-created', `${title} → ${assignedTo || 'open'}`);
  await relayBroadcast('task', { type: 'created', taskId: t.id, title, assignedTo });
  return NextResponse.json({ ok: true, id: t.id });
}
