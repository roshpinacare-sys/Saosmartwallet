/**
 * SOVEREIGN GATE — agent harness · modules (מודולים).
 *
 * Course mapping ("Six Primitives of a Loop"):
 *  · Skills     → vault.map / vault.verify / vault.stats — codified knowledge
 *                 of THIS folder: its vault, its chains, its live truth.
 *  · Connectors → chain.steem / web.search / web.read — the loop touches
 *                 real tools outside the terminal.
 *  · Sub-agents → chat.report — the maker reports into the command bridge.
 *
 * Iron rules carried from the gate: private material NEVER leaves the vault.
 * Modules expose public identities, live verifications and read-only chain
 * data only — an armed agent is a smart agent, not an unsafe one.
 */
import { db } from "@/lib/db";
import { masterReady, GateError } from "@/lib/gate/crypto";
import { verifyAll } from "@/lib/gate/verify";
import { steemAdapter } from "@/lib/steem-server";

export type ModuleKind = "skill" | "connector" | "actor";

export interface ModuleCtx {
  agentName: string;
  runId: string;
}

export interface HarnessModule {
  id: string;
  name: string; // Hebrew display name
  kind: ModuleKind;
  desc: string; // Hebrew — what it really does (shown in armory + given to the maker)
  args: string; // compact JSON-schema-ish hint for the maker's protocol
  needsVault: boolean; // requires the master key in memory (operator session opened the vault)
  cacheable: boolean; // read-only module → identical calls inside one run are memoized (no duplicate network)
  exec: (args: Record<string, unknown>, ctx: ModuleCtx) => Promise<unknown>;
}

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export const MODULES: HarnessModule[] = [
  {
    id: "vault.map",
    name: "מפת הכספת",
    kind: "skill",
    desc: "זהויות-ציבור של כל הסודות בכספת (96 מפתחות): סוג, שרשרת, חשבון, תפקיד, מפתח-ציבורי וסטטוס-אימות. חומר-פרטי לעולם לא נחשף.",
    args: `{"chain":"steem|hive|ethereum|tron|solana|github|infra (optional)","account":"string (optional)"}`,
    needsVault: true,
    cacheable: true,
    async exec(args) {
      if (!masterReady()) throw new GateError("vault-locked", "הכספת נעולה");
      const where: Record<string, string> = {};
      if (typeof args.chain === "string" && args.chain) where.chain = args.chain;
      if (typeof args.account === "string" && args.account) where.account = args.account;
      const rows = await db.vaultEntry.findMany({
        where,
        select: { kind: true, chain: true, account: true, role: true, pub: true, status: true },
        orderBy: [{ chain: "asc" }, { account: "asc" }],
        take: 200,
      });
      return { total: rows.length, entries: rows, note: "pubs בלבד — חומר-פרטי לא נחשף לסוכנים" };
    },
  },
  {
    id: "vault.verify",
    name: "אימות-חי מלא",
    kind: "skill",
    desc: "מריץ אימות-חי של הכספת מול steem/hive/GitHub ונגזרות-מפתח — מחזיר סיכום כמה מאומתים, כמה נכשלו ומצב-השרשרות. זו ההוכחה, לא ההצהרה.",
    args: "{}",
    needsVault: true,
    cacheable: true,
    async exec() {
      if (!masterReady()) throw new GateError("vault-locked", "הכספת נעולה");
      const v = await verifyAll();
      return {
        summary: {
          total: v.entries.length,
          verified: v.entries.filter((e) => e.liveOk === true).length,
          failed: v.entries.filter((e) => e.liveOk === false).length,
        },
        chains: { steemOk: v.steemOk, hiveOk: v.hiveOk, githubOk: v.githubOk },
      };
    },
  },
  {
    id: "vault.stats",
    name: "מצב-השער",
    kind: "skill",
    desc: "סטטיסטיקה חיה של השער: כמה סודות, כמה סוכנים פעילים, כמה הרצות-מצטייד ומצב-הכספת.",
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
      const [entries, agents, messages, runs] = await Promise.all([
        db.vaultEntry.count(),
        db.gateAgent.count({ where: { active: true } }),
        db.gateMessage.count(),
        db.gateRun.count(),
      ]);
      return { vault: { initialized: Boolean(cfg?.initialized), unlocked: masterReady(), entries }, agents, messages, runs };
    },
  },
  {
    id: "chain.steem",
    name: "קורא STEEM",
    kind: "connector",
    desc: "שאילתה חיה מול שרשרת STEEM: יתרות חשבון (STEEM/SBD/VESTS), פרטי חשבון, או בריאות-שרשרת. קריאה-בלבד, מה-adapter האמיתי.",
    args: `{"query":"balances|account|health","account":"headcorner"}`,
    needsVault: false,
    cacheable: true,
    async exec(args) {
      const adapter = steemAdapter();
      const q = String(args.query || "balances");
      if (q === "health") return await adapter.health();
      const account = String(args.account || "headcorner").replace(/^@/, "");
      if (!/^[a-z0-9.\-]{3,16}$/.test(account)) throw new GateError("bad-input", "שם-חשבון STEEM לא תקין");
      if (q === "account") return await adapter.getAccount(account);
      return await adapter.getBalances(account);
    },
  },
  {
    id: "web.search",
    name: "חיפוש-רשת",
    kind: "connector",
    desc: "חיפוש אינטרנט חי — תוצאות עם כתובות, כותרות ותקצירים. לחקירה שמעבר לכספת.",
    args: `{"query":"string","num":"1-10 (optional)"}`,
    needsVault: false,
    cacheable: true,
    async exec(args) {
      const query = String(args.query || "").trim();
      if (!query) throw new GateError("bad-input", "דרוש params.query");
      const { default: ZAI } = await import("z-ai-web-dev-sdk");
      const zai = await ZAI.create();
      const r = (await zai.functions.invoke("web_search", { query, num: Math.min(Number(args.num) || 6, 10) })) as {
        url?: string;
        name?: string;
        snippet?: string;
        host_name?: string;
      }[];
      const items = (Array.isArray(r) ? r : []).slice(0, 10).map((x) => ({
        title: clamp(String(x.name || ""), 120),
        url: String(x.url || ""),
        host: String(x.host_name || ""),
        snippet: clamp(String(x.snippet || ""), 300),
      }));
      return { query, results: items };
    },
  },
  {
    id: "web.read",
    name: "קורא-דפים",
    kind: "connector",
    desc: "קריאת דף אינטרנט אמיתי לפי URL — מחזיר כותרת וטקסט מנוקה (חתוך לגודל-קריאה).",
    args: `{"url":"https://…"}`,
    needsVault: false,
    cacheable: true,
    async exec(args) {
      const url = String(args.url || "").trim();
      if (!/^https:\/\/[^\s]+$/.test(url)) throw new GateError("bad-input", "דרוש params.url עם https://");
      const { default: ZAI } = await import("z-ai-web-dev-sdk");
      const zai = await ZAI.create();
      const r = (await zai.functions.invoke("page_reader", { url })) as { title?: string; html?: string; text?: string };
      const raw = String(r.text || r.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { title: r.title || "", url, text: clamp(raw, 4000) };
    },
  },
  {
    id: "chat.report",
    name: "דיווח לגשר",
    kind: "actor",
    desc: "כתיבת הודעה לגשר-הפיקוד בשם הסוכן — כך המפעיל רואה ממצאים בזמן אמת.",
    args: `{"body":"string (≤1000 chars)"}`,
    needsVault: false,
    cacheable: false, // an actor — every report is a real, unique action
    async exec(args, ctx) {
      const body = String(args.body || "").trim();
      if (!body) throw new GateError("bad-input", "דרוש params.body");
      const m = await db.gateMessage.create({
        data: { channel: "command", fromKind: "agent", fromName: ctx.agentName, body: body.slice(0, 1000), meta: JSON.stringify({ runId: ctx.runId }) },
      });
      return { messageId: m.id };
    },
  },
  {
    id: "chat.send",
    name: "דיבור בין-סוכנים",
    kind: "actor",
    desc: "שליחת הודעה ישירה לסוכן אחר בצי (chaintalk): ההודעה נרשמת בגשר ונכנסת לתיבת-הנמען. אם תזכירו את שם-הנמען עם @ — הוא עשוי לקום ולפעול (טריגר מרוסן).",
    args: `{"to":"agent-name","body":"string (≤800 chars)"}`,
    needsVault: false,
    cacheable: false,
    async exec(args, ctx) {
      const to = String(args.to || "").trim();
      let body = String(args.body || "").trim();
      if (!to || to === ctx.agentName) throw new GateError("bad-input", "דרוש params.to — שם סוכן אחר");
      if (!body) throw new GateError("bad-input", "דרוש params.body");
      const peer = await db.gateAgent.findFirst({ where: { name: to, active: true } });
      if (!peer) throw new GateError("bad-input", `אין סוכן פעיל בשם "${to}"`);
      // no double-@ — strip a leading mention of the target if the maker already wrote it
      const lead = new RegExp(`^@${to}\\s*`, "i");
      body = body.replace(lead, "").trim();
      const m = await db.gateMessage.create({
        data: { channel: "command", fromKind: "agent", fromName: ctx.agentName, body: `@${to} ${body}`.slice(0, 1000), meta: JSON.stringify({ runId: ctx.runId, to }) },
      });
      const { emitEvent } = await import("./events");
      await emitEvent("message.mentions", { agent: to, body: `@${to} ${body}`.slice(0, 800), by: ctx.agentName }, "agent");
      return { messageId: m.id, deliveredTo: to };
    },
  },
  {
    id: "inbox.read",
    name: "תיבת-נמען",
    kind: "skill",
    desc: "קריאת ההודעות האחרונות שפונו אליך בגשר (הודעות ישירות עם @שם-שלך). קרא לפני שאתה טוען שאין לך הקשר.",
    args: "{}",
    needsVault: false,
    cacheable: false, // messages arrive while the run lives — never memoize
    async exec(_args, ctx) {
      const [direct, mentions] = await Promise.all([
        db.gateMessage.findMany({ where: { meta: { contains: `"to":"${ctx.agentName}"` } }, orderBy: { createdAt: "desc" }, take: 10 }),
        db.gateMessage.findMany({ where: { body: { contains: "@" + ctx.agentName } }, orderBy: { createdAt: "desc" }, take: 10 }),
      ]);
      const seen = new Set<string>();
      const items = [...direct, ...mentions]
        .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(-15)
        .map((m) => ({ from: m.fromName, kind: m.fromKind, body: m.body.slice(0, 400), at: m.createdAt.toISOString() }));
      return { count: items.length, items };
    },
  },
];

export function getModule(id: string): HarnessModule | undefined {
  return MODULES.find((m) => m.id === id);
}

/** Armory manifest for the operator UI. */
export function moduleManifest() {
  return MODULES.map(({ id, name, kind, desc, args, needsVault }) => ({ id, name, kind, desc, args, needsVault }));
}

/** Safe manifest string injected into the maker's system prompt. */
export function modulesForPrompt(ids: string[]): string {
  return ids
    .map((id) => {
      const m = getModule(id);
      return m ? `- ${m.id} — ${m.desc}\n  args: ${m.args}` : null;
    })
    .filter(Boolean)
    .join("\n");
}
