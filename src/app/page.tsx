"use client";

/**
 * SOVEREIGN GATE — פשוט. כניסה אחת עם מפתח, בלי סיסמה, בלי דפדפנים מסובכים.
 * מדביקים מפתח headcorner נוכחי (STEEM/HIVE) → נכנסים ישר לעבודה.
 * בפנים: המפתחות (עם "הצג" לצפייה בפרטי), סוכנים עם API, וצ'אט-פיקוד.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  KeyRound, ShieldCheck, LogOut, Copy, Eye, EyeOff, Bot, Send, RefreshCw,
  Loader2, Plus, Trash2, CheckCircle2, XCircle, MinusCircle,
} from "lucide-react";

interface GateStatus {
  initialized: boolean;
  unlocked: boolean;
  keySeals: number;
  session: { kind: string; name: string; scopes: string[] } | null;
  counts: { vaultEntries: number; activeAgents: number; messages: number };
}

interface Entry {
  id: string;
  kind: string;
  chain: string | null;
  account: string | null;
  role: string | null;
  pub: string | null;
  status: string;
  liveOk: boolean | null;
  detail: string;
}

interface AgentRow {
  id: string; name: string; memo: string | null; active: boolean;
  createdAt: string; lastSeenAt: string;
}

interface Msg {
  id: string; channel: string; fromKind: string; fromName: string; body: string; createdAt: string;
}

type BootInfo = { imported: number; keySeals: number } | null;

export default function Page() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<GateStatus["session"]>(null);
  const [counts, setCounts] = useState<GateStatus["counts"] | null>(null);
  const [keySeals, setKeySeals] = useState(0);

  // login
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bootInfo, setBootInfo] = useState<BootInfo>(null);

  // vault
  const [entries, setEntries] = useState<Entry[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  // agents
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [newAgent, setNewAgent] = useState("");
  const [agentToken, setAgentToken] = useState<string | null>(null);

  // chat
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {
    const [inv, ag, ms] = await Promise.all([
      fetch("/api/gate/inventory").then((r) => r.json()).catch(() => null),
      fetch("/api/gate/agents").then((r) => r.json()).catch(() => null),
      fetch("/api/gate/messages").then((r) => r.json()).catch(() => null),
    ]);
    if (inv?.ok) { setEntries(inv.entries || []); setInvLoading(false); }
    if (ag?.ok) setAgents(ag.agents || []);
    if (ms?.ok) setMsgs(ms.messages || []);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/gate/status").then((x) => x.json());
      if (r?.ok) {
        setSession(r.session);
        setCounts(r.counts);
        setKeySeals(r.keySeals || 0);
        return Boolean(r.session);
      }
    } catch { /* server unreachable — stay on whatever we show */ }
    return false;
  }, []);

  useEffect(() => {
    (async () => {
      const loggedIn = await refreshStatus();
      if (loggedIn) { setInvLoading(true); await loadAll(); }
      setBooting(false);
    })();
  }, [refreshStatus, loadAll]);

  // chat poll while logged in
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      fetch("/api/gate/messages").then((r) => r.json()).then((j) => { if (j?.ok) setMsgs(j.messages || []); }).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [session]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function login() {
    setErr(null); setBusy(true);
    try {
      const r = await fetch("/api/gate/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput.trim() }),
      }).then((x) => x.json());
      if (!r.ok) {
        setErr(r.error || "הכניסה נכשלה");
      } else {
        setKeyInput("");
        if (r.bootstrapped && r.bootInfo) setBootInfo({ imported: r.bootInfo.imported, keySeals: r.bootInfo.keySeals });
        setSession({ kind: "operator", name: "operator", scopes: ["*"] });
        setInvLoading(true);
        await refreshStatus();
        await loadAll();
        toast.success("נכנסת — הכספת פתוחה");
      }
    } catch {
      setErr("השרת לא נענה — נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/gate/lock", { method: "POST" }).catch(() => {});
    setSession(null); setEntries([]); setAgents([]); setMsgs([]); setBootInfo(null); setRevealed({});
    toast("יצאת — הכספת ננעלה");
  }

  async function reveal(id: string) {
    if (revealed[id]) { // toggle hide
      setRevealed((s) => { const n = { ...s }; delete n[id]; return n; });
      return;
    }
    setRevealing(id);
    try {
      const r = await fetch("/api/gate/reveal", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      }).then((x) => x.json());
      if (r.ok) setRevealed((s) => ({ ...s, [id]: r.priv }));
      else toast.error(r.error || "הצפייה נכשלה");
    } finally {
      setRevealing(null);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success("הועתק: " + label)).catch(() => toast.error("ההעתקה נכשלה"));
  }

  async function createAgent() {
    const name = newAgent.trim();
    if (!name) return;
    const r = await fetch("/api/gate/agents", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }).then((x) => x.json());
    if (r.ok) {
      setAgentToken(r.token);
      setNewAgent("");
      const ag = await fetch("/api/gate/agents").then((x) => x.json());
      if (ag.ok) setAgents(ag.agents || []);
      toast.success("הסוכן צורף");
    } else toast.error(r.error || "יצירת סוכן נכשלה");
  }

  async function revokeAgent(name: string) {
    const r = await fetch("/api/gate/agents?name=" + encodeURIComponent(name), { method: "DELETE" }).then((x) => x.json());
    if (r.ok) {
      setAgents((a) => a.map((x) => (x.name === name ? { ...x, active: false } : x)));
      toast("הסוכן בוטל");
    }
  }

  async function sendMsg() {
    const body = chatInput.trim();
    if (!body) return;
    setChatInput("");
    const r = await fetch("/api/gate/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
    }).then((x) => x.json());
    if (r.ok) {
      const ms = await fetch("/api/gate/messages").then((x) => x.json());
      if (ms.ok) setMsgs(ms.messages || []);
    } else toast.error(r.error || "השליחה נכשלה");
  }

  const verifiedCount = entries.filter((e) => e.liveOk === true).length;
  const failedCount = entries.filter((e) => e.liveOk === false).length;

  /* ─────────────────────────── lock screen ─────────────────────────── */
  if (booting) {
    return (
      <div dir="rtl" className="flex-1 flex items-center justify-center min-h-[80vh]">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!session) {
    return (
      <div dir="rtl" className="flex-1 flex flex-col min-h-[85vh]">
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
              <div className="flex flex-col items-center text-center gap-2 mb-6">
                <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                  <ShieldCheck className="h-7 w-7 text-emerald-500" />
                </div>
                <h1 className="text-xl font-bold tracking-tight">SOVEREIGN GATE</h1>
                <p className="text-sm text-muted-foreground">כניסה אחת עם מפתח — בלי סיסמה</p>
              </div>

              <label htmlFor="gate-key" className="sr-only">מפתח</label>
              <Input
                id="gate-key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim() && !busy) login(); }}
                placeholder="הדבק כאן מפתח STEEM / HIVE"
                className="font-mono text-sm h-11 mb-3"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <Button onClick={login} disabled={busy || !keyInput.trim()} className="w-full h-11 text-base gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> בודק מול השרשרת…</> : <><KeyRound className="h-4 w-4" /> כניסה</>}
              </Button>

              {err && (
                <p role="alert" className="mt-3 text-sm text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                  {err}
                </p>
              )}

              <p className="mt-5 text-xs text-muted-foreground leading-relaxed text-center">
                כל מפתח נוכחי של <span className="font-mono">@headcorner</span> עובד — STEEM או HIVE,
                כל תפקיד (owner · active · posting · memo).
                <br />
                האימות מול השרשרת בלייב. נכנסים ונשארים מחוברים 30 יום.
              </p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  /* ─────────────────────────── dashboard ─────────────────────────── */
  return (
    <div dir="rtl" className="flex-1 flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" />
            <span className="font-bold tracking-tight">SOVEREIGN GATE</span>
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/40 shrink-0">מחובר</Badge>
          </div>
          <div className="flex items-center gap-2">
            {counts && (
              <span className="hidden sm:block text-xs text-muted-foreground">
                {counts.vaultEntries} סודות · {counts.activeAgents} סוכנים · {keySeals} חותמות-מפתח
              </span>
            )}
            <Button variant="outline" size="sm" onClick={logout} className="gap-1.5">
              <LogOut className="h-4 w-4" /> יציאה
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
        {bootInfo && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
            הכספת הוקמה אוטומטית ונאטמה תחת <b>{bootInfo.keySeals}</b> מפתחות-headcorner נוכחיים ·
            יובאו מחדש <b>{bootInfo.imported}</b> סודות · נוצר גיבוי מוצפן מקומי. אין יותר סיסמה — המפתחות שלך הם הכניסה.
          </div>
        )}

        <Tabs defaultValue="keys" dir="rtl">
          <TabsList className="mb-4">
            <TabsTrigger value="keys" className="gap-1.5"><KeyRound className="h-4 w-4" /> מפתחות</TabsTrigger>
            <TabsTrigger value="agents" className="gap-1.5"><Bot className="h-4 w-4" /> סוכנים</TabsTrigger>
            <TabsTrigger value="chat" className="gap-1.5"><Send className="h-4 w-4" /> צ׳אט-פיקוד</TabsTrigger>
          </TabsList>

          {/* ── מפתחות ── */}
          <TabsContent value="keys">
            <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
              <Badge variant="outline">סה״כ {entries.length}</Badge>
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/40">
                <CheckCircle2 className="h-3 w-3 ml-1" /> מאומתים live {verifiedCount}
              </Badge>
              {failedCount > 0 && (
                <Badge variant="outline" className="text-rose-500 border-rose-500/40">
                  <XCircle className="h-3 w-3 ml-1" /> נכשלו {failedCount}
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={() => { setInvLoading(true); loadAll(); }} className="gap-1.5 mr-auto">
                <RefreshCw className={"h-3.5 w-3.5" + (invLoading ? " animate-spin" : "")} /> רענון + אימות live
              </Button>
            </div>

            {invLoading && entries.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-10 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> טוען ומאמת מול השרשרות…
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-320px)] min-h-64 rounded-xl border border-border">
                <div className="divide-y divide-border">
                  {entries.map((e) => {
                    const priv = revealed[e.id];
                    return (
                      <div key={e.id} className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="font-mono text-xs">{e.chain || e.kind}</Badge>
                          <span className="font-mono text-sm font-semibold">{e.account || "—"}</span>
                          {e.role && <Badge variant="outline" className="text-xs">{e.role}</Badge>}
                          <LiveDot ok={e.liveOk} />
                          <span className="text-xs text-muted-foreground truncate max-w-52 hidden md:inline" title={e.detail}>{e.detail}</span>
                          <div className="mr-auto flex items-center gap-1.5">
                            {e.pub && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="העתק מפתח-ציבורי" onClick={() => copy(e.pub!, "מפתח-ציבורי")}>
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => reveal(e.id)} disabled={revealing === e.id}>
                              {revealing === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : priv ? <><EyeOff className="h-3.5 w-3.5" /> הסתר</>
                                : <><Eye className="h-3.5 w-3.5" /> הצג מפתח</>}
                            </Button>
                          </div>
                        </div>
                        {e.pub && !priv && (
                          <p className="mt-1.5 font-mono text-xs text-muted-foreground truncate" dir="ltr">{e.pub}</p>
                        )}
                        {priv && (
                          <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-start gap-2" dir="ltr">
                            <code className="flex-1 font-mono text-xs break-all whitespace-pre-wrap">{priv}</code>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(priv, "מפתח פרטי")}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {entries.length === 0 && !invLoading && (
                    <p className="text-center text-muted-foreground text-sm py-10">אין רשומות</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* ── סוכנים ── */}
          <TabsContent value="agents">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4 text-emerald-500" /> צירוף סוכן חדש</h3>
                <div className="flex gap-2">
                  <Input
                    value={newAgent}
                    onChange={(e) => setNewAgent(e.target.value)}
                    placeholder="שם-סוכן (אנגלית, למשל: my-agent)"
                    className="font-mono text-sm"
                  />
                  <Button onClick={createAgent} disabled={!newAgent.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">צור</Button>
                </div>
                {agentToken && (
                  <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <p className="text-xs text-emerald-400 mb-1.5">טוקן הסוכן — מוצג פעם אחת בלבד, שמור עכשיו:</p>
                    <div className="flex items-start gap-2" dir="ltr">
                      <code className="flex-1 font-mono text-xs break-all">{agentToken}</code>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(agentToken, "טוקן סוכן")}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="mt-4 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
                  <p className="font-semibold mb-1.5">חיבור סוכן דרך API:</p>
                  <pre className="font-mono text-[11px] whitespace-pre-wrap" dir="ltr">{`Authorization: Bearer <TOKEN>

POST /api/gate/messages  { "body": "…" }
POST /api/gate/actions   { "action": "message.post"   , "params": { "body": "…" } }
                         { "action": "report.status"   }
                         { "action": "vault.list-pubs" }
                         { "action": "verify.run"      }`}</pre>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                <h3 className="font-semibold mb-3">סוכנים ({agents.filter((a) => a.active).length} פעילים)</h3>
                <ScrollArea className="max-h-96">
                  <div className="space-y-2">
                    {agents.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                        <Bot className={"h-4 w-4 shrink-0 " + (a.active ? "text-emerald-500" : "text-muted-foreground")} />
                        <span className="font-mono text-sm font-medium">{a.name}</span>
                        {a.active ? <Badge variant="outline" className="text-emerald-500 border-emerald-500/40 text-xs">פעיל</Badge>
                          : <Badge variant="outline" className="text-muted-foreground text-xs">בוטל</Badge>}
                        <span className="text-xs text-muted-foreground mr-auto hidden sm:inline">
                          נראה לאחרונה: {new Date(a.lastSeenAt).toLocaleString("he-IL")}
                        </span>
                        {a.active && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" title="ביטול סוכן" onClick={() => revokeAgent(a.name)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {agents.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">אין סוכנים עדיין</p>}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </TabsContent>

          {/* ── צ'אט ── */}
          <TabsContent value="chat">
            <div className="rounded-xl border border-border flex flex-col h-[calc(100vh-300px)] min-h-80">
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                <div className="space-y-2.5">
                  {msgs.map((m) => (
                    <div key={m.id} className="flex gap-2 items-start">
                      <Badge variant={m.fromKind === "operator" ? "default" : m.fromKind === "agent" ? "secondary" : "outline"} className="shrink-0 text-xs mt-0.5">
                        {m.fromKind === "operator" ? "אתה" : m.fromKind === "agent" ? m.fromName : "מערכת"}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString("he-IL")}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </div>
              <div className="border-t border-border p-3 flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && chatInput.trim()) sendMsg(); }}
                  placeholder="כתוב לצ'אט-הפיקוד — הסוכנים רואים הכל…"
                />
                <Button onClick={sendMsg} disabled={!chatInput.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <Footer />
    </div>
  );
}

function LiveDot({ ok }: { ok: boolean | null }) {
  if (ok === true) return <span className="inline-flex items-center gap-1 text-xs text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> live</span>;
  if (ok === false) return <span className="inline-flex items-center gap-1 text-xs text-rose-500"><XCircle className="h-3.5 w-3.5" /> לא בשרשרת</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><MinusCircle className="h-3.5 w-3.5" /> ללא בדיקה</span>;
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-mono">SOVEREIGN GATE · AES-256-GCM</span>
        <span>כניסה במפתח-חי בלבד · סשן 30 יום · המפתחות גלויים בלחיצה</span>
      </div>
    </footer>
  );
}
