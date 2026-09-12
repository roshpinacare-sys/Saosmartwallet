import { axiomBundle } from "@/lib/axiom/runtime";
import { safeLogValue } from "@/lib/hardening";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/**
 * GET /api/code/bundle?root=src&entry=file:src/app/page.tsx
 * באנדל הקשר דטרמיניסטי: קבצי-תלות בסדר טופולוגי — זרע-הקשר משחזר לסוכנים.
 * מחזיר metadata + תצוגה-מקדימה (לא את כל הטקסט, כדי לא להציף).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const root = url.searchParams.get("root") ?? "src";
    const entry = url.searchParams.get("entry");
    if (!entry) throw new Error("missing entry (file:<path>)");

    const out = axiomBundle(root, entry);
    return ok({
      bundle: {
        key: out.key,
        entry: out.entry,
        order: out.order,
        cycles: out.cycles,
        totalBytes: out.totalBytes,
        truncated: out.truncated,
        files: out.entries.map((e) => ({ id: e.id, bytes: e.bytes, head: e.text.slice(0, 240) })),
      },
    });
  } catch (e) {
    return fail(new Error(safeLogValue(e instanceof Error ? e.message : e)));
  }
}
