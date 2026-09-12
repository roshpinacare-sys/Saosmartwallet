/**
 * banker.ts — הבנקאי-הזמני TIB לסוכני-הרשת (r29)
 * ================================================================================
 * העברה של TemporalBankerScheduler (SRS, מוכח ב-TLA+ — 220,584 מצבים, 0 הפרות)
 * + TIBBudget (kernel/omnivisor.py) למודל-ההרשאות-הפיננסי של הרשת:
 *
 *   · לכל סוכן חשבון-אסימונים: budget / maxBudget / refillPerHour.
 *   · פקודה בעלות cost מתקבלת רק אם budget ≥ cost (BudgetInvariant — אף-פעם
 *     לא חורגים מהיתרה), ועלות מעל התקרה נדחית מראש (NoDeadlock).
 *   · המצב נשמר ב-SignedFileStore: כתיבה אטומית + HMAC-SHA256 + מונה-רצף
 *     מונוטוני עם מראה מחוץ-לתיקייה — התקפת-רולבק נדחית.
 *
 * מפתח-החתימה: db/banker/.secret (32 בייטים, נוצר-פעם-אחת, הרשאות 0600)
 * — תבנית SRS secret_key. זה אינו מפתח-כספת ואינו נוגע בסודות-משתמש.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { SignedFileStore, TIBBudget, sanitizeId } from "@/lib/hardening";
import type { TIBBudgetSnapshot } from "@/lib/hardening";

const BANKER_DIR = path.join(process.cwd(), "db", "banker");
const MIRROR_DIR = path.join(process.cwd(), "db", ".banker-mirror"); // מחוץ-ל-BANKER_DIR

export interface AgentBudget {
  /** התקרה ליום-פעילות (באסימונים; 1 אסימון ≈ פעולה-כבדה אחת) */
  maxBudget: number;
  /** קצב-הטענה לשעה */
  refillPerHour: number;
  /** העלות-הממוצעת שהוגדרה לפעולת-יסוד */
  unitCost: number;
}

export interface BankerRecord {
  agent: string;
  budget: TIBBudgetSnapshot;
  defaults: AgentBudget;
}

const DEFAULTS: AgentBudget = {
  maxBudget: 10,
  refillPerHour: 1,
  unitCost: 1,
};

let secretCache: Buffer | null = null;

function getSecret(): Buffer {
  if (secretCache) return secretCache;
  fs.mkdirSync(BANKER_DIR, { recursive: true });
  fs.mkdirSync(MIRROR_DIR, { recursive: true });
  const p = path.join(BANKER_DIR, ".secret");
  try {
    const buf = fs.readFileSync(p);
    if (buf.length === 32) {
      secretCache = buf;
      return buf;
    }
  } catch { /* חדש */ }
  const fresh = randomBytes(32);
  fs.writeFileSync(p, fresh, { mode: 0o600 });
  secretCache = fresh;
  return fresh;
}

function storeFor(agent: string): SignedFileStore<AgentBudget & { __budget: TIBBudgetSnapshot }> {
  return new SignedFileStore({
    secret: getSecret(),
    filePath: path.join(BANKER_DIR, `${agent}.json`),
    mirrorPath: path.join(MIRROR_DIR, `${agent}.seq`),
  });
}

function liveBudget(_agent: string, loaded: (AgentBudget & { __budget: TIBBudgetSnapshot }) | null) {
  if (!loaded) return new TIBBudget({ maxBudget: DEFAULTS.maxBudget, refillPerHour: DEFAULTS.refillPerHour });
  return new TIBBudget({
    budget: loaded.__budget.budget,
    maxBudget: loaded.maxBudget,
    refillPerHour: loaded.refillPerHour,
    lastRefillAt: loaded.__budget.lastRefillAt,
  });
}

/** קריאת מצב-סוכן (מאומת). זורק על פגיעת-HMAC/רולבק — כנה. */
export function bankerStatus(rawAgent: unknown): BankerRecord {
  const agent = sanitizeId(rawAgent);
  if (!agent) throw new Error("bad agent id");
  const store = storeFor(agent);
  const loaded = store.load()?.state ?? null;
  const eff = liveBudget(agent, loaded);
  return {
    agent,
    budget: eff.snapshot(),
    defaults: {
      maxBudget: loaded?.maxBudget ?? DEFAULTS.maxBudget,
      refillPerHour: loaded?.refillPerHour ?? DEFAULTS.refillPerHour,
      unitCost: loaded?.unitCost ?? DEFAULTS.unitCost,
    },
  };
}

/** מצב כל-הסוכנים שיש להם קובץ. */
export function bankerAllStatuses(): BankerRecord[] {
  try {
    return fs
      .readdirSync(BANKER_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return bankerStatus(f.slice(0, -5));
        } catch (e) {
          return {
            agent: `${f.slice(0, -5)} (TAMPERED: ${e instanceof Error ? e.message : "?"})`,
            budget: { budget: 0, maxBudget: 0, refillPerHour: 0, lastRefillAt: "" },
            defaults: DEFAULTS,
          };
        }
      });
  } catch {
    return [];
  }
}

export type BankerAction = "grant" | "spend" | "configure";

export interface BankerOpResult {
  agent: string;
  action: BankerAction;
  amount?: number;
  granted: boolean;
  reason?: string;
  budget: TIBBudgetSnapshot;
}

/** פעולה על חשבון-סוכן. spend עם BudgetInvariant; grant מוגבל-תקרה. */
export function bankerOp(
  rawAgent: unknown,
  action: BankerAction,
  opts: { amount?: number; maxBudget?: number; refillPerHour?: number } = {},
): BankerOpResult {
  const agent = sanitizeId(rawAgent);
  if (!agent) throw new Error("bad agent id");
  const store = storeFor(agent);
  const loaded = store.load()?.state ?? null;
  const eff = liveBudget(agent, loaded);
  const current = eff.snapshot();

  const nextDefaults: AgentBudget = {
    maxBudget: typeof opts.maxBudget === "number" && opts.maxBudget > 0 ? opts.maxBudget : loaded?.maxBudget ?? DEFAULTS.maxBudget,
    refillPerHour:
      typeof opts.refillPerHour === "number" && opts.refillPerHour >= 0 ? opts.refillPerHour : loaded?.refillPerHour ?? DEFAULTS.refillPerHour,
    unitCost: loaded?.unitCost ?? DEFAULTS.unitCost,
  };

  let granted = true;
  let reason: string | undefined;

  if (action === "spend") {
    const cost = typeof opts.amount === "number" && opts.amount > 0 ? opts.amount : nextDefaults.unitCost;
    if (cost > nextDefaults.maxBudget) {
      granted = false;
      reason = `cost ${cost} exceeds maxBudget ${nextDefaults.maxBudget} (NoDeadlock)`;
    } else if (!eff.spend(cost)) {
      granted = false;
      reason = `insufficient budget (BudgetInvariant) — have ${current.budget.toFixed(3)}, need ${cost}`;
    }
  } else if (action === "grant") {
    const amount = typeof opts.amount === "number" && opts.amount > 0 ? opts.amount : nextDefaults.refillPerHour;
    eff.grant(amount);
  }

  const snapshot = eff.snapshot();
  // שמירה חתומה רק אם הייתה שינוי-מצב או קונפיגורציה חדשה
  if (granted || action === "configure" || !loaded) {
    store.save({ ...nextDefaults, __budget: snapshot });
  }

  return { agent, action, amount: opts.amount, granted, reason, budget: snapshot };
}
