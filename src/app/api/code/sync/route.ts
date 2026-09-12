import { axiomSync } from "@/lib/axiom/runtime";
import { safeLogValue } from "@/lib/hardening";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/**
 * POST /api/code/sync  { root: "src" | "prisma" | "scripts" | "docs" }
 * סנכרון אינקרמנטלי (SHA-256) + checkpoint. גוף מוגבל, רשימה-לבנה.
 */
export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > 2_000) throw new Error("body too large");
    let root: unknown = "src";
    if (text.length > 0) {
      const body = JSON.parse(text) as { root?: unknown };
      root = body.root ?? "src";
    }
    const out = axiomSync(root);
    return ok({ sync: out });
  } catch (e) {
    return fail(new Error(safeLogValue(e instanceof Error ? e.message : e)));
  }
}
