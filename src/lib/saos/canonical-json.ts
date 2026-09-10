/**
 * Canonical JSON — deterministic serialization (עיקרון: סדר שדות קבוע, בלי float).
 * Ported from: unified-platform `src/contracts/crypto.ts` + steem-main kernel discipline.
 * Rejects cycles, symbols, sparse arrays and accessors — fail-closed.
 *
 * FIX(Roast-64-a · F3):
 *   a. bigint נדחה עם CanonicalJsonError — המרה שקטה ל-Number איבדה דיוק
 *      (2^90n → "1.2379e+27" בסימון מדעי!) ופירקה את הדטרמיניזם.
 *   b. סמנטיקת מחסנית-נתיב: seen נשלף אחרי כל-walk חוזר — מבנה-משותף
 *      (אותו אובייקט פעמיים, בלי מעגל) תקין; רק מעגל אמת נדחה.
 *   c. Date לא שווה עוד ל-string-תאריך: מסודר כ-tag {"$date": toISOString()};
 *      תאריך לא-תקין (invalid Date) נדחה במפורש במקום RangeError שנמלט.
 */

export class CanonicalJsonError extends Error {}

function fail(msg: string): never {
  throw new CanonicalJsonError(msg);
}

export function canonicalize(value: unknown): string {
  // FIX(Roast-64-a · F3b): WeakSet-עם-שחרור = סמנטיקת מחסנית-נתיב —
  // אב-קדמון חי רק כל-עוד אנחנו בתוך ה-walk שלו.
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "number") {
      const n = v as number;
      if (!Number.isFinite(n)) fail("float/inf rejected — integers only");
      if (!Number.isSafeInteger(n)) fail("unsafe integer rejected");
      return n;
    }
    if (t === "bigint") fail("bigint rejected — convert to safe integer or string at the boundary"); // FIX F3a: היה Number(v) — איבוד-דיוק + סימון-מדעי
    if (t === "boolean") return v;
    if (t === "string") return v;
    if (t === "symbol" || t === "function") fail("symbol/function rejected");
    if (t === "object") {
      const o = v as object;
      if (o instanceof Date) {
        // FIX F3c: תגי $date — Date ו-string-תאריך אינם עוד digest-זהה; תאריך-פגום נדחה
        const ms = o.getTime();
        if (!Number.isFinite(ms)) fail("invalid Date rejected");
        return { $date: o.toISOString() };
      }
      if (seen.has(o)) fail("circular reference rejected");
      seen.add(o);
      try {
        if (Array.isArray(o)) {
          return o.map((x) => {
            if (x === undefined) return null; // sparse array collapsed
            return walk(x);
          });
        }
        const entries = Object.entries(o as Record<string, unknown>)
          .filter(([, val]) => val !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const out: Record<string, unknown> = {};
        for (const [k, val] of entries) out[k] = walk(val);
        return out;
      } finally {
        seen.delete(o); // FIX F3b: נשלף אחרי-החזרה — מבנה-משותף (יהלום) חוקי, מעגל אמת נדחה
      }
    }
    fail(`unsupported type ${t}`);
  };
  return JSON.stringify(walk(value));
}

/** sha256 over canonical JSON — the universal digest of the platform */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function canonicalDigest(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}
