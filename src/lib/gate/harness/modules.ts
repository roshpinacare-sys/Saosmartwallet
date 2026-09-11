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
import { verifyAll, verifyImported, FLEET_ACCOUNTS } from "@/lib/gate/verify";
import { steemAdapter, steemMarket, steemOpenOrders } from "@/lib/steem-server";
import { fleetStatusCached } from "@/lib/fleet-status";
import { saosHubCached } from "@/lib/saos-hub";
import { verifyIdentityAnchor } from "@/lib/anchor-verify";
import { ecoNetworks } from "@/lib/eco-server";
import { createOrderFromAgent } from "./orders";
import { getTreasurySnapshot } from "@/lib/gate/treasury";
import { getSituationSnapshot } from "@/lib/gate/situation";
import { getBroadcastDigest } from "@/lib/gate/digest";
import { publishPostFromAgent, interactFromAgent, editPostFromAgent, auditFleetContent, fleetRailsOverview, fleetRewardsCensus, claimRewardsFromAgent, steemTrends, SOCIAL_RAILS } from "./social";
import { railRpc, railAccounts, railBlogPosts } from "@/lib/social/rails-server";
import { readAnchorHistory, verifyAnchorOnChain, vaultDigestV2 } from "@/lib/gate/anchor";
import { runPulseCycle } from "@/lib/gate/pulse";
import { ethereumEyes, solanaEyes } from "@/lib/multichain-server";
import { fundingCensus, FUNDING_ADDRESS } from "@/lib/gate/funding-watch";
import { getEthereumAdapter, getSolanaAdapter } from "../../../../packages/chains/index";
import { formatEther } from "ethers";

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
  /**
   * Canonical cache key for THIS module's args. Without it, `{}` and
   * `{"username":"headcorner"}` are different strings — the maker would pay
   * the same expensive network probe twice for the same question. Modules
   * with defaulted args SHOULD provide one; the default is raw JSON.
   */
  cacheKeyOf?: (args: Record<string, unknown>) => string;
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
      // r31 — עיוורון-הבודק נסגר-כאן-כמו-שנסגר-ב-r29 (צנזורת-התגמולים): הרשימה-המלאה
      // נחתכת לפי-תקרת-התוצאה (RESULT_CLAMP), והבודק-העצמאי לא-היה-מסוגל-לאמת
      // אילו-רשומות-ממתינות. byStatus + waiting נמצאים-ראשונים-באובייקט —
      // JSON.stringify שומר-על-סדר-המפתחות, ולכן-גם-אחרי-חיתוך הראש-מציג-את
      // הפירוק-המלא-לפי-סטטוס ואת-רשימת-הממתינות (החלק-הניתן-לאימות).
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      const waiting = rows
        .filter((r) => r.status === "imported" || r.status === "unverified")
        .map((r) => `${r.chain || "?"}/${r.account || "?"}|${r.role || "?"}|${r.kind}|${r.status}`);
      return { byStatus, waiting, waitingCount: waiting.length, total: rows.length, entries: rows, note: "pubs בלבד — חומר-פרטי לא נחשף לסוכנים" };
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
      const [entries, agents, messages, runs, groupByStatus] = await Promise.all([
        db.vaultEntry.count(),
        db.gateAgent.count({ where: { active: true } }),
        db.gateMessage.count(),
        db.gateRun.count(),
        // r31 — הבודק-העצמאי-נדרש-לאמת "כמה-רשומות באילו-סטטוסים"; בלי-הפירוק
        // הקריטריון-נכשל-בכנות על-תשובה-כללית (נתפס-חי בהוכחת-הצי של-r31).
        db.vaultEntry.groupBy({ by: ["status"], _count: { _all: true } }),
      ]);
      const entriesByStatus: Record<string, number> = {};
      for (const g of groupByStatus) entriesByStatus[g.status] = g._count._all;
      return { vault: { initialized: Boolean(cfg?.initialized), unlocked: masterReady(), entries, entriesByStatus }, agents, messages, runs };
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
    cacheKeyOf: (args) => `${String(args.query || "balances")}:${String(args.account || "headcorner").replace(/^@/, "").toLowerCase()}`,
  },
  {
    id: "chain.ethereum",
    name: "קורא ETHEREUM",
    kind: "connector",
    desc: "עיניים חיות על Ethereum — הפוטנציאל שהיה חבוי: לכספת יש 12 ארנקי-EVM והסוכנים היו עיוורים אליהם. ברירת-מחדל (fleet): גובה-בלוק, עמלות-גז אמת ויתרת חיה של כל ארנקי-הכספת (כתובות-ציבור בלבד, ללא מפתחות, failover על 4 צמתים-חיים). גם health וגם בדיקת-כתובת בודדת. קריאה-בלבד — אין נתיב-חתימה כאן.",
    args: `{"mode":"fleet|health|address","address":"0x… (address mode only)"}`,
    needsVault: false,
    cacheable: true,
    cacheKeyOf: (args) => `eth:${String(args.mode || "fleet")}:${String(args.address || "").toLowerCase()}`,
    async exec(args) {
      const mode = String(args.mode || "fleet");
      if (mode === "health") return await getEthereumAdapter().health();
      if (mode === "address") {
        const address = String(args.address || "").trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new GateError("bad-input", "דרוש params.address תקין (0x + 40 תווים הקס)");
        const adapter = getEthereumAdapter();
        const a = await adapter.getAccountInfo(address);
        return { ...a, balanceEth: formatEther(BigInt(a.balance)) };
      }
      return await ethereumEyes();
    },
  },
  {
    id: "chain.solana",
    name: "קורא SOLANA",
    kind: "connector",
    desc: "עיניים חיות על Solana — האוצר השני שהיה נעול: 12 ארנקי-SOL בכספת, עכשיו חיים לסוכנים. ברירת-מחדל (fleet): סלוט חי, יתרת-למפורט של כל ארנק ומספר-הטוקנים הלא-אפסיים (SPL, Token+Token-2022) — כתובות-ציבור בלבד, failover חי. גם health וגם סריקת-SPL מלאה לכתובת בודדת. קריאה-בלבד.",
    args: `{"mode":"fleet|health|tokens","address":"base58 (tokens mode only)"}`,
    needsVault: false,
    cacheable: true,
    cacheKeyOf: (args) => `sol:${String(args.mode || "fleet")}:${String(args.address || "")}`,
    async exec(args) {
      const mode = String(args.mode || "fleet");
      const adapter = getSolanaAdapter();
      if (mode === "health") return await adapter.health();
      if (mode === "tokens") {
        const address = String(args.address || "").trim();
        if (address.length < 32 || address.length > 44) throw new GateError("bad-input", "דרוש params.address תקין (base58, 32-44 תווים)");
        const tokens = await adapter.getTokenBalances(address);
        return { address, count: tokens.length, tokens };
      }
      return await solanaEyes();
    },
  },
  {
    id: "chain.funding",
    name: "צופה-המימון",
    kind: "connector",
    desc: "עיניים על כתובת-המימון של מישור-הפלטפורמה (מספר-האוצר v65 על הדלת שלנו) — המקום שבו הפקדת-גז פותחת 7 דלתות-פריסה EVM. צנזורה-חיה read-only על 8 רשתות דרך צמתים-ציבוריים: יתרה לכל רשת, ריק/ממומן, כשל-פר-רשת כן. הכתובת אינה שלנו ואין שום נתיב-כתיבה — הרגע שבו כסף נוחת, המערכת רואה אותו. קריאה-בלבד.",
    args: `{"address":"0x… (optional override — default: כתובת-המימון המפורסמת)"}`,
    needsVault: false,
    cacheable: true,
    cacheKeyOf: (args) => `funding:${String(args.address || FUNDING_ADDRESS).toLowerCase()}`,
    async exec(args) {
      return await fundingCensus(String(args.address || "").trim() || undefined);
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
    desc: "שליחת הודעה ישירה לסוכן אחר בצי (chaintalk): ההודעה נרשמת בגשר ונכנסת לתיבת-הנמען. אם תזכירו את שם-הנמען עם @ — הוא עשוי לקום ולפעול (טריגר מרוסן). הגשר מרוסן נגד ספאמ: מקס 8 הודעות לריצה ו-40 לשעה לכל סוכן.",
    args: `{"to":"agent-name","body":"string (≤800 chars)"}`,
    needsVault: false,
    cacheable: false,
    async exec(args, ctx) {
      const to = String(args.to || "").trim();
      let body = String(args.body || "").trim();
      if (!to || to === ctx.agentName) throw new GateError("bad-input", "דרוש params.to — שם סוכן אחר");
      if (!body) throw new GateError("bad-input", "דרוש params.body");
      // bridge anti-spam rails — a looping agent must never drown the operator
      const [perRun, perHour] = await Promise.all([
        db.gateMessage.count({ where: { fromName: ctx.agentName, meta: { contains: ctx.runId } } }),
        db.gateMessage.count({ where: { fromName: ctx.agentName, createdAt: { gte: new Date(Date.now() - 3_600_000) } } }),
      ]);
      if (perRun >= 8) throw new GateError("rate-limited", "תקרת-הגשר לריצה מוצו (8 הודעות) — סיכם בדוח אחד");
      if (perHour >= 40) throw new GateError("rate-limited", "תקרת-הגשר השעתית מוצו (40) — הגשר הוא ערוץ-פיקוד, לא יומן");
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
  {
    id: "runs.self",
    name: "זיכרון-עצמי",
    kind: "skill",
    desc: "הריצות האחרונות שלך, אתה: יעד, סטטוס, מוצא (סיור/טריגר/ידני), משך, tokens, פסק-הבודק והלקחים. אל תגלה מחדש מה שכבר ידוע לך — קרא את העבר לפני שאתה פועל.",
    args: "{}",
    needsVault: false,
    cacheable: false, // the past changes between runs — never memoize
    async exec(_args, ctx) {
      const rows = await db.gateRun.findMany({
        where: { agentName: ctx.agentName },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true, goal: true, status: true, origin: true, attempt: true, budget: true,
          durationMs: true, tokens: true, verdict: true, lessons: true, error: true, createdAt: true,
        },
      });
      const runs = rows.map((r) => {
        let verdict: { done?: boolean; gaps?: string[] } | null = null;
        try { const v = r.verdict ? JSON.parse(r.verdict) : null; if (v && typeof v === "object") verdict = { done: Boolean(v.done), gaps: Array.isArray(v.gaps) ? v.gaps.slice(0, 3).map((g: string) => String(g).slice(0, 140)) : [] }; } catch {}
        let lessons: string[] = [];
        try { const l = r.lessons ? JSON.parse(r.lessons) : null; if (Array.isArray(l)) lessons = l.slice(0, 4).map((x: string) => String(x).slice(0, 140)); } catch {}
        let tokens: unknown = null;
        try { tokens = r.tokens ? JSON.parse(r.tokens) : null; } catch {}
        return {
          id: r.id, at: r.createdAt.toISOString(), goal: r.goal.slice(0, 160), status: r.status,
          origin: r.origin, attempt: r.attempt, budget: r.budget, durationMs: r.durationMs, tokens,
          verdict, lessons, error: r.error ? r.error.slice(0, 160) : null,
        };
      });
      const done = runs.filter((r) => r.status === "done").length;
      return { count: runs.length, done, runs };
    },
  },
  {
    id: "memory.read",
    name: "זיכרון-הצי",
    kind: "skill",
    desc: "בנק-הידע המשותף של הצי: ממצאים סופיים שנרשמו פעם-אחת (סטיות-authority, עובדות מאומתות, לקחים) — קרא אותו לפני שאתה חוקר מחדש; מה שכבר ידוע לצי לא שווה קריאת-רשת נוספת.",
    args: `{"limit":"1-20 (optional, default 12)","kind":"drift|finding|fact (optional)"}`,
    needsVault: false,
    cacheable: false, // new findings can land while the run lives — never memoize
    async exec(args) {
      const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 20);
      const kind = typeof args.kind === "string" && args.kind ? String(args.kind) : null;
      const rows = await db.gateMemory.findMany({
        where: kind ? { kind } : undefined,
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      // real usage telemetry — which knowledge the fleet actually consumes
      void db.gateMemory
        .updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { refCount: { increment: 1 } } })
        .catch(() => {});
      return {
        count: rows.length,
        facts: rows.map((r) => ({ key: r.key, kind: r.kind, body: r.body, by: r.source, reads: r.refCount, at: r.updatedAt.toISOString() })),
      };
    },
  },
  {
    id: "memory.write",
    name: "רישום לזיכרון-הצי",
    kind: "actor",
    desc: "רישום ממצא סופי לבנק-הידע המשותף — רק אמת שלא תשתנה בקרוב (סטיית-authority, עובדה מאומתת בכלי). אותו key מעדכן את הרשומה הקיימת במקום לשכפל; אסור לכתוב מחירים, יתרות או נתונים חולפים.",
    args: `{"key":"canonical-key (e.g. drift:headcorner)","kind":"drift|finding|fact","body":"≤500 chars, Hebrew"}`,
    needsVault: false,
    cacheable: false, // a real write — every call is a unique action
    async exec(args, ctx) {
      const key = String(args.key || "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 80);
      const body = String(args.body || "").trim();
      const kind = ["drift", "finding", "fact"].includes(String(args.kind)) ? String(args.kind) : "finding";
      if (key.length < 4) throw new GateError("bad-input", "דרוש params.key קנוני (4+ תווים, למשל drift:headcorner)");
      if (body.length < 8) throw new GateError("bad-input", "דרוש params.body — הידע עצמו (8+ תווים)");
      const row = await db.gateMemory.upsert({
        where: { key },
        create: { key, kind, body: clamp(body, 500), source: ctx.agentName, runId: ctx.runId },
        update: { kind, body: clamp(body, 500), source: ctx.agentName, runId: ctx.runId },
      });
      // total-cap: the bank must never bloat — evict the oldest beyond the cap
      const CAP = 150;
      const total = await db.gateMemory.count();
      if (total > CAP) {
        const olds = await db.gateMemory.findMany({ orderBy: { updatedAt: "asc" }, take: total - CAP, select: { id: true } });
        if (olds.length) await db.gateMemory.deleteMany({ where: { id: { in: olds.map((o) => o.id) } } }).catch(() => {});
      }
      return { key: row.key, kind: row.kind, at: row.updatedAt.toISOString(), note: "נשמר בזיכרון-הצי — כל סוכן יקרא את זה לפני שיחקור מחדש" };
    },
  },
  {
    id: "goal.propose",
    name: "יוזמת-יעד",
    kind: "actor",
    desc: "הצעת מטרה חדשה מיוזמתך: מטרה + נימוק + קריטריוני-סיום. ההצעה נכנסת לתור-ההכרעה — המפעיל מאשר ב-UI, או מדיניות אוטומטית מרוסנת (מקס-יומי לצי + תקציב-מקס) מזניקה לבד. אל תציע מה שאתה יכול לבצע עכשיו בכלים שלך — חובתך לבצע, לא להציע.",
    args: `{"goal":"string (20+ chars)","rationale":"string","doneMeans":["string",...],"budget":"2-6 (optional)"}`,
    needsVault: false,
    cacheable: false, // a real submission — never memoize
    async exec(args, ctx) {
      const goal = String(args.goal || "").trim();
      if (goal.length < 20) throw new GateError("bad-input", "דרוש params.goal אמיתי (20+ תווים) — מה בדיוק לעשות ולמה זה שווה");
      const rationale = String(args.rationale || "").trim();
      const means = Array.isArray(args.doneMeans)
        ? args.doneMeans.map((d) => String(d).trim()).filter(Boolean).slice(0, 4).map((d) => d.slice(0, 200))
        : [];
      if (!means.length) throw new GateError("bad-input", "דרוש params.doneMeans — איך ידעו שהיעד הושלם (הצעה בלי שער-מעבר נדחית)");
      const budget = Math.min(Math.max(Number(args.budget) || 4, 2), 6);
      // one pending proposal per agent — initiative, not spam
      const pending = await db.gateProposal.count({ where: { agentName: ctx.agentName, status: "pending" } });
      if (pending >= 1) throw new GateError("rate-limited", "יש לך כבר הצעה פתוחה בתור — חכה להכרעה לפני הצעה חדשה");
      const p = await db.gateProposal.create({
        data: {
          agentName: ctx.agentName,
          goal: goal.slice(0, 400),
          rationale: rationale ? rationale.slice(0, 400) : null,
          doneMeans: JSON.stringify(means),
          budget,
        },
      });
      await db.gateMessage
        .create({
          data: {
            channel: "command",
            fromKind: "agent",
            fromName: ctx.agentName,
            body: `💡 יוזמת-יעד: "${goal.slice(0, 200)}"${rationale ? ` · נימוק: ${rationale.slice(0, 160)}` : ""} · תקציב מוצע: ${budget} — ממתינה להכרעה (מפעיל או מדיניות מרוסנת)`,
            meta: JSON.stringify({ proposalId: p.id }),
          },
        })
        .catch(() => {});
      return {
        proposalId: p.id,
        status: p.status,
        note: "ההצעה בתור — המפעיל רואה אותה בכרטיס לב-האוטונומיה; מדיניות מרוסנת עשויה להזניק אותה לבד",
      };
    },
  },
  {
    id: "steem.order.build",
    name: "יד-ריבונית: בניית פקודה",
    kind: "actor",
    desc: 'הכנת פקודת-המרה אמיתית במישור-ההמרות (r21): לימיט-קנייה/מכירה על ספר-הפנימי (STEEM/SBD או HIVE/HBD) או המרת-מדין (convert — מחיר-חוז של השרשרת, 3.5 ימים, בלי תלות בעומק-הספר). כל חשבון-צי שהכספת מחזיקה עבורו מפתח-active מאומת — לא רק המפקד (params.account). בנייה אינה נוגעת במפתחות ואינה מזיזה כסף: הפקודה נכנסת לתור-החתימה, והכספת חותמת עם המפתח-הפעיל של חשבון-הפקודה עצמו רק לאחר אישור-מפעיל מפורש. תקרות: פקודה ממתינה אחת לסוכן, 100 לפקודה, 6 חתימות/יום לצי. חובה: בנה מול מחיר-שוק אמיתי (market.watch) — פקודה מרוחקת מהספר תידחה על-ידי המפעיל. blurt מוצא כנות מחוץ למישור (ספר-BBD לא נמדד).',
    args: '{"op":"create|cancel|convert (default create)","side":"buy|sell (create only)","amount":"10.000 (liquid leg on create; DEBT leg SBD/HBD on convert)","price":"0.098 (create only)","rail":"steem|hive (default steem)","account":"fleet account with verified vault active key (default headcorner)","ttlSeconds":3600,"cancelOrderid":123}',
    needsVault: false,
    cacheable: false, // a real submission — every build is a unique pending order
    async exec(args, ctx) {
      const p = await createOrderFromAgent({
        agentName: ctx.agentName,
        runId: ctx.runId,
        op: typeof args.op === "string" ? args.op : undefined,
        side: typeof args.side === "string" ? args.side : undefined,
        amount: typeof args.amount === "string" ? args.amount : undefined,
        price: typeof args.price === "string" ? args.price : undefined,
        ttlSeconds: Number(args.ttlSeconds) || undefined,
        cancelOrderid: Number(args.cancelOrderid) || undefined,
        rail: typeof args.rail === "string" ? args.rail : undefined,
        account: typeof args.account === "string" ? args.account : undefined,
      });
      return { ...p, meaning: "הפקודה ממתינה בתור — המפעיל רואה אותה בכרטיס יד-ריבונית; באישורו הכספת תחתום עם מפתח-החשבון עצמו והשרשרת תענה ב-txId אמיתי" };
    },
  },
  {
    id: "fleet.treasury",
    name: "אמת-הכיס של הצי",
    kind: "skill",
    desc: 'מדידת-כיס חיה (r21): היתרות האמתיות של כל חשבונות-הצי על שלוש-המסילות — נזיל (STEEM/HIVE/BLURT), חוב (SBD/HBD/BBD) וvesting — ישר מהשרשרות (condenser get_accounts). קרא לפני שאתה בונה פקודת-המרה: כך יודעים "מה צריך להמיר" במקום לנחש. כל-מסילה נכשלת בכנות בנפרד.',
    args: "{}",
    needsVault: false,
    cacheable: true, // 30s in-process cache inside the snapshot itself
    async exec() {
      const snap = await getTreasurySnapshot(true);
      const summary = snap.rails.map((r) => ({
        rail: r.rail,
        ok: r.ok,
        accounts: r.accounts.length,
        totals: r.ok ? `${r.totals.liquid} ${r.liquidSymbol} · ${r.totals.debt} ${r.debtSymbol}` : null,
        error: r.error,
      }));
      return { measuredAt: snap.measuredAt, summary, rails: snap.rails, meaning: "אמת-הכיס נמדדה חי — בנה פקודות-המרה על מה שקיים בפועל, לא על הנחות" };
    },
  },
  {
    id: "fleet.situation",
    name: "מצב-העניינים — הכל במקום אחד",
    kind: "skill",
    desc: 'המודעות הריבונית המלאה בקריאה אחת (r22): הכסף על שלוש-המסילות, יתרות ETH/SOL של הארנקים מהכספת, תגמולים-ממתינים (מה אפשר לקצור), ספירת-הכספת, הצי (סוכנים/ריצות-פעילות), והעוגנים — וגם מה קורה בשאר-הריפו של הארגון (roshpinacare-sys): 12 מאגרים, מה נדחף לאחרונה ומאיזה סוכן-אחר. קרא לפני כל החלטה — כך רואים את כל היד ולא רק קלף אחד. מטמון 60s, כל-מקטע נכשל בכנות בנפרד.',
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const s = await getSituationSnapshot(true);
      const money = s.treasury.rails.map((r) => ({ rail: r.rail, ok: r.ok, totals: r.ok ? `${r.totals.liquid} ${r.liquidSymbol}` : r.error }));
      return {
        measuredAt: s.measuredAt,
        money,
        evm: { eth: `${s.evm.ethereum.total} ETH (${s.evm.ethereum.okWallets}/${s.evm.ethereum.wallets} ארנקים)`, sol: `${s.evm.solana.total} SOL (${s.evm.solana.okWallets}/${s.evm.solana.wallets} ארנקים)` },
        pendingRewards: s.rewards.totalPendingSteemEquiv > 0 ? { total: s.rewards.totalPendingSteemEquiv, accounts: s.rewards.pendingAccounts } : "אפס ממתינים — הכל נתבע; הקציר הבא גדל עם תעסוקת-התוכן של הצי",
        vault: s.vault,
        fleet: s.fleet,
        orgRepos: { count: s.repos.count, fresh: s.repos.freshCount, repos: s.repos.repos.slice(0, 12).map((r) => `${r.ours ? "★" : " "}${r.name} (${r.pushedMinutesAgo ?? "?"} דק׳)`), note: "★ = הריפו שלנו (Saosmartwallet); טרי = נדחף ב-3 השעות האחרונות — סוכנים אחרים פעילים שם עכשיו" },
        anchors: s.anchors.latest.map((a) => `${a.chain} blk ${a.blockNum} · ${a.round}`),
        meaning: "הכספת רואה את כל היד: מה יש, מה חסר, מה קורה בכל מקום — קבל החלטות מהאמת הזאת, לא מהנחות",
      };
    },
  },
  {
    id: "fleet.digest",
    name: "קריאת-השידורים — מה באמת נאמר",
    kind: "skill",
    desc: 'המישור-המבין (r25): הכספת לא רק שומעת את ערוץ-השידורים — היא קוראת אותו. לכל ריפו-שותף נשלף תוכן-השידור האחרון (חסום, על-אותו-קצב 10 דק׳), ממוחשק (sha256), ומזוהה: הד של הדוח שלנו מול קול-אמיתי של שותף; סוג-הדיבור (דוח/שאלה/בקשה/התראה), שפה, כותרת, והשאלות/בקשות שהשותף מציב לנו. מטייטת תשובה (טיוטה-בלבד — השליחה החלטת-מפעיל/סוכן, אף-כתיבה-שקטה לריפו-שותף). קרא לפני שאתה עונה לסוכן-אחר — כך יודעים מה נאמר באמת ומה כבר נקרא.',
    args: "{}",
    needsVault: false,
    cacheable: true, // 10-min stale-while-revalidate inside the digest itself
    async exec() {
      const d = await getBroadcastDigest(true);
      // r31 — עיוורון-החיתוך נסגר (אותו-משפחה כמו vault.map/steem.rewards):
      // האובייקט-המלא נחתך-על-תקרת-התוצאה, והמייצר נשאר עם-הספירות-בלבד בלי
      // לראות את הקולות-עצמם. השדות-הפעילים (משמעות · סיכום · הקולות) ראשונים —
      // JSON.stringify שומר-סדר-מפתחות, ולכן-גם-הראש-החתוך מציג-את-מה-שאפשר
      // לפעול-לפיו; suggestedResponse בסוף (הטיוטה-שלנו-היא-memory.write של-הסוכן).
      return {
        meaning: d.partnerVoices > 0
          ? "קול-שותף נשמע בערוץ — קרא את השאלות/בקשות והחלט אם להשיב; שליחת-תשובה לערוץ-שותף דורשת אישור-מפעיל"
          : "הערוץ מהדהד כרגע רק את הדוח שלנו — דווח בכנות 'אין דופקים חדשים' והמשך לעבוד; הכספת תשמע כשמשהו חדש ייאמר",
        channel: { scanned: d.scannedRepos, fetched: d.fetched, failed: d.failed, uniqueContents: d.uniqueContents, echoesOfOurs: d.echoesOfOurs, partnerVoices: d.partnerVoices, newPartnerContents: d.newPartnerContents },
        voices: d.items.filter((i) => i.ok && !i.ours && !i.echo).map((i) => ({ repo: i.repo, kind: i.kind, lang: i.lang, headline: i.headline, asks: i.asks, isNew: i.isNew, hash: i.hash8 })),
        measuredAt: d.measuredAt,
        suggestedResponse: d.suggestedResponse,
      };
    },
  },
  {
    id: "steem.openorders",
    name: "הזמנות-פתוחות",
    kind: "skill",
    desc: "ההזמנות הפתוחות של המפקד headcorner על ה-DEX החי: מזהה-הזמנה, סוג (ask/bid), מחיר, גודל ותפוגה. קרא לפני שאתה בונה פקודה חדשה — אל תכפיל הזמנה קיימת.",
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const rows = await steemOpenOrders("headcorner");
      return { count: rows.length, orders: rows, account: "headcorner" };
    },
  },
  {
    id: "steem.post",
    name: "קול-ריבוני — פרסום",
    kind: "actor",
    desc: `פרסום פוסט/תגובה אמיתי מ-@headcorner (authority-posting — לעולם לא נוגע בכספים). מסילה: rail=steem (steemit.com) או rail=hive (peakd) — אותו מנוע-חותם, שרשרת-יעד שונה. מדיניות-חשיפה אוכפת חי: סודות/נתיבים/שמות-קוד/תוכניות לא יצאו — טיוטה חשופה נחסמת ומוחזרת לתיקון. תקרה ${SOCIAL_RAILS.maxPostsPerDay}/יום לצי. permlink + txId אמיתיים.`,
    args: `{"title":"string","body":"markdown ≤20000","tags":["≤5, [a-z0-9-]"],"rail":"steem|hive (ברירת-מחדל steem)","replyTo":{"author":"…","permlink":"…"} (optional — comment)}`,
    needsVault: true,
    cacheable: false,
    async exec(args, ctx) {
      const title = String(args.title || "").trim();
      if (!title) throw new GateError("bad-input", "דרוש params.title");
      const body = String(args.body || "").trim();
      if (!body) throw new GateError("bad-input", "דרוש params.body (markdown)");
      const tags = Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : [];
      if (!tags.length) throw new GateError("bad-input", 'דרוש params.tags (מערך, למשל ["steem","news"])');
      const rail = String(args.rail || "steem") === "hive" ? "hive" as const : "steem" as const;
      let replyTo: { author: string; permlink: string } | undefined;
      if (args.replyTo && typeof args.replyTo === "object") {
        const rt = args.replyTo as { author?: unknown; permlink?: unknown };
        if (typeof rt.author === "string" && typeof rt.permlink === "string") replyTo = { author: rt.author, permlink: rt.permlink };
      }
      const r = await publishPostFromAgent({ agentName: ctx.agentName, runId: ctx.runId, title, body, tags, rail, replyTo });
      return { ...r, meaning: `פורסם חי בשרשרת (${r.rail}) — ${r.url}` };
    },
  },
  {
    id: "steem.edit",
    name: "קול-ריבוני — עריכת פוסט",
    kind: "actor",
    desc: `עריכת פוסט קיים של @headcorner על מסילה (steem|hive): שליפת המקור מהשרשרת, שימור permlink+קטגוריה+תגיות, שער מדיניות-החשיפה, ושידור גרסה מתוקנת. זו דרך-הצי לתקן תוכן חשוף/שגוי — מהר, בגבולות (${SOCIAL_RAILS.maxEditsPerDay}/יום), בלי לרסק היסטוריה. txId אמיתי מוחזר.`,
    args: `{"permlink":"string (הפוסט הקיים)","title":"string","body":"markdown חדש","rail":"steem|hive (ברירת-מחדל steem)","tags":["optional — ברירת-מחדל: תגיות המקור"]}`,
    needsVault: true,
    cacheable: false,
    async exec(args, ctx) {
      const permlink = String(args.permlink || "").trim();
      if (!permlink) throw new GateError("bad-input", "דרוש params.permlink של הפוסט הקיים (קרא social.audit קודם)");
      const title = String(args.title || "").trim();
      if (!title) throw new GateError("bad-input", "דרוש params.title");
      const body = String(args.body || "").trim();
      if (!body) throw new GateError("bad-input", "דרוש params.body (הגוף המתוקן המלא)");
      const rail = String(args.rail || "steem") === "hive" ? "hive" as const : "steem" as const;
      const tags = Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : undefined;
      const r = await editPostFromAgent({ agentName: ctx.agentName, runId: ctx.runId, permlink, title, body, rail, tags });
      return { ...r, meaning: `הפוסט נערך חי בשרשרת (${r.rail}) — ${r.url}` };
    },
  },
  {
    id: "social.audit",
    name: "ביקורת-פרסום חיה",
    kind: "connector",
    desc: 'האמת מהשרשראות: הפידים האחרונים של @headcorner על steem ו-hive, כל פוסט נסרק מול מדיניות-החשיפה — מה פורסם, מתי, באילו תגיות, איזה תגמול, ומה מדוגל לעריכה (סודות/שמות-קוד/דוחות פנימיים שדלפו). זה עונה ״מי מפרסם מה ואיך, ומה חייב לצאת או להתוקן״. קרא את זה לפני פרסום/עריכה.',
    args: `{"limit":"1..10 למסילה (ברירת-מחדל 8)"}`,
    needsVault: false,
    cacheable: true,
    async exec(args) {
      const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 10);
      const audit = await auditFleetContent(limit);
      // ROAST r7 — the first-ever live editor run (45s, blocked) proved the
      // evidence-pipe hole: the full audit object blows past the 1400-char
      // result clamp, and the flagged post (deep in the posts array) never
      // reached the brain — which then hallucinated placeholder permlinks and
      // burned its budget. The module must LEAD with the actionable evidence,
      // compact enough to survive the clamp intact.
      const flagged = audit.posts.filter((p) => p.needsEdit);
      const immutableOnly = audit.posts.filter((p) => !p.needsEdit && p.immutableFindings.length > 0);
      const compact = {
        rails: audit.rails,
        flaggedPosts: flagged.map((p) => ({
          rail: p.rail,
          permlink: p.permlink,
          title: String(p.title || "").slice(0, 60),
          findings: p.findings.slice(0, 4),
          note: "needsEdit — זה הפוסט לתיקון",
        })),
        immutablePosts: immutableOnly.map((p) => ({
          rail: p.rail,
          permlink: p.permlink,
          findings: p.immutableFindings.slice(0, 2),
          note: "immutable (parent_permlink נחרת בפרסום) — אין לנסות עריכה; חשיפה בלבד",
        })),
        cleanPosts: audit.posts.length - flagged.length - immutableOnly.length,
        customJson: audit.customJson
          ? {
              windowOps: audit.customJson.windowOps,
              codenameOps: audit.customJson.codenameOps,
              originNote: String(audit.customJson.originNote || "").slice(0, 140),
            }
          : undefined,
        meaning:
          flagged.length > 0
            ? `דוגלים לעריכה (${flagged.length}): ${flagged.map((p) => `${p.rail}/${p.permlink}`).join(" · ")}. ` +
              `עבור דוגל-על-hive: עריכת-hive עלולה להיתקל בחומת-משאבים של השרשרת — נסה עם rail=hive ואם נחסמת תעד בכנות ועבור הלאה. ` +
              (immutableOnly.length > 0 ? `${immutableOnly.length} פוסטים נוספים נושאים ממצא-immutable בלבד — אין לערוך אותם.` : "")
            : "אפס דוגלים לעריכה — הפיד נקי (אין מה לתקן זו הצלחה מלאה). " +
              (immutableOnly.length > 0 ? `${immutableOnly.length} פוסטים נושאים ממצא-immutable שאינם ניתנים לתיקון בעריכה — מדווחים בכנות.` : ""),
      };
      return compact;
    },
  },
  {
    id: "social.rails",
    name: "מסילות-הפרסום",
    kind: "connector",
    desc: "תמונת-מצב חיה של מסילות-הפרסום של הרשת (steem/hive/blurt): איזו שרשרת חיה ועד איזה בלוק, איזה חשבונות יש לנו שם, והאם מפתח-ה-posting בכספת אומת מול הסמכות בשרשרת עצמה (השוואת מפתח-ציבורי 33 בייט). זה לוח-ההמראה לפני כל פרסום רב-מסילתי.",
    args: "{}",
    needsVault: true,
    cacheable: true,
    async exec() {
      const o = await fleetRailsOverview();
      return { ...o, meaning: `steem: ${o.rails[0]?.reachable ? `חי @ ${o.rails[0].headBlock}` : "לא נגיש"} · hive: ${o.rails[1]?.reachable ? `חי @ ${o.rails[1].headBlock}` : "לא נגיש"} · blurt: ${o.rails[2]?.reachable ? "חי" : "סגור (אין endpoint מאומת)"}` };
    },
  },
  {
    id: "steem.interact",
    name: "קול-ריבוני — אינטראקציה",
    kind: "actor",
    desc: `הצבעה / מעקב / reblog אמיתי מ-@headcorner (authority-posting). מסילות: ${SOCIAL_RAILS.maxInteractionsPerDay} אינטראקציות/יום, הצבעה ≤${SOCIAL_RAILS.maxVoteWeight}/10000 (~20%) — הצבע מתוך שיקול-דעת על תוכן שאכן שווה, לעולם לא ספאם. דרוש permlink אמיתי (מצא אותו קודם). txId אמיתי מוחזר.`,
    args: `{"action":"vote|follow|reblog","author":"account","permlink":"string (vote/reblog)","weight":"1..${SOCIAL_RAILS.maxVoteWeight} (vote, ברירת-מחדל ${SOCIAL_RAILS.maxVoteWeight})"}`,
    needsVault: true,
    cacheable: false,
    async exec(args, ctx) {
      const action = String(args.action || "");
      if (!["vote", "follow", "reblog"].includes(action)) throw new GateError("bad-input", 'דרוש params.action ("vote"|"follow"|"reblog")');
      const r = await interactFromAgent({
        agentName: ctx.agentName,
        runId: ctx.runId,
        action: action as "vote" | "follow" | "reblog",
        author: String(args.author || ""),
        permlink: String(args.permlink || ""),
        weight: Number(args.weight) || undefined,
        unfollow: args.unfollow === true,
      });
      return { ...r, meaning: `פעולה חיה בשרשרת — ${r.detail}` };
    },
  },
  {
    id: "steem.rewards",
    name: "אוצר-ריבוני — סקר תגמולים",
    kind: "connector",
    desc: 'האמת על הכסף שהצי הרוויח: סקר חי של כל חשבונות-הצי על steem — תגמולי-סופרים ותגמולי-קוראים שנצברו וממתינים ברנק (reward_*) עדיין לא הועברו ליתרה הניתנת-לשימוש. על steem, תגמול נשאר "תקוע" עד שפעולת claim_reward_balance חתומה מביאה אותו ליתרות בפועל — זו בדיוק הסיבה ש"יש תגמול בארנק ואי אפשר לממש אותו". הסקר מציג לכל חשבון: מה ממתין, שקול-STEEM, והאם יש לנו מפתח-posting בכספת לתבוע בשמו. קרא את זה לפני steem.claim.',
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const c = await fleetRewardsCensus();
      return { ...c, meaning: c.summary };
    },
  },
  {
    id: "steem.claim",
    name: "אוצר-ריבוני — תביעת תגמולים",
    kind: "actor",
    desc: `תביעה אמיתית של התגמולים הממתינים של חשבון-צי על steem: השער קורא את היתרות-הממתינות מהשרשרת עצמה (לעולם לא מהפרמטרים שלך), מוכיח שמפתח-הכספת הוא הסמכות-הנוכחית, משדר claim_reward_balance חתום עם מפתח-posting (לעולם לא נוגע בכספים — זו סמכות-הקציר שהשרשרת עצמה נותנת), וקורא שוב כדי לאמת שהממתינים התאפסו. תקרה ${SOCIAL_RAILS.maxClaimsPerDay}/יום לצי. txId אמיתי + אימות חי מוחזרים. אם אין מה לתבוע — תקבל תשובה כנה, לא שגיאה-שקרית.`,
    args: '{"account":"ברירת-מחדל headcorner — חשבון אחר רק אם steem.rewards הראה שיש לו ממתינים"}',
    needsVault: true,
    cacheable: false,
    async exec(args, ctx) {
      const r = await claimRewardsFromAgent({
        agentName: ctx.agentName,
        runId: ctx.runId,
        account: typeof args.account === "string" ? args.account : undefined,
      });
      return {
        ...r,
        meaning: `תביעה חיה בשרשרת: @${r.account} קיבל ${r.claimed.steem} + ${r.claimed.sbd} + ${r.claimed.vests} — txId ${r.txId}${r.verified ? " · אומת חי (הממתינים אופסו)" : ""}`,
      };
    },
  },
  {
    id: "steem.trends",
    name: "מכ\"ם-נושאים — מה הרשת קוראת עכשיו",
    kind: "connector",
    desc: 'אינטליגנציה-מערכתית חיה מהשרשרת עצמה: תגיות-חמות לפי תשלומים אמיתיים (get_trending_tags), דיונים-חמים לפי מעורבות (get_discussions_by_trending), ומהם — מועמדויות-נושא באנגלית לפרסום היומי, נגזרות מהביקוש-החי ולא מניחוש. קרא את זה לפני שאתה כותב משהו לרשת — הערך של פוסט נמדד בקוראים, והקוראים נמדדים בשרשרת. קריאה-בלבד, נתונים פומביים.',
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const t = await steemTrends();
      return { ...t, meaning: t.summary };
    },
  },
  {
    id: "fleet.status",
    name: "צי-החיילים",
    kind: "skill",
    desc: "מצב חי של צבא-ה-STEEM שלנו (13 חשבונות: המפקד headcorner + חיילי-מסחר + powerspan): SP, כוח-הצבעה, RC, פעילות-אחרונה אמיתית מהשרשרת ומי 'מחובר' (RC מעל הרצפה). העיניים שלך על הצי.",
    args: "{}",
    needsVault: false,
    cacheable: true, // fleetStatusCached() → shared cache: N agents = 1 RPC read
    async exec() {
      const f = await fleetStatusCached();
      if (!f.ok) return { ok: false, error: f.error || "fleet probe failed", measuredAt: f.measuredAt };
      return {
        ok: true, measuredAt: f.measuredAt, total: f.total, online: f.online, liveAccounts: f.liveAccounts,
        statusLine: f.statusLine,
        soldiers: f.soldiers.slice(0, 15).map((s) => ({
          name: s.name, role: s.role, sp: s.sp, vpPct: s.vpPct, rcPct: s.rcPct, online: s.isOnline,
          last: s.lastActivity ? `${s.lastActivity.type} · ${s.lastActivity.ageMinutes}min` : null,
        })),
      };
    },
  },
  {
    id: "saos.hub",
    name: "לב-הכלכלה הריבונית",
    kind: "skill",
    desc: "תמונת-מצב אחת של כלכלת SAOS הריבונית: גובה-השרשרת ועיגונים, מנוע-המסחר (PnL-אוצר, טרנזקציות, מדרגות-רצפה), כלוב-נכסים 1:1, בריכות-AMM, אורקל, גשר-TRON ומפקד-הלולאות. הכל נמדד, כלום לא מומצא.",
    args: "{}",
    needsVault: false,
    cacheable: true, // saosHubCached() → 30s shared cache
    async exec() {
      const h = await saosHubCached();
      if (!h.ok) return { ok: false, error: h.stateError || "saos-hub unavailable", fetchedAt: h.fetchedAt };
      return {
        ok: true, fetchedAt: h.fetchedAt,
        core: h.core ? { height: h.core.height, checkpoints: h.core.checkpointCount, verified: h.core.verifiedCount, cadenceSec: h.core.checkpointCadenceSeconds, updatedAt: h.core.updatedAt } : null,
        engine: h.engine ? { tradesToday: h.engine.tradesToday, txsToday: h.engine.txsToday, tradesTotal: h.engine.tradesTotal, treasuryPnlSAOS: h.engine.treasuryPnlSAOS, treasuryPnlTodaySAOS: h.engine.treasuryPnlTodaySAOS, floor: h.engine.floor, bench: h.engine.bench } : null,
        gates: h.gates, floorSteps: h.floorSteps.slice(-3),
        steemAccountsLive: h.steemAccountsLive,
        loops: { agent: h.loops.agent.length, node: h.loops.node.length },
        wrapped: Array.isArray(h.wrapped) ? h.wrapped.length : null,
        pools: Array.isArray(h.pools) ? h.pools.length : null,
        oracleQuotes: Array.isArray(h.oracle) ? h.oracle.length : null,
        tronBridge: h.tronBridge ? { anchors: h.tronBridge.anchors, last: h.tronBridge.lastAnchor, usdtTotal: h.tronBridge.usdtTotal } : null,
        anchors: h.anchors.slice(-2).map((a) => ({ chain: a.chain, cpHeight: a.cpHeight, txid: a.txid })),
        facts: h.facts.slice(-3).map((f) => ({ at: f.at, kind: f.kind, text: f.text.slice(0, 160) })),
      };
    },
  },
  {
    id: "identity.anchor",
    name: "הוכחת-ריבונות",
    kind: "skill",
    desc: "אימות מתמטי שסקלר secp256k1 אחד קושר Steem + Hive + כתובת EVM: קורא את עיגון saos.id.v1 האחרון מהשרשרת, מריץ ecrecover על EIP-191 ומשווה מול ה-authority החי. חשוב: ok=false עם drift=true זה ממצא אמיתי (סטיית-authority — המפתח הוסב מאז העיגון), לא כשל-קריאה. אל תחזור על הקריאה — דווח על הממצא.",
    args: `{"username":"headcorner (optional)"}`,
    needsVault: false,
    cacheable: true,
    cacheKeyOf: (args) => `verify:${String(args.username || "headcorner").replace(/^@/, "").toLowerCase()}`,
    async exec(args) {
      const username = String(args.username || "headcorner").replace(/^@/, "");
      if (!/^[a-z0-9.\-]{3,16}$/.test(username)) throw new GateError("bad-input", "שם-חשבון לא תקין");
      const v = await verifyIdentityAnchor(username);
      const drift = Boolean(v.verify?.claimedMatchesRecovered) && !v.verify?.activeKeyEqualsRecovered;
      return {
        ok: v.ok, username: v.username, error: v.error,
        drift, // AUTHORITY DRIFT — the anchor is internally valid but the live active key moved. A finding, not a call failure.
        finding: drift ? "סטיית-authority: העיגון חתום נכון על הכתובת הנטענת, אבל המפתח-הפעיל החי כיום נגזר לכתובת EVM אחרת — המפתח הוסב מאז. זו תשובה סופית של הבדיקה; אין טעם לחזור עליה." : undefined,
        anchor: v.anchor ? { trxId: v.anchor.trxId, block: v.anchor.block, at: v.anchor.timestamp, claimedEvm: v.anchor.claimedEvm } : null,
        verify: v.verify ? { recoveredEvm: v.verify.recoveredEvm, claimedMatchesRecovered: v.verify.claimedMatchesRecovered, activeKeyEqualsRecovered: v.verify.activeKeyEqualsRecovered, sameScalarProof: v.verify.sameScalarProof, scanned: v.verify.scanned } : null,
        chains: (v.chains || []).map((c) => ({ chain: c.chain, sameKeyAsSteem: c.sameKeyAsSteem, note: c.note ? c.note.slice(0, 120) : undefined })),
        summary: v.summary ? v.summary.slice(0, 300) : undefined,
      };
    },
  },
  {
    id: "market.watch",
    name: "צופה-שוק",
    kind: "connector",
    desc: "שוק STEEM/SBD החי: טיקר (מחיר אחרון, גבוה/נמוך, נפח), ספר-הזמנות (asks/bids) ומצב-השרשרת — ישירות מה-DEX האמיתי. הבסיס לכל החלטת-מסחר או הערכת-שווי.",
    args: `{"depth":"orderbook rows, 1-25 (optional, default 10)"}`,
    needsVault: false,
    cacheable: true,
    async exec(args) {
      const depth = Math.min(Math.max(Number(args.depth) || 10, 1), 25);
      const m = steemMarket();
      const [ticker, book, chain] = await Promise.all([m.ticker(), m.orderBook(depth), m.chainStatus()]);
      return {
        ticker: ticker ?? null, chainStatus: chain ?? null,
        asks: (book?.asks ?? []).slice(0, depth).map((a) => ({ price: a.price, amount: a.steemAmount })),
        bids: (book?.bids ?? []).slice(0, depth).map((b) => ({ price: b.price, amount: b.steemAmount })),
      };
    },
    cacheKeyOf: (args) => `depth:${Math.min(Math.max(Number(args.depth) || 10, 1), 25)}`,
  },
  {
    id: "net.health",
    name: "בריאות-הרשת כולה",
    kind: "skill",
    desc: "סקר-חי אחד: הרשתות שלנו (steem/hive/SAOS-NET/TRON ועוד) עם גובה-ראש ושהות, מצב-הכספת (נעולה/פתוחה, כמה סודות), הסוכנים, ודופק לב-האוטונומיה (פעימות, מונים). לפני כל פעולה גדולה — דע על איזו רשת אתה עומד.",
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const [eco, entries, agents] = await Promise.all([
        ecoNetworks(),
        db.vaultEntry.count(),
        db.gateAgent.count({ where: { active: true } }),
      ]);
      const pulseRow = await db.gateState.findUnique({ where: { key: "heart" } });
      let heart: unknown = null;
      try {
        if (pulseRow) {
          const p = JSON.parse(pulseRow.value) as { enabled?: boolean; beats?: number; lastTickAt?: string; counters?: Record<string, number> };
          heart = { enabled: p.enabled ?? null, beats: p.beats ?? null, lastTickAt: p.lastTickAt ?? null, counters: p.counters ?? null };
        }
      } catch {}
      return {
        measuredAt: new Date().toISOString(),
        chains: (eco.chains || []).map((c) => ({ id: c.id, status: c.status, head: c.headHeight, lagSec: c.lagSeconds, note: c.note ? c.note.slice(0, 100) : null })),
        vault: { entries, unlocked: masterReady() },
        agents, heart,
      };
    },
  },

  /* ═══════════════ r15 — network-presence employment (תעסוקת-רשת) ═══════════════
   * The r14 lesson: a fleet with proven brains but thin missions idles at the
   * exact moment the network needs it. These six modules are REAL WORK that
   * advances the network: proving the rails live, counting our presence on
   * them, measuring whether our voice gets heard, scanning our governance
   * footprint, closing the imported-vault backlog, and letting agents design
   * their own recurring patrols (operator-gated). Public data only — no key
   * ever leaves the vault. */
  {
    id: "chain.pulse",
    name: "דופק-שרשראות — הוכחת-חיים כפולה",
    kind: "connector",
    desc: 'הוכחת-חיים כפולה של steem/hive/blurt: לכל מסילה — דגימת ראש-שרשרת פעמיים בהפרש ~2.5 שניות; דלתא-בלוקים > 0 היא ראיה מכנית שהשרשרת מייצרת בלוקים עכשיו (לא "התחבר" — מייצרת). מדווח ראש, דלתא, עדכון-אחרון, וזמינות-עדים לפי הדינמיקה החיה. קריאה-בלבד, נתונים פומביים.',
    args: "{}",
    needsVault: false,
    cacheable: false, // two samples per rail — a cache would fake the delta
    async exec() {
      const rails: Array<"steem" | "hive" | "blurt"> = ["steem", "hive", "blurt"];
      const sample = (r: typeof rails[number]) => railRpc<{ head_block_number?: number; time?: string }>(r, "condenser_api.get_dynamic_global_properties", []);
      const out: Array<{ rail: string; ok: boolean; retried?: boolean; headBefore?: number; headAfter?: number; delta?: number; nodeTime?: string; error?: string }> = [];
      // One honest retry per rail: a transient node window (live-proven r18 —
      // a "Bad Cast" burst on every rail at once, gone minutes later) must not
      // turn into a false "chain not alive" claim (living-truth law).
      for (const r of rails) {
        let retried = false;
        let headBefore = 0;
        let headAfter = 0;
        let nodeTime: string | undefined;
        try {
          const a = await sample(r);
          // 4.2s between samples: all three rails produce 3s blocks — a
          // shorter window reads healthy chains as "delta 0" about half the
          // time, and a false "not alive" is a false claim (living-truth law)
          await new Promise((res) => setTimeout(res, 4200));
          const b = await sample(r);
          headBefore = Number(a.head_block_number) || 0;
          headAfter = Number(b.head_block_number) || 0;
          nodeTime = b.time ?? undefined;
        } catch {
          retried = true;
          await new Promise((res) => setTimeout(res, 2500));
          try {
            const a = await sample(r);
            await new Promise((res) => setTimeout(res, 4200));
            const b = await sample(r);
            headBefore = Number(a.head_block_number) || 0;
            headAfter = Number(b.head_block_number) || 0;
            nodeTime = b.time ?? undefined;
          } catch (e2) {
            out.push({ rail: r, ok: false, retried, error: (e2 instanceof Error ? e2.message : String(e2)).slice(0, 160) });
            continue;
          }
        }
        out.push({ rail: r, ok: headAfter > headBefore, retried, headBefore, headAfter, delta: headAfter - headBefore, nodeTime });
      }
      const alive = out.filter((o) => o.ok);
      return {
        measuredAt: new Date().toISOString(),
        rails: out,
        meaning: alive.length
          ? `חיות ${alive.length}/3 מסילות: ${alive.map((o) => `${o.rail} +${o.delta} בלוקים (ראש ${o.headAfter})`).join(" · ")}${alive.length < 3 ? ` — לא-חיה: ${out.filter((o) => !o.ok).map((o) => o.rail).join(",")}` : ""}`
          : `אף-מסילה לא הוכיחה ייצור-בלוקים בדגימה — תעד בכנות: ${out.map((o) => o.rail).join(" | ")}`,
      };
    },
  },
  {
    id: "fleet.presence",
    name: "נוכחות-הצי ברשת — מפקד חי",
    kind: "skill",
    desc: 'מפקד-נוכחות חי של 12 חשבונות-הצי על שלוש-המסילות (steem/hive/blurt): לאילו קיימים שם, מתי נוצרו, כמה פוסטים, יתרות-נזילות, כוח-שרשרת (vesting), עוקבים, ומתי הפעילות-האחרונה. זו האמת על "איפה אנחנו ברשת" — לא מטענה, מדידה. עליה בונים: פרסום מרובה-מסילה, הערכת-השפעה, וזיהוי חשבונות-רדומים.',
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const rails: Array<"steem" | "hive" | "blurt"> = ["steem", "hive", "blurt"];
      const names = [...FLEET_ACCOUNTS];
      const per = await Promise.all(
        rails.map(async (rail) => {
          try {
            const rows = await railAccounts(rail, names);
            const found = rows.map((a) => ({
              name: a.name,
              created: a.created ? String(a.created).slice(0, 10) : null,
              posts: Number(a.post_count) || 0,
              followers: typeof a.follower_count === "number" ? a.follower_count : null,
              liquid: a.balance ?? a.hbd_balance ?? null,
              vesting: a.vesting_shares ?? null,
              lastPost: a.last_post ? String(a.last_post).slice(0, 10) : null,
            }));
            return { rail, reachable: true, found, missing: names.filter((n) => !found.some((f) => f.name === n)) };
          } catch (e) {
            return { rail, reachable: false, found: [], missing: names, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
          }
        }),
      );
      const summary = per
        .map((p) => `${p.rail}: ${p.reachable ? `${p.found.length}/${names.length} חשבונות` : "לא-נגישה"}`)
        .join(" · ");
      // r18: the run trace is CLAMPED to 1400 chars for the checker's context
      // — the old shape (12 accounts × 7 fields × 3 rails, accounts first)
      // pushed hive/blurt past the clamp, so the checker honestly saw "only
      // steem data" and blocked a truthful measurement. Summary rides FIRST;
      // per-account detail is compact so all three rails survive the clamp.
      return {
        measuredAt: new Date().toISOString(),
        meaning: `נוכחות-חיה — ${summary}. השווה בין-המסילות: איפה אנחנו חזקים, איפה חסרים, ומי רדום (אפס-פוסטים/לא-מאוחר-פעילות).`,
        rails: per.map((p) => ({
          rail: p.rail,
          reachable: p.reachable,
          count: p.found.length,
          missing: p.missing.slice(0, 4),
          error: (p as { error?: string }).error,
          // RESULT_CLAMP is 1400 chars — 3 accounts × 4 fields × 3 rails fits
          // inside it with the summary; the counts carry the full truth.
          accounts: p.found.slice(0, 3).map((a) => ({
            name: a.name,
            posts: a.posts,
            followers: a.followers,
            lastPost: a.lastPost,
          })),
        })),
      };
    },
  },
  {
    id: "social.engagement",
    name: "מדידת-הד — האם הרשת שומעת אותנו",
    kind: "connector",
    desc: 'סגירת-הלולאה של הקול-הריבוני: הפוסטים-האחרונים של @headcorner על שלוש-המסילות — לכל אחד הצבעות-אמיתיות (net_votes), תגובות (children) ותשלום-ממתין. "פרסמנו" אינו הצלחה; "הרשת קראה והגיבה" היא. מדוד את ההד, זהה איזו מסילה קוראת אותנו, ודווח בכנות גם על אפס-הד.',
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const rails: Array<"steem" | "hive" | "blurt"> = ["steem", "hive", "blurt"];
      const per = await Promise.all(
        rails.map(async (rail) => {
          try {
            const posts = await railBlogPosts(rail, "headcorner", 5);
            const measured = posts.map((p) => ({
              permlink: String(p.permlink || "").slice(0, 80),
              title: String(p.title || "").slice(0, 70),
              votes: Number(p.netVotes) || 0,
              comments: Number(p.comments) || 0,
              payout: String(p.payout || "").slice(0, 24) || null,
              at: p.created ? String(p.created).slice(0, 10) : null,
            }));
            const totalVotes = measured.reduce((s, m) => s + m.votes, 0);
            const totalComments = measured.reduce((s, m) => s + m.comments, 0);
            return { rail, reachable: true, posts: measured, totalVotes, totalComments };
          } catch (e) {
            return { rail, reachable: false, posts: [], totalVotes: 0, totalComments: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
          }
        }),
      );
      const line = per.map((p) => p.reachable ? `${p.rail}: ${p.posts.length} פוסטים · ${p.totalVotes} הצבעות · ${p.totalComments} תגובות` : `${p.rail}: לא-נגישה`).join(" · ");
      const heard = per.some((p) => p.reachable && (p.totalVotes > 0 || p.totalComments > 0));
      return {
        measuredAt: new Date().toISOString(),
        rails: per.map((p) => ({ rail: p.rail, reachable: p.reachable, posts: p.posts.slice(0, 5), totalVotes: p.totalVotes, totalComments: p.totalComments })),
        meaning: `מדידת-הד — ${line}. ${heard ? "יש הד: זהה איזה נושא/מסילה מגיבים אליו ושמור על הקצב." : "אפס-הד נמדד — זה ממצא כן, לא כשל: דווח והציע (goal.propose) אסטרטגיית-תוכן אחרת."}`,
      };
    },
  },
  {
    id: "governance.scan",
    name: "סריקת-ממשל — הצבעות-עדים ונציגויות",
    kind: "connector",
    desc: 'טביעת-הרגל-הממשלתית של הצי: לכל חשבונות-הצי על steem/hive/blurt — למי הם מצביעים-עדים (witness_votes), האם יש נציגות (proxy שמאציל את ההצבעה), ואילו חשבונות ממשלים-בשתיקה (אף-הצבעה, אף-נציגות). הממשל הוא חצי-מהריבונות על שרשרת-גרפן; סריקה זו היא איך הצי יודע אם הוא מתאמץ בה.',
    args: "{}",
    needsVault: false,
    cacheable: true,
    async exec() {
      const rails: Array<"steem" | "hive" | "blurt"> = ["steem", "hive", "blurt"];
      const names = [...FLEET_ACCOUNTS];
      const per = await Promise.all(
        rails.map(async (rail) => {
          try {
            const rows = await railAccounts(rail, names);
            const voters = rows
              .filter((a) => Array.isArray(a.witness_votes) && a.witness_votes.length > 0)
              .map((a) => ({ name: a.name, votes: (a.witness_votes || []).slice(0, 30) }));
            const proxies = rows.filter((a) => typeof a.proxy === "string" && a.proxy.length > 0).map((a) => ({ name: a.name, proxy: a.proxy }));
            return { rail, reachable: true, voters, proxies, silent: rows.filter((a) => !(Array.isArray(a.witness_votes) && a.witness_votes.length) && !a.proxy).map((a) => a.name) };
          } catch (e) {
            return { rail, reachable: false, voters: [], proxies: [], silent: names, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
          }
        }),
      );
      const line = per.map((p) => p.reachable ? `${p.rail}: ${p.voters.length} מצביעים · ${p.proxies.length} נציגויות · ${p.silent.length} שותקים` : `${p.rail}: לא-נגישה`).join(" · ");
      // r35 — חוק-הראש (רביעי במשפחה): summary + meaning ראשונים באובייקט (JSON שומר-סדר-מפתחות),
      // כדי שהחלק-הניתן-לאימות ישרוד את RESULT_CLAMP (1400) — ה-rails המפורטים (עד 12 חשבונות ×
      // 30 הצבעות-עדים לכל-רשת) הם הגוף הכבד שחתך את השורה והוליד פסיקות "חלקי" שווא.
      return {
        measuredAt: new Date().toISOString(),
        summary: line,
        meaning: `טביעת-רגל ממשלתית — ${line}. שותקים רבים = ריבונות-חצויה: יש לנו מפתחות אבל לא משתמשים בכוח-ההצבעה. הצבעה-לעדים היא פעולת-posting (steem.interact אינה מצביעה-עדים — הצע מסלול אם הממצא דורש).`,
        rails: per.map((p) => ({ rail: p.rail, reachable: p.reachable, voters: p.voters.slice(0, 12), proxies: p.proxies, silent: p.silent.slice(0, 12) })),
      };
    },
  },
  {
    id: "vault.rescan",
    name: "סריקת-יבוא — סגירת-תיק-הכספת",
    kind: "actor",
    desc: 'המשימה-שסוגרת-חורים: כל כניסות-הכספת שעדיין "imported" (חומר-ירושה שמעולם לא הוכח-חי) נסרקות מול השרשרת עצמה — אותה מכונת-אימות של הסריקה-המלאה, אותם חוקי-שימור (rotated-out לא יורד, רשת-שותקת נשאר imported בכנות). כספת-נעולה אינה כשל — המודול משיב בכנות "נעולה" והריצה מסתיימת-כן.',
    args: "{}",
    needsVault: false, // handles the locked vault itself — an honest answer, not an error
    cacheable: false,
    async exec() {
      if (!masterReady()) {
        return {
          ok: false,
          locked: true,
          meaning: "הכספת חתומה — סריקת-יבוא נדחית בכנות. זו תשובה כנה (לא כשל): המשימה תרוץ שוב בתור-היומי שלה כשהכספת פתוחה.",
        };
      }
      const r = await verifyImported();
      return {
        ok: true,
        scanned: r.scanned,
        verified: r.verified,
        failed: r.failed,
        stillImported: r.stillImported,
        details: r.entries.slice(0, 30).map((v) => ({ id: v.id, liveOk: v.liveOk, detail: String(v.detail || "").slice(0, 120) })),
        meaning: r.scanned
          ? `סריקת-יבוא: ${r.scanned} נסרקו · ${r.verified} הוכחו-חי · ${r.failed} נכשלו-חי · ${r.stillImported} עדיין imported (רשת-שותקת — כנות). התיק-נסגר צעד-אחד.`
          : `אפס כניסות-imported — תיק-היבוא סגור לגמרי (זו הצלחה-מלאה; אין מה לסרוק).`,
      };
    },
  },
  {
    id: "schedule.propose",
    name: "אדריכל-תעסוקה — הצעת-סיור קבוע",
    kind: "actor",
    desc: `הסוכן מעצב תעסוקה משלו: הצעה לסיור-קבוע חדש (שם, קצב daily-hourUtc או interval-everyMs, מטרה בעברית, doneMeans, תקציב 2-8). ההצעה נכנסת לפאנל יוזמות-היעד כ-hint "schedule-create" — מבני-תעסוקה הם החלטה-ריבונית: מנוע-המדיניות לעולם לא מאמץ סיור-חדש אוטומטית, רק המפעיל (אישור = יצירת-סיור אמיתית, לא ריצה). הצע רק סיורים-שתורמים-לרשת ושאתה באמת תרצה לרוץ בהם.`,
    args: `{"label":"שם-עברי קצר","kind":"daily|interval","hourUtc":0-23 (daily)","everyMs":≥600000 (interval)","goal":"מטרת-הסיור בעברית, 20-600 תווים","doneMeans":["קריטריון-ראיה","..."],"budget":2-8,"maxPerDay":1-12}`,
    needsVault: false,
    cacheable: false,
    async exec(args, ctx) {
      const label = String(args.label || "").trim();
      const kind = args.kind === "interval" ? "interval" : args.kind === "daily" ? "daily" : "";
      const goal = String(args.goal || "").trim();
      const budget = Math.min(Math.max(Number(args.budget) || 3, 2), 8);
      const maxPerDay = Math.min(Math.max(Number(args.maxPerDay) || 4, 1), 12);
      const hourUtc = Number.isFinite(Number(args.hourUtc)) ? Math.min(Math.max(Number(args.hourUtc), 0), 23) : null;
      const everyMs = Number.isFinite(Number(args.everyMs)) ? Math.max(Number(args.everyMs), 600_000) : null;
      const doneMeans = Array.isArray(args.doneMeans) ? args.doneMeans.map((d) => String(d).slice(0, 200)).filter(Boolean).slice(0, 6) : [];
      if (label.length < 3 || label.length > 60) throw new GateError("bad-input", "דרוש label בעברית (3-60 תווים)");
      if (!kind) throw new GateError("bad-input", 'דרוש kind "daily" או "interval"');
      if (kind === "daily" && hourUtc === null) throw new GateError("bad-input", "daily דורש hourUtc (0-23)");
      if (kind === "interval" && !everyMs) throw new GateError("bad-input", "interval דורש everyMs (≥ 600000)");
      if (goal.length < 20 || goal.length > 600) throw new GateError("bad-input", "דרוש goal בעברית (20-600 תווים)");
      if (!doneMeans.length) throw new GateError("bad-input", "דרוש doneMeans — סיור בלי שער-מעבר אינו תעסוקה");
      const dup = await db.gateSchedule.findFirst({ where: { label } });
      if (dup) throw new GateError("dup-schedule", `קיים כבר סיור בשם "${label}" — הצע שם-אחר`);
      const payload = { label, kind, hourUtc: kind === "daily" ? hourUtc : null, everyMs: kind === "interval" ? everyMs : null, budget, maxPerDay, modules: null /* הסט החמוש של המציע ישלוט */ };
      const p = await db.gateProposal.create({
        data: {
          agentName: ctx.agentName,
          kind: "schedule-create",
          goal: `הצעת-סיור קבוע חדש: "${label}" (${kind === "daily" ? `יומי @ ${hourUtc}:00 UTC` : `כל ${Math.round(everyMs! / 60_000)} דקות`}) — ${goal}`,
          rationale: `הסוכן ${ctx.agentName} עיצב תעסוקה חוזרת לעצמו (r15 schedule.propose). אימוץ = החלטת-מפעיל בלבד; מנוע-המדיניות אינו נוגע בסוג זה.`,
          doneMeans: JSON.stringify(doneMeans),
          budget,
          payload: JSON.stringify(payload),
        },
      });
      await db.gateMessage.create({
        data: { channel: "command", fromKind: "system", fromName: "harness", body: `🌸 הסוכן ${ctx.agentName} הציע סיור-קבוע חדש: "${label}" — ממתין להכרעת-המפעיל בפאנל יוזמות-היעד` },
      }).catch(() => {});
      return { proposalId: p.id, kind: "schedule-create", payload, meaning: "הצעת-הסיור הוגשה — רק המפעיל מאמץ תעסוקה-חוזרת (אישור ייצור אותה בפועל)" };
    },
  },
  {
    id: "anchor.integrity",
    name: "שלמות-העוגנים — אמת-חי רבת-מסילה",
    kind: "skill",
    desc: "הסוכן בודק שההאטימה עדיין חיה: קורא את העוגן האחרון בכל מסילה (steem/hive/blurt), מוודא אותו מול השרשרת עצמה (get_transaction → get_block scan), משווה את הדיגסטים בין-המסילות (אחדות), ומחשב את הדיגסט הנוכחי של הכספת (saos/v2) — סטייה = נדרש איטום-חדש. קריאה-בלבד, אפס-מפתחות, כספת-נעולה אינה מפריעה (הדיגסט הנוכחי מושמט בכנות).",
    args: "{}",
    needsVault: false,
    cacheable: true,
    cacheKeyOf: () => "anchor.integrity",
    async exec() {
      const hist = await readAnchorHistory();
      const rails: Array<{ chain: string; txId: string; blockNum: number | null; round: string | null; onChain: boolean; chainDigest: string | null }> = [];
      for (const rec of hist.slice(0, 3)) {
        const v = await verifyAnchorOnChain(rec.chain as never, rec.txId, undefined, rec.blockNum);
        rails.push({ chain: rec.chain, txId: rec.txId, blockNum: v.blockNum ?? rec.blockNum, round: rec.round, onChain: v.onChain, chainDigest: v.digest ? v.digest.slice(0, 16) : null });
      }
      const digests = [...new Set(rails.filter((r) => r.chainDigest).map((r) => r.chainDigest))];
      const unity = rails.filter((r) => r.onChain).length >= 2 && digests.length === 1;
      const current = await vaultDigestV2().catch(() => null);
      const drift = current && digests.length === 1 ? digests[0] !== current.digest.slice(0, 16) : null;
      return {
        ok: true,
        digestNow: current ? current.digest.slice(0, 16) : null, // כספת-נעולה → null בכנות
        vaultRows: current?.rowCount ?? null,
        rails,
        unity, // כל-המסילות החיות נושאות את אותו דיגסט
        drift, // true = מצב-הכספת השתנה מאז העוגן — נדרש anchor.seal
        meaning:
          `שלמות-עוגנים: ${rails.length} מסילות נבדקו — ${rails.filter((r) => r.onChain).length} חיות-על-השרשרת · ` +
          (unity ? "אחדות-דיגסט מלאה בין-המסילות ✓ · " : digests.length > 1 ? "⚠ אי-התאמה בין-דיגסטי-המסילות! · " : "אחדות לא ניתנת לקביעה (מסילה-חיה אחת) · ") +
          (drift === null ? "הדיגסט-הנוכחי לא נמדד (כספת נעולה — כנות)" : drift ? "סטייה מהדיגסט-הנוכחי — נדרש איטום-חדש (anchor.seal)" : "הדיגסט הנוכחי זהה לעוגן — אין סטייה ✓"),
      };
    },
  },
  {
    id: "anchor.seal",
    name: "פעימה ריבונית — איטום מלא על כל המסילות (r33)",
    kind: "actor",
    desc: "הפקודה-האחת (h19 תוכנית סעיף 4): דיגסט saos/v2 אחד נחתם על כל המסילות — steem+hive+blurt (מישור-העוגן r20) + SOLANA (memo נושא-שורש, מפתח-ריבוני M3) + ETHEREUM (הסכום-עצמו מקודד את-השורש, שער-גז נמדד) + TRON (מסילת-סריקה-כנה — החותם-שם במסילת-ה-foundry). שער-כן לכל-מסילה: זהות-כספת נגזרת-מול-שורה, דלק/גז/RC נמדדים לפני-שידור, סירוב = רישום-מספרים ואפס-שידור. תקרת-פעימה יומית (1/יום) — הפעימה-של-היום כבר חיה? המודול משיב בכנות. כספת-נעולה = תשובה-כנה.",
    args: "{}",
    needsVault: false, // handles the locked vault itself — an honest answer, not an error
    cacheable: false,
    async exec(_args, ctx) {
      if (!masterReady()) {
        return {
          ok: false,
          locked: true,
          meaning: "הכספת חתומה — פעימה דורשת פתיחה (fail-closed). זו תשובה כנה, לא כשל: המשמרת תרוץ שוב כשהכספת פתוחה.",
        };
      }
      const dayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      const pulsedToday = await db.gateAction.count({ where: { action: "pulse:cycle", ok: true, createdAt: { gte: dayStart } } });
      if (pulsedToday >= 1) {
        return { ok: true, skipped: true, pulsedToday, meaning: `תקרת-הפעימה היומית מוצו (${pulsedToday}/1) — הפעימה של היום כבר חיה על השרשרות; אין לכפול עוגנים.` };
      }
      const round = `fleet-${new Date().toISOString().slice(0, 10)}`;
      const r = await runPulseCycle(round, ctx.agentName);
      if (r.skipped) return { ok: true, skipped: true, meaning: "הפעימה של היום כבר נרשמה — דילוג-כן" };
      const landed = r.rails.filter((x) => x.ok && x.onChain);
      return {
        ok: landed.length > 0,
        digest: r.digest,
        rails: r.rails.map((x) => ({ rail: x.rail, ok: x.ok, txId: x.txId ? x.txId.slice(0, 16) : null, blockNum: x.blockNum, onChain: x.onChain, error: x.error })),
        meaning: `פעימה ${round}: digest ${r.digest.slice(0, 12)}… · ${landed.length}/${r.rails.length} מסילות עוגן-חי (${r.rails.map((x) => `${x.rail}=${x.ok ? (x.onChain ? "✓" : "שודר") : "שער-כן"}`).join(", ")})`,
      };
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
