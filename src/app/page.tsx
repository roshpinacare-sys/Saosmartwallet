"use client";

/**
 * SOVEREIGN GATE — מרחב-ההתחברות הריבוני.
 * שנולד מהתאונה: 2026-09-08, רוטציית-owner על headcorner דרך קובץ-מפתחות
 * גלוי ש"לכולם היתה גישה" אליו. מעכשיו: אפס מפתחות בטקסט-גלוי, כספת
 * מוצפנת (AES-256-GCM תחת סיסמת-מפעיל), סשן מתמשך, ושער-API לסוכנים.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ShieldCheck, ShieldAlert, Lock, Unlock, KeyRound, Bot, Send,
  RefreshCw, Copy, CheckCircle2, XCircle, Loader2, Eye, EyeOff, Plus,
} from "lucide-react";

interface GateStatus {
  initialized: boolean;
  unlocked: boolean;
  hint: string | null;
  session: { kind: string; name: string; scopes: string[] } | null;
  counts: { vaultEntries: number; activeAgents: number; messages: number };
}

interface KeyReport {
  kind: string;
  label: string;
  pubs: string[];
  controls: { chain: string; account: string; role: string; pub: string }[];
  liveChecked: boolean;
  notes: string[];
}

interface InventoryEntry {
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
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  lastSeenAt: string;
}

interface Msg {
  id: string;
  fromKind: string;
  fromName: string;
  body: string;
  createdAt: string;
}

export default function SovereignGate() {
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newPass, setNewPass] = useState("");

  const [keyInput, setKeyInput] = useState("");
  const [report, setReport] = useState<KeyReport | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [unlockKeyInput, setUnlockKeyInput] = useState("");
  const [resetKey, setResetKey] = useState("");
  const [resetPass, setResetPass] = useState("");
  const [resetPass2, setResetPass2] = useState("");
  const [showResetCard, setShowResetCard] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);

  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [chains, setChains] = useState<{ steemOk?: boolean; hiveOk?: boolean; githubOk?: boolean | null }>({});

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentName, setAgentName] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    const r = await fetch("/api/gate/status", { cache: "no-store" });
    const j = await r.json();
    if (j.ok) setStatus(j as GateStatus & { ok: boolean });
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      const r = await fetch("/api/gate/messages", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setMessages(j.messages || []);
    } catch { /* feed poll failure — silent */ }
  }, []);

  const loadInventory = useCallback(async () => {
    const r = await fetch("/api/gate/inventory", { cache: "no-store" });
    const j = await r.json();
    if (j.ok && !j.locked) {
      setInventory(j.entries || []);
      setChains(j.chains || {});
      setSummary(`סה"כ ${j.summary.total} · מאומת-live ${j.summary.verified} · נכשל ${j.summary.failed} · ללא-בדיקת-רשת ${j.summary.noLive}`);
    } else if (j.ok) {
      setInventory([]);
      setSummary("הכספת נעולה — פתח כדי לאמת live");
    }
  }, []);

  const loadAgents = useCallback(async () => {
    const r = await fetch("/api/gate/agents", { cache: "no-store" });
    const j = await r.json();
    if (j.ok) setAgents(j.agents || []);
  }, []);

  useEffect(() => {
    loadStatus();
    loadMessages();
  }, [loadStatus, loadMessages]);

  useEffect(() => {
    if (status?.session) {
      loadInventory();
      loadAgents();
    }
  }, [status?.session, loadInventory, loadAgents]);

  useEffect(() => {
    const t = setInterval(() => { loadMessages(); }, 5000);
    return () => clearInterval(t);
  }, [loadMessages]);

  async function setupOrUnlock() {
    setBusy("unlock"); setErr(null);
    try {
      const first = status && !status.initialized;
      const r = await fetch("/api/gate/" + (first ? "setup" : "unlock"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: pass }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "כשל");
      setPass(""); setNewPass("");
      if (first) {
        // first operator after setup — auto-import the whole system once
        await fetch("/api/gate/import-lab", { method: "POST" });
      }
      await loadStatus();
      await loadInventory();
      await loadAgents();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  }

  async function unlockWithKey() {
    setBusy("unlock-key"); setErr(null);
    try {
      const r = await fetch("/api/gate/unlock-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: unlockKeyInput }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "כשל");
      setUnlockKeyInput("");
      await loadStatus();
      await loadInventory();
      await loadAgents();
      await loadMessages();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  }

  async function resetVault() {
    setBusy("reset"); setErr(null); setResetNote(null);
    try {
      if (resetPass !== resetPass2) throw new Error("הסיסמה החדשה אינה תואמת בין שני השדות");
      const r = await fetch("/api/gate/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: resetKey, newPassphrase: resetPass }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "כשל");
      setResetNote(
        `שוחזר בהצלחה: ${j.imported} סודות ייובאו · חותמות-מפתח: ${j.keySeals?.length || 0} · גיבוי: ${j.backup ? "נכתב ✓" : "נכשל"}` +
        (j.nulls?.length ? ` · nullים כנים: ${j.nulls.length}` : ""),
      );
      setResetKey(""); setResetPass(""); setResetPass2("");
      await loadStatus();
      await loadInventory();
      await loadAgents();
      await loadMessages();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  }

  async function lockVault() {
    setBusy("lock");
    await fetch("/api/gate/lock", { method: "POST" });
    setInventory([]); setAgents([]); setReport(null);
    await loadStatus();
    setBusy(null);
  }

  async function identifyKey(save: boolean) {
    setBusy(save ? "save" : "identify"); setErr(null); setSavedNote(null);
    try {
      const r = await fetch("/api/gate/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput, save }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "כשל");
      setReport(j.report);
      if (save && j.saved?.length) setSavedNote(`נשמר מוצפן: ${j.saved.length} רשומות`);
      if (save) { await loadInventory(); await loadStatus(); }
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  }

  async function verifyNow() {
    setBusy("verify");
    await loadInventory();
    await loadStatus();
    setBusy(null);
  }

  async function attachAgent() {
    setBusy("agent"); setErr(null);
    try {
      const r = await fetch("/api/gate/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: agentName }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "כשל");
      setFreshToken(j.token);
      setAgentName("");
      await loadAgents();
      await loadMessages();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  }

  async function sendMessage() {
    if (!draft.trim()) return;
    setBusy("send");
    try {
      await fetch("/api/gate/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      setDraft("");
      await loadMessages();
    } finally { setBusy(null); }
  }

  const unlocked = Boolean(status?.unlocked);
  const operatorIn = Boolean(status?.session);

  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-stone-950 text-stone-100">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
        {/* header */}
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/40">
              <KeyRound className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">שער-ריבון · SOVEREIGN GATE</h1>
              <p className="text-sm text-stone-400">התחברות חכמה עם כל מפתח · כספת מוצפנת · שער-סוכנים</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.initialized ? (
              unlocked ? (
                <Badge className="gap-1 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40">
                  <Unlock className="h-3.5 w-3.5" /> כספת פתוחה · מחובר
                </Badge>
              ) : (
                <Badge className="gap-1 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">
                  <Lock className="h-3.5 w-3.5" /> כספת נעולה
                </Badge>
              )
            ) : (
              <Badge className="gap-1 bg-stone-500/15 text-stone-300 ring-1 ring-stone-500/40">
                <ShieldAlert className="h-3.5 w-3.5" /> טרם-אותחל
              </Badge>
            )}
            {status?.session && (
              <Badge variant="outline" className="border-stone-700 text-stone-300">
                סשן: {status.session.kind === "operator" ? "מפעיל" : status.session.name}
              </Badge>
            )}
          </div>
        </header>

        {err && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {err}
          </div>
        )}

        {/* unlock card — shown until THIS browser holds an operator session */}
        {!operatorIn && (
          <Card className="mb-6 border-stone-800 bg-stone-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lock className="h-5 w-5 text-amber-400" />
                {status?.initialized ? "פתיחת-הכספת" : "אתחול-ראשון של הכספת"}
              </CardTitle>
              <CardDescription>
                {status?.initialized
                  ? unlocked
                    ? "הכספת פתוחה בשרת — הזן סיסמת-מפעיל כדי לקבל סשן מפעיל בדפדפן זה (נשמר 30 יום)."
                    : "הזן סיסמת-מפעיל כדי לפתוח את מפתח-האב (נשאר בזיכרון-התהליך בלבד). הסשן שלך נשמר 30 יום."
                  : "קבע סיסמת-מפעיל. מפתח-אב אקראי ייווצר וייאטם תחתה — וכל המפתחות של המערכת ייכנסו מוצפנים."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Input
                  type={showPass ? "text" : "password"}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="סיסמת-מפעיל (8+ תווים)"
                  className="border-stone-700 bg-stone-950 pl-10 text-stone-100"
                  onKeyDown={(e) => e.key === "Enter" && setupOrUnlock()}
                />
                <button
                  onClick={() => setShowPass(!showPass)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
                  aria-label="הצג/הסתר סיסמה"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={setupOrUnlock} disabled={busy !== null || pass.length < 8} className="bg-emerald-600 hover:bg-emerald-500">
                {busy === "unlock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                {status?.initialized ? "פתח והתחבר" : "אתחל והתחבר"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* unlock-by-key — the passphrase is never a single point of failure */}
        {!operatorIn && status?.initialized && (
          <Card className="mb-6 border-emerald-900/60 bg-emerald-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-emerald-200">
                <KeyRound className="h-5 w-5 text-emerald-400" />
                פתח עם מפתח — בלי סיסמה
              </CardTitle>
              <CardDescription className="text-stone-400">
                הדבק כל מפתח שכרגע מחזיק authority על <b>headcorner</b> ב-STEEM או ב-HIVE (owner/active/posting/memo).
                המערכת מאמתת אותו live מול השרשרת ופותחת את הכספת — גם אם הסיסמה אבדה.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={unlockKeyInput}
                onChange={(e) => setUnlockKeyInput(e.target.value)}
                placeholder="הדבק כאן מפתח-פרטי אחד (5… / K… / L…)"
                className="min-h-[64px] border-stone-700 bg-stone-950 font-mono text-sm text-stone-100"
              />
              <Button onClick={unlockWithKey} disabled={busy !== null || unlockKeyInput.trim().length < 40} className="bg-emerald-600 hover:bg-emerald-500">
                {busy === "unlock-key" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                אמת live ופתח
              </Button>
            </CardContent>
          </Card>
        )}

        {/* emergency recovery — ownership-proof vault reset */}
        {!operatorIn && status?.initialized && !unlocked && (
          <Card className="mb-6 border-amber-900/50 bg-amber-950/10">
            <CardHeader>
              <button
                onClick={() => setShowResetCard(!showResetCard)}
                className="flex w-full items-center gap-2 text-left"
                aria-expanded={showResetCard}
              >
                <ShieldAlert className="h-5 w-5 text-amber-400" />
                <span className="text-lg font-semibold text-amber-200">שחזור-חירום: איפוס-כספת בהוכחת-בעלות</span>
                <span className="mr-auto text-xs text-stone-500">{showResetCard ? "הסתר ▲" : "פתח ▼"}</span>
              </button>
              {showResetCard && (
                <CardDescription className="text-stone-400">
                  נדרש מפתח <b>owner/active</b> שמחזיק authority נוכחי על headcorner (מאומת live). האיפוס בונה מפתח-אב חדש,
                  מייבא מחדש את כל הסודות ממקורות-השחזור ששרדו, וחותם את הכספת גם תחת הסיסמה החדשה וגם תחת המפתחות הנוכחיים.
                </CardDescription>
              )}
            </CardHeader>
            {showResetCard && (
              <CardContent className="space-y-3">
                <Textarea
                  value={resetKey}
                  onChange={(e) => setResetKey(e.target.value)}
                  placeholder="מפתח owner/active של headcorner (5… / K… / L…)"
                  className="min-h-[64px] border-stone-700 bg-stone-950 font-mono text-sm text-stone-100"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    type="password"
                    value={resetPass}
                    onChange={(e) => setResetPass(e.target.value)}
                    placeholder="סיסמת-מפעיל חדשה (8+ תווים)"
                    className="border-stone-700 bg-stone-950 text-stone-100"
                  />
                  <Input
                    type="password"
                    value={resetPass2}
                    onChange={(e) => setResetPass2(e.target.value)}
                    placeholder="אימות סיסמה חדשה"
                    className="border-stone-700 bg-stone-950 text-stone-100"
                  />
                </div>
                <Button
                  onClick={resetVault}
                  disabled={busy !== null || resetKey.trim().length < 40 || resetPass.length < 8 || resetPass2.length < 8}
                  className="bg-amber-600 hover:bg-amber-500"
                >
                  {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  הוכח בעלות ושחזר הכל
                </Button>
                {resetNote && <p className="text-sm text-emerald-400">{resetNote}</p>}
              </CardContent>
            )}
          </Card>
        )}

        {operatorIn && (
          <Tabs defaultValue="keys" className="gap-6">
            <TabsList className="bg-stone-900 text-stone-300">
              <TabsTrigger value="keys" className="gap-1 data-[state=active]:text-emerald-300"><KeyRound className="h-4 w-4" /> התחברות-מפתח</TabsTrigger>
              <TabsTrigger value="inventory" className="gap-1 data-[state=active]:text-emerald-300"><ShieldCheck className="h-4 w-4" /> מחובר-להכל</TabsTrigger>
              <TabsTrigger value="agents" className="gap-1 data-[state=active]:text-emerald-300"><Bot className="h-4 w-4" /> סוכנים</TabsTrigger>
              <TabsTrigger value="chat" className="gap-1 data-[state=active]:text-emerald-300"><Send className="h-4 w-4" /> צ'אט-פיקוד</TabsTrigger>
            </TabsList>

            {/* ── key connect tab ── */}
            <TabsContent value="keys" className="space-y-4">
              <Card className="border-stone-800 bg-stone-900/60">
                <CardHeader>
                  <CardTitle className="text-lg">התחבר עם כל מפתח</CardTitle>
                  <CardDescription>
                    הדבק כל מפתח — WIF של STEEM/HIVE (5… / K… / L…), מפתח EVM (0x…), מפתח TRON, מנמוניק, PAT של GitHub.
                    המערכת מזהה מה הוא ומה הוא שולט-בו <b>live מהשרשרות</b>, ואז (אם תבקש) שומר אותו מוצפן.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="הדבק כאן מפתח אחד…"
                    className="min-h-[72px] border-stone-700 bg-stone-950 font-mono text-sm text-stone-100"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => identifyKey(false)} disabled={busy !== null || !keyInput.trim()} variant="outline" className="border-stone-700">
                      {busy === "identify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      זהה live
                    </Button>
                    <Button onClick={() => identifyKey(true)} disabled={busy !== null || !keyInput.trim()} className="bg-emerald-600 hover:bg-emerald-500">
                      {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      זהה ושמור מוצפן
                    </Button>
                    <Button onClick={lockVault} disabled={busy !== null} variant="outline" className="border-stone-700 text-stone-400 hover:text-stone-200">
                      <Lock className="h-4 w-4" /> נעל כספת
                    </Button>
                  </div>
                  {savedNote && <p className="text-sm text-emerald-400">{savedNote}</p>}
                  {report && (
                    <div className="rounded-lg border border-stone-800 bg-stone-950 p-4 text-sm">
                      <div className="mb-2 flex items-center gap-2">
                        <Badge className="bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40">{report.kind}</Badge>
                        <span className="text-stone-300">{report.label}</span>
                        {report.liveChecked && <Badge variant="outline" className="border-emerald-700 text-emerald-400">אומת live</Badge>}
                      </div>
                      {report.pubs.length > 0 && (
                        <div className="mb-2 space-y-1">
                          <p className="text-stone-500">זהויות-ציבוריות שנגזרו:</p>
                          {report.pubs.map((p) => (
                            <p key={p} className="break-all font-mono text-xs text-stone-400">{p}</p>
                          ))}
                        </div>
                      )}
                      {report.controls.length > 0 ? (
                        <div>
                          <p className="mb-1 text-stone-500">המפתח שולט ב:</p>
                          <ul className="space-y-1">
                            {report.controls.map((c, i) => (
                              <li key={i} className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                <span>{c.chain} · {c.account} · {c.role}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        report.liveChecked && <p className="flex items-center gap-2 text-stone-400"><XCircle className="h-4 w-4 text-amber-400" /> לא נמצא authority תואם בשרשרות</p>
                      )}
                      {report.notes.map((n, i) => <p key={i} className="mt-2 text-xs text-stone-500">{n}</p>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── inventory tab ── */}
            <TabsContent value="inventory" className="space-y-4">
              <Card className="border-stone-800 bg-stone-900/60">
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-lg">מלאי-החיבור · מחובר להכל</CardTitle>
                    <CardDescription>{summary || "…"}</CardDescription>
                  </div>
                  <Button onClick={verifyNow} disabled={busy !== null} size="sm" className="bg-emerald-600 hover:bg-emerald-500">
                    {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    אמת הכל עכשיו
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className={chains.steemOk ? "border-emerald-700 text-emerald-400" : chains.steemOk === false ? "border-red-700 text-red-400" : "border-stone-700 text-stone-500"}>steem: {chains.steemOk === true ? "live" : chains.steemOk === false ? "לא נענה" : "—"}</Badge>
                    <Badge variant="outline" className={chains.hiveOk ? "border-emerald-700 text-emerald-400" : chains.hiveOk === false ? "border-red-700 text-red-400" : "border-stone-700 text-stone-500"}>hive: {chains.hiveOk === true ? "live" : chains.hiveOk === false ? "לא נענה" : "—"}</Badge>
                    {chains.githubOk !== null && chains.githubOk !== undefined && (
                      <Badge variant="outline" className={chains.githubOk ? "border-emerald-700 text-emerald-400" : "border-red-700 text-red-400"}>github: {chains.githubOk ? "live" : "נכשל"}</Badge>
                    )}
                  </div>
                  <ScrollArea className="max-h-96 rounded-lg border border-stone-800">
                    <div className="divide-y divide-stone-800">
                      {inventory.length === 0 && <p className="p-4 text-sm text-stone-500">אין רשומות — הדבק מפתח בלשונית התחברות-מפתח.</p>}
                      {inventory.map((e) => (
                        <div key={e.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                          <div className="min-w-0">
                            <p className="truncate">
                              <span className="font-semibold">{e.chain || e.kind}</span>
                              {e.account && <span> · {e.account}</span>}
                              {e.role && <span> · {e.role}</span>}
                            </p>
                            <p className="truncate font-mono text-xs text-stone-500">{e.pub || e.detail}</p>
                          </div>
                          {e.liveOk === true && <Badge className="shrink-0 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40">live ✓</Badge>}
                          {e.liveOk === false && <Badge className="shrink-0 bg-red-500/15 text-red-300 ring-1 ring-red-500/40">לא-תואם</Badge>}
                          {e.liveOk === null && <Badge variant="outline" className="shrink-0 border-stone-700 text-stone-400">מוצפן</Badge>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── agents tab ── */}
            <TabsContent value="agents" className="space-y-4">
              <Card className="border-stone-800 bg-stone-900/60">
                <CardHeader>
                  <CardTitle className="text-lg">צרף סוכן (כמוני) דרך API</CardTitle>
                  <CardDescription>
                    כל סוכן מקבל טוקן ויכול לכתוב לנו בצ'אט-הפיקוד ולבצע פעולות-מותרות. הטוקן מאוחסן כ-hash — ומוצג <b>פעם-אחת</b>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="שם-הסוכן (למשל: anchor-agent)"
                      className="flex-1 border-stone-700 bg-stone-950 text-stone-100"
                    />
                    <Button onClick={attachAgent} disabled={busy !== null || !/^[a-zA-Z0-9_-]{2,32}$/.test(agentName)} className="bg-emerald-600 hover:bg-emerald-500">
                      <Plus className="h-4 w-4" /> צרף סוכן
                    </Button>
                  </div>
                  {freshToken && (
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
                      <p className="mb-2 text-sm text-emerald-300">טוקן-הסוכן (מוצג פעם-אחת — העתק עכשיו):</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all rounded bg-stone-950 p-2 font-mono text-xs text-emerald-200">{freshToken}</code>
                        <Button
                          size="sm" variant="outline" className="border-emerald-700"
                          onClick={() => { navigator.clipboard.writeText(freshToken); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        >
                          {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  )}
                  <Separator className="bg-stone-800" />
                  <div>
                    <p className="mb-2 text-sm font-semibold text-stone-300">סוכנים מחוברים ({agents.filter((a) => a.active).length} פעילים)</p>
                    <div className="space-y-2">
                      {agents.length === 0 && <p className="text-sm text-stone-500">אין עדיין סוכנים.</p>}
                      {agents.map((a) => (
                        <div key={a.id} className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm">
                          <div>
                            <p className="font-semibold">{a.name}</p>
                            <p className="text-xs text-stone-500">נראה-לאחרונה: {new Date(a.lastSeenAt).toLocaleString("he-IL")}</p>
                          </div>
                          <Badge variant={a.active ? "default" : "outline"} className={a.active ? "bg-emerald-500/15 text-emerald-300" : "border-stone-700 text-stone-500"}>
                            {a.active ? "פעיל" : "מבוטל"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Separator className="bg-stone-800" />
                  <div className="rounded-lg border border-stone-800 bg-stone-950 p-4 text-xs text-stone-400">
                    <p className="mb-2 font-semibold text-stone-300">מדריך-API לסוכנים (curl):</p>
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono leading-6">{`# כתיבה לצ'אט-הפיקוד:
curl -X POST '<origin>/api/gate/messages' \\
  -H 'Authorization: Bearer <TOKEN>' \\
  -H 'Content-Type: application/json' \\
  -d '{"body":"שלום, אני הסוכן שלך"}'

# ביצוע פעולה מותרת:
curl -X POST '<origin>/api/gate/actions' \\
  -H 'Authorization: Bearer <TOKEN>' \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"report.status","params":{}}'

# פעולות: message.post · report.status · vault.list-pubs · verify.run`}</pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── chat tab ── */}
            <TabsContent value="chat">
              <Card className="border-stone-800 bg-stone-900/60">
                <CardHeader>
                  <CardTitle className="text-lg">צ'אט-פיקוד · מפעיל + סוכנים</CardTitle>
                  <CardDescription>כל הסוכנים שצירפת כותבים כאן ומבצעים לפי הצורך. עדכון-חי כל 5 שניות.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div ref={feedRef} className="max-h-96 overflow-y-auto rounded-lg border border-stone-800 bg-stone-950 p-3">
                    <div className="space-y-2">
                      {messages.length === 0 && <p className="text-sm text-stone-500">אין הודעות — התחל שיחה.</p>}
                      {messages.map((m) => (
                        <div key={m.id} className="rounded-md px-3 py-2 text-sm" style={{
                          background: m.fromKind === "operator" ? "rgba(16,185,129,0.08)" : m.fromKind === "agent" ? "rgba(245,158,11,0.08)" : "rgba(120,113,108,0.08)",
                        }}>
                          <p className="mb-0.5 text-xs text-stone-500">
                            {m.fromKind === "operator" ? "👤 מפעיל" : m.fromKind === "agent" ? `🤖 סוכן ${m.fromName}` : "⚙️ מערכת"}
                            {" · "}{new Date(m.createdAt).toLocaleTimeString("he-IL")}
                          </p>
                          <p className="whitespace-pre-wrap text-stone-200">{m.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                      placeholder="כתוב לצ'אט-הפיקוד…"
                      className="flex-1 border-stone-700 bg-stone-950 text-stone-100"
                    />
                    <Button onClick={sendMessage} disabled={busy !== null || !draft.trim()} className="bg-emerald-600 hover:bg-emerald-500">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* security posture */}
        <Card className="mt-6 border-stone-800 bg-stone-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-stone-300">
              <ShieldCheck className="h-5 w-5 text-emerald-400" /> מדוע זה לא יקרה שוב
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-stone-400 sm:grid-cols-2">
            <p>🔒 <b className="text-stone-200">אפס-טקסט-גלוי</b> — כל מפתח נשמר AES-256-GCM בתוך מסד-הנתונים; אין קובץ-מפתחות לקרוא.</p>
            <p>🔑 <b className="text-stone-200">פתיחה-במפתח, לא רק סיסמה</b> — מפתח-האב נאטם גם תחת כל מפתח-headcorner הנוכחי; אבדן-סיסמה כבר לא נועל אותך בחוץ.</p>
            <p>🚫 <b className="text-stone-200">סוכנים רואים pubs בלבד</b> — אין API שחושף חומר-פרטי; כל פעולת-סוכן נרשמת באודיט.</p>
            <p>🍪 <b className="text-stone-200">סשן מתמשך 30 יום</b> — httpOnly cookie; טוקן מאוחסן כ-hash בלבד.</p>
          </CardContent>
        </Card>

        <footer className="mt-auto border-t border-stone-900 pb-6 pt-6 text-center text-xs text-stone-600" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
          SOVEREIGN GATE · born from the headcorner incident (2026-09-08) · אפס-מפתחות-בטקסט-גלוי, מעכשיו והלאה
        </footer>
      </main>
    </div>
  );
}
