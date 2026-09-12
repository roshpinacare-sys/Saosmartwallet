import { axiomQuery, axiomStatus, AXIOM_ROOTS } from "@/lib/axiom/runtime";
import { safeLogValue } from "@/lib/hardening";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/**
 * GET /api/code/query?root=src&q=rdeps(file:src/lib/gate/digest.ts)
 * שאילתת-DSL מדויקת על גרף-ה-AST. ללא vector search — תשובה מוכחת.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const root = url.searchParams.get("root") ?? "src";
    const q = url.searchParams.get("q");

    if (url.searchParams.get("status") === "1" || !q) {
      // סטטוס מהיר — גם בלי q
      const stats = Object.keys(AXIOM_ROOTS).map((k) => {
        try {
          return axiomStatus(k);
        } catch {
          return { key: k, seq: null, keyCount: 0, filesIndexed: 0, symbolsIndexed: 0, checkpointSeq: null, lastSync: null };
        }
      });
      return ok({ status: stats });
    }

    const out = axiomQuery(root, q);
    return ok(out);
  } catch (e) {
    return fail(new Error(safeLogValue(e instanceof Error ? e.message : e)));
  }
}
