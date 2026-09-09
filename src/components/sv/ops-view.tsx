'use client';

// ─── ops — agents hub · shared chat · task queue ───────────────────────────
// Real-time via relay socket; polling fallback handled by the shell.

import { useEffect, useRef, useState } from 'react';
import { Bot, MessageSquare, ListChecks, ChevronDown, Send } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { fmtAgo } from './shared';
import type { StatusData, ChatMsg, TaskT } from './shared';

export function OpsView({ status, authed, messages, onSend, tasks, onCreateTask, onRegisterAgent }: {
  status: StatusData | null;
  authed: boolean;
  messages: ChatMsg[];
  onSend: (content: string) => void;
  tasks: TaskT[];
  onCreateTask: (title: string, assignedTo: string) => void;
  onRegisterAgent: (name: string, caps: string) => void;
}) {
  const [chatInput, setChatInput] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAgent, setTaskAgent] = useState('any');
  const [agentName, setAgentName] = useState('');
  const [agentCaps, setAgentCaps] = useState('chat,task');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const activeAgents = status?.agents.filter(a => a.status === 'active').length || 0;
  const tasksOpen = tasks.filter(t => t.status === 'pending' || t.status === 'claimed').length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight leading-tight">מבצעים</h1>
        <p className="text-[12px] text-zinc-600 mt-0.5">סוכנים דרך API · צ׳אט בזמן-אמת דרך relay · תור משימות משותף</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ── chat (primary surface) ── */}
        <section className="sv-card lg:col-span-3 flex flex-col">
          <div className="px-4 py-3 border-b border-[#1d1d22] flex items-center justify-between">
            <span className="text-[13px] font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4 text-zinc-500" />צ׳אט משותף — בעלים ⇄ סוכנים</span>
            <span className="font-data text-[10px] text-zinc-600" dir="ltr">{messages.length} msgs</span>
          </div>
          <ScrollArea className="max-h-[420px] flex-1">
            <div className="p-4 space-y-2">
              {messages.map(m => (
                <div key={m.id} className={`flex flex-col ${m.role === 'owner' ? 'items-start' : m.role === 'system' ? 'items-center' : 'items-end'}`}>
                  {m.role === 'system' ? (
                    <div className="text-[10px] text-zinc-600 bg-[#131317] rounded-full px-3 py-1">{m.content}</div>
                  ) : (
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[12px] leading-relaxed border ${m.role === 'owner' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-50 rounded-tr-sm' : 'bg-[#17171c] border-[#34343c] text-zinc-200 rounded-tl-sm'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[9px] font-data text-zinc-500" dir="ltr">{m.author}</span>
                        <span className="text-[9px] font-data text-zinc-700">{fmtAgo(m.createdAt)}</span>
                      </div>
                      {m.content}
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>
          <div className="p-3 border-t border-[#1d1d22] flex gap-2">
            <Input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder={authed ? 'כתוב לסוכנים...' : 'התחבר כדי לכתוב — הצפייה פתוחה תמיד'}
              className="bg-[#0c0c0e] border-[#26262c] h-10 text-[13px]"
              onKeyDown={e => { if (e.key === 'Enter' && chatInput.trim()) { onSend(chatInput.trim()); setChatInput(''); } }}
            />
            <button
              onClick={() => { if (chatInput.trim()) { onSend(chatInput.trim()); setChatInput(''); } }}
              disabled={!chatInput.trim()}
              aria-label="שלח הודעה"
              className="w-10 h-10 shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center justify-center transition-colors"
            >
              <Send className="w-4 h-4 -scale-x-100" />
            </button>
          </div>
        </section>

        {/* ── agents hub ── */}
        <section className="sv-card lg:col-span-2 flex flex-col">
          <div className="px-4 py-3 border-b border-[#1d1d22] flex items-center justify-between">
            <span className="text-[13px] font-semibold flex items-center gap-2"><Bot className="w-4 h-4 text-zinc-500" />צירוף סוכנים</span>
            <span className="font-data text-[10px] text-zinc-600" dir="ltr">{activeAgents}/{status?.agents.length || 0} active</span>
          </div>
          <div className="p-4 space-y-3 flex-1">
            <div className="flex gap-2">
              <Input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="שם הסוכן (worker-1)" className="bg-[#0c0c0e] border-[#26262c] font-data h-9 text-[12px]" dir="ltr" />
              <button
                onClick={() => { if (agentName.trim()) { onRegisterAgent(agentName.trim(), agentCaps); setAgentName(''); } }}
                disabled={!agentName.trim()}
                className="h-9 px-3.5 shrink-0 rounded-lg bg-gradient-to-b from-[#ecd28b] to-[#d4a94e] hover:from-[#f5e0a0] disabled:opacity-40 text-[#09090b] text-[12px] font-bold transition-all"
              >צור סוכן</button>
            </div>
            <Input value={agentCaps} onChange={e => setAgentCaps(e.target.value)} className="bg-[#0c0c0e] border-[#26262c] font-data h-9 text-[11px]" dir="ltr" placeholder="chat,task" />
            {status && status.agents.length > 0 && (
              <ScrollArea className="max-h-36">
                <div className="space-y-1.5">
                  {status.agents.map(a => (
                    <div key={a.name} className="flex items-center justify-between rounded-lg border border-[#26262c] bg-[#0c0c0e] px-3 py-2">
                      <span className="font-data text-[11px] text-zinc-200" dir="ltr">{a.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-data text-[9px] text-zinc-600" dir="ltr">{a.capabilities}</span>
                        <span className="font-data text-[9px] text-zinc-600" dir="ltr" title="last seen">{fmtAgo(a.lastSeenAt)}</span>
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${a.status === 'active' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-red-500/10 border-red-500/25 text-red-300'}`}>{a.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300">
                <ChevronDown className="w-3.5 h-3.5" />מדריך API לסוכן
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 rounded-lg bg-[#0c0c0e] border border-[#26262c] p-3 text-[10px] leading-relaxed font-data text-zinc-400 overflow-x-auto" dir="ltr">
{`# 1) הבעלים יוצר סוכן ב-UI ומקבל TOKEN
# 2) הסוכן כותב לצ'אט:
curl -X POST <origin>/api/agent/message \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"היי, אני מחובר!"}'

# 3) הסוכן רואה משימות פתוחות:
curl <origin>/api/agent/task -H "Authorization: Bearer TOKEN"

# 4) הסוכן תובע ומדווח:
curl -X POST <origin>/api/agent/task \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"claim","taskId":"..."}'
curl -X POST <origin>/api/agent/task \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"result","taskId":"...","status":"done","result":"..."}'`}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </section>
      </div>

      {/* ── tasks ── */}
      <section className="sv-card">
        <div className="px-4 py-3 border-b border-[#1d1d22] flex items-center justify-between">
          <span className="text-[13px] font-semibold flex items-center gap-2"><ListChecks className="w-4 h-4 text-zinc-500" />משימות לסוכנים</span>
          <span className="font-data text-[10px] text-zinc-600" dir="ltr">{tasksOpen} open / {tasks.length} total</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              placeholder="משימה חדשה..."
              className="bg-[#0c0c0e] border-[#26262c] h-9 flex-1 min-w-44 text-[13px]"
              onKeyDown={e => { if (e.key === 'Enter' && taskTitle.trim()) { onCreateTask(taskTitle.trim(), taskAgent === 'any' ? '' : taskAgent); setTaskTitle(''); } }}
            />
            <Select value={taskAgent} onValueChange={setTaskAgent}>
              <SelectTrigger className="w-40 bg-[#0c0c0e] border-[#26262c] h-9 text-[12px]"><SelectValue placeholder="סוכן" /></SelectTrigger>
              <SelectContent className="bg-[#17171c] border-[#34343c]">
                <SelectItem value="any">פתוח לכולם</SelectItem>
                {status?.agents.map(a => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              onClick={() => { if (taskTitle.trim()) { onCreateTask(taskTitle.trim(), taskAgent === 'any' ? '' : taskAgent); setTaskTitle(''); } }}
              disabled={!taskTitle.trim()}
              className="h-9 px-3.5 rounded-lg bg-gradient-to-b from-[#ecd28b] to-[#d4a94e] hover:from-[#f5e0a0] disabled:opacity-40 text-[#09090b] text-[12px] font-bold transition-all"
            >שייך</button>
          </div>
          <ScrollArea className="max-h-56">
            <div className="space-y-1.5">
              {tasks.map(t => (
                <div key={t.id} className="rounded-lg border border-[#26262c] bg-[#0c0c0e] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-zinc-200">{t.title}</span>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 shrink-0 ${t.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : t.status === 'failed' ? 'bg-red-500/10 border-red-500/25 text-red-300' : 'bg-amber-500/10 border-amber-500/25 text-amber-300'}`}>
                      {t.status}{t.assignedTo ? ` → ${t.assignedTo}` : ''}
                    </Badge>
                  </div>
                  {t.result && <div className="text-[10px] text-zinc-500 mt-1 whitespace-pre-wrap leading-relaxed">{t.result}</div>}
                </div>
              ))}
              {tasks.length === 0 && <div className="text-[11px] text-zinc-600 text-center py-4">אין משימות — צור אחת וסוכן ייטול אותה</div>}
            </div>
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}
