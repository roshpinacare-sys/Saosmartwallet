import { bankerAllStatuses, bankerOp, bankerStatus } from "@/lib/gate/banker";
import { safeLogValue } from "@/lib/hardening";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/**
 * GET /api/gate/banker[?agent=name]
 * מצב הבנקאי-הזמני: תקציבי אסימונים לסוכנים (ציבורי — ללא סודות).
 * POST: פעולה ניהולית — דורש כותרת x-banker-token שתואמת BANKER_TOKEN
 * (fail-closed: בלי משתנה-סביבה, כל-שינוי נדחה — הלכת admin-auth).
 */
function opAuth(req: Request): boolean {
  const expected = process.env.BANKER_TOKEN;
  if (!expected || expected.trim().length === 0) return false; // fail-closed
  const got = (req.headers.get("x-banker-token") ?? "").trim();
  if (got.length !== expected.trim().length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.trim().charCodeAt(i);
  return diff === 0;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const agent = url.searchParams.get("agent");
    if (agent) return ok({ banker: bankerStatus(agent) });
    return ok({ banker: bankerAllStatuses() });
  } catch (e) {
    return fail(new Error(safeLogValue(e instanceof Error ? e.message : e)));
  }
}

export async function POST(req: Request) {
  try {
    if (!opAuth(req)) {
      return fail(new Error("banker-op requires BANKER_TOKEN (fail-closed)"));
    }
    const body = (await req.json()) as {
      agent?: unknown;
      action?: unknown;
      amount?: unknown;
      maxBudget?: unknown;
      refillPerHour?: unknown;
    };
    const action = body.action === "spend" || body.action === "grant" || body.action === "configure" ? body.action : null;
    if (!action) throw new Error("action must be spend|grant|configure");
    const out = bankerOp(body.agent, action, {
      amount: typeof body.amount === "number" ? body.amount : undefined,
      maxBudget: typeof body.maxBudget === "number" ? body.maxBudget : undefined,
      refillPerHour: typeof body.refillPerHour === "number" ? body.refillPerHour : undefined,
    });
    return ok({ op: out });
  } catch (e) {
    return fail(new Error(safeLogValue(e instanceof Error ? e.message : e)));
  }
}
