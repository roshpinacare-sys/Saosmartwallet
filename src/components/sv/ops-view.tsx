'use client';

// ─── ops — agents hub · shared chat · task queue (light) ───────────────────
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
        <h1 className="text-[22px] font-bold tracking-tight leading-tight text-zinc-900">מבצעים</h1>
        <p className="text-[12px] text-zinc-500 mt-0.5">סוכנים דרך API · צ׳אט בזמן-אמת דרך relay · תור משימות משותף</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ── chat (primary surface) ── */}
        <section className="sv-card lg:col-span-3 flex flex-col">
          <div className="px-4 py-3 border-b border-[#eeeeea] flex items-center justify-between">
            <span className="text-[13px] font-semibold flex items-center gap-2 text-zinc-800"><MessageSquare className="w-4 h-4 text-emerald-600" />צ׳אט משותף — בעלים ⇄ סוכנים</span>
            <span className="font-data text-[10px] text-zinc-400" dir="ltr">{messages.length} msgs</span>
          </div>
          <ScrollArea className="max-h-[420px] flex-1">
            <div className="p-4 space-y-2">
              {messages.map(m => (
                <div key={m.id} className={`flex flex-col ${m.role === 'owner' ? 'items-start' : m.role === 'system' ? 'items-center' : 'items-end'}`}>
                  {m.role === 'system' ? (
                    <div className="text-[10px] text-zinc-500 bg-zinc-100 rounded-full px-3 py-1">{m.content}</div>
                  ) : (
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[12px] leading-relaxed border ${m.role === 'owner' ? 'bg-emerald-600 border-emerald-600 text-white rounded-tr-sm shadow-[0_2px_8px_-2px_rgba(5,150,105,0.4)]' : 'bg-white border-[#e8e8e3] text-zinc-800 rounded-tl-sm'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[9px] font-data ${m.role === 'owner' ? 'text-emerald-100/80' : 'text-zinc-400'}`} dir="ltr">{m.author}</span>
                        <span className={`text-[9px] font-data ${m.role === 'owner' ? 'text-emerald-200/70' : 'text-zinc-300'}`}>{fmtAgo(m.createdAt)}</span>
                      </div>
                      {m.content}
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>
          <div className="p-3 border-t border-[#eeeeea] flex gap-2">
            <Input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder={authed ? 'כתוב לסוכנים...' : 'התחבר כדי לכתוב — הצפייה פתוחה תמיד'}
              className="bg-white border-[#e0e0da] h-10 text-[13px]"
              onKeyDown={e => { if (e.key === 'Enter' && chatInput.trim()) { onSend(chatInput.trim()); setChatInput(''); } }}
            />
            <button
              onClick={() => { if (chatInput.trim()) { onSend(chatInput.trim()); setChatInput(''); } }}
              disabled={!chatInput.trim()}
              aria-label="שלח הודעה"
              className="w-10 h-10 shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center justify-center transition-colors shadow-[0_2px_8px_-2px_rgba(5,150,105,0.4)]"
            >
              <Send className="w-4 h-4 -scale-x-100" />
            </button>
          </div>
        </section>

        {/* ── agents hub ── */}
        <section className="sv-card lg:col-span-2 flex flex-col">
          <div className="px-4 py-3 border-b border-[#eeeeea] flex items-center justify-between">
            <span className="text-[13px] font-semibold flex items-center gap-2 text-zinc-800"><Bot className="w-4 h-4 text-emerald-600" />צירוף סוכנים</span>
            <span className="font-data text-[10px] text-zinc-400" dir="ltr">{activeAgents}/{status?.agents.length || 0} active</span>
          </div>
          <div className="p-4 space-y-3 flex-1">
            <div className="flex gap-2">
              <Input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="שם הסוכן (worker-1)" className="bg-white border-[#e0e0da] font-data h-9 text-[12px]" dir="ltr" />
              <button
                onClick={() => { if (agentName.trim()) { onRegisterAgent(agentName.trim(), agentCaps); setAgentName(''); } }}
                disabled={!agentName.trim()}
                className="h-9 px-3.5 shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[12px] font-bold transition-colors"
              >צור סוכן</button>
            </div>
            <Input value={agentCaps} onChange={e => setAgentCaps(e.target.value)} className="bg-white border-[#e0e0da] font-data h-9 text-[11px]" dir="ltr" placeholder="chat,task" />
            {status && status.agents.length > 0 && (
              <ScrollArea className="max-h-36">
                <div className="space-y-1.5">
                  {status.agents.map(a => (
                    <div key={a.name} className="flex items-center justify-between rounded-lg border border-[#eeeeea] bg-zinc-50/60 px-3 py-2">
                      <span className="font-data text-[11px] text-zinc-800" dir="ltr">{a.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-data text-[9px] text-zinc-400" dir="ltr">{a.capabilities}</span>
                        <span className="font-data text-[9px] text-zinc-400" dir="ltr" title="last seen">{fmtAgo(a.lastSeenAt)}</span>
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${a.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>{a.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800">
                <ChevronDown className="w-3.5 h-3.5" />מדריך API לסוכן
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-[10px] leading-relaxed font-data text-zinc-300 overflow-x-auto" dir="ltr">
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
        <div className="px-4 py-3 border-b border-[#eeeeea] flex items-center justify-between">
          <span className="text-[13px] font-semibold flex items-center gap-2 text-zinc-800"><ListChecks className="w-4 h-4 text-emerald-600" />משימות לסוכנים</span>
          <span className="font-data text-[10px] text-zinc-400" dir="ltr">{tasksOpen} open / {tasks.length} total</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              placeholder="משימה חדשה..."
              className="bg-white border-[#e0e0da] h-9 flex-1 min-w-44 text-[13px]"
              onKeyDown={e => { if (e.key === 'Enter' && taskTitle.trim()) { onCreateTask(taskTitle.trim(), taskAgent === 'any' ? '' : taskAgent); setTaskTitle(''); } }}
            />
            <Select value={taskAgent} onValueChange={setTaskAgent}>
              <SelectTrigger className="w-40 bg-white border-[#e0e0da] h-9 text-[12px]"><SelectValue placeholder="סוכן" /></SelectTrigger>
              <SelectContent className="bg-white border-[#e8e8e3]">
                <SelectItem value="any">פתוח לכולם</SelectItem>
                {status?.agents.map(a => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              onClick={() => { if (taskTitle.trim()) { onCreateTask(taskTitle.trim(), taskAgent === 'any' ? '' : taskAgent); setTaskTitle(''); } }}
              disabled={!taskTitle.trim()}
              className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[12px] font-bold transition-colors"
            >שייך</button>
          </div>
          <ScrollArea className="max-h-56">
            <div className="space-y-1.5">
              {tasks.map(t => (
                <div key={t.id} className="rounded-lg border border-[#eeeeea] bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-zinc-800">{t.title}</span>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 shrink-0 ${t.status === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : t.status === 'failed' ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                      {t.status}{t.assignedTo ? ` → ${t.assignedTo}` : ''}
                    </Badge>
                  </div>
                  {t.result && <div className="text-[10px] text-zinc-500 mt-1 whitespace-pre-wrap leading-relaxed">{t.result}</div>}
                </div>
              ))}
              {tasks.length === 0 && <div className="text-[11px] text-zinc-400 text-center py-4">אין משימות — צור אחת וסוכן ייטול אותה</div>}
            </div>
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}
