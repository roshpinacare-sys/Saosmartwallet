/**
 * Hash-chained evidence receipts (קבלות ראיות משורשרות-האש).
 * Ported from: qodo `services/receipt.ts` (hash-chained receipts),
 * V33.30 signed evidence pattern, unified-platform truth boundary
 * (`productionAuthority: NONE` until anchored — honesty in code).
 *
 * FIX(Roast-64-a · F4): שדה-האמת (`truth`) היה מחוץ ל-preimage של ה-digest —
 * טמפר בשדה-גבול-האמת עבר את verifyChain בשקט. עכשיו ה-truth כלול ב-preimage:
 * כל שינוי בגבול-האמת משנה את ה-digest ושובר את השרשרת (fail-closed).
 */

import { canonicalDigest } from "./canonical-json";

export interface TruthBoundary {
  externalEffectsExecuted: number;
  productionAuthority: "NONE" | "SEALED_PUBLIC";
}

/** גבול-האמת-היחיד שהפלטפורמה אי-פעם טוענת ב-forging — NONE עד עגינה מאומתת */
export const DEFAULT_TRUTH: TruthBoundary = {
  externalEffectsExecuted: 0,
  productionAuthority: "NONE"
};

export interface Receipt {
  kind: string;
  at: string;
  payload: Record<string, unknown>;
  prevDigest: string | null;
}

export interface ChainedReceipt extends Receipt {
  digest: string;
  /** truth boundary — explicit, enforced, not implied — and INSIDE the digest preimage */
  truth: TruthBoundary;
}

/** preimage אחד לכל-השרשרת — forge ו-verify מחשבים ממנו (מקור-אמת-יחיד) */
export function receiptPreimage(r: {
  kind: string;
  at: string;
  payload: Record<string, unknown>;
  prevDigest: string | null;
  truth?: TruthBoundary;
}): Record<string, unknown> {
  return {
    kind: r.kind,
    at: r.at,
    payload: r.payload,
    prevDigest: r.prevDigest,
    // truth חסר (שורת-DB למשל) = ברירת-המחדל הכנה NONE/0 — קבלה שנוצרה עם
    // truth אחר לא תאומת מעולם (fail-closed)
    truth: r.truth ?? DEFAULT_TRUTH
  };
}

export async function forgeReceipt(
  kind: string,
  payload: Record<string, unknown>,
  prevDigest: string | null
): Promise<ChainedReceipt> {
  const base: Receipt = { kind, at: new Date().toISOString(), payload, prevDigest };
  const digest = await canonicalDigest(receiptPreimage({ ...base, truth: DEFAULT_TRUTH }));
  return {
    ...base,
    digest,
    truth: { ...DEFAULT_TRUTH }
  };
}

export async function verifyChain(
  receipts: { kind: string; at: string; payload: Record<string, unknown>; prevDigest: string | null; digest: string; truth?: TruthBoundary }[]
): Promise<{ ok: boolean; brokenAt: number | null }> {
  let prev: string | null = null;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]!;
    const recomputed = await canonicalDigest(receiptPreimage(r));
    if (recomputed !== r.digest) return { ok: false, brokenAt: i };
    if (r.prevDigest !== prev) return { ok: false, brokenAt: i };
    prev = r.digest;
  }
  return { ok: true, brokenAt: null };
}
