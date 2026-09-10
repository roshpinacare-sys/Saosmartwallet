// Secret scrubbing for free-text write paths — FIX(Roast-65-b · M11).
// 65-b MED-11: ChatMessage.content / TaskItem.result / AuditLog.detail הם
// שדות-טקסט-חופשי = בור-סודות בגלוי; כל-סוד שהודבק-שם נשמר בהיסטוריה-תמידית
// (וההיסטוריה של custom.db הייתה בגיט). שכבת-הגנה הזו נקראת לפני כל-כתיבה:
// דפוסי-סוד מוכרים מוחלפים ב-[REDACTED:<kind>] לפני-ה-persist.
//
// כנות: זהו ריסוק-דפוסים, לא-הצפנה — סוד בפורמט-לא-מוכר יעבור. יתרון-הצנזורה
// על תת-הצנזורה: גם digest של hex-64 לגיטימי יירסק (אין-אפשרות להבחין ממפתח-EVM
// חשוף בלי-קונטקסט) — החלטה-מודעת.
//
// ביצועים: prefilter-regex זול אחד — אין-מועמדים → הטקסט חוזר כמות-שהוא לפני
// שום-עבודה-כבדה (נתיב-החום של כל-הודעת-צ'אט/אודיט עובר כאן).
//
// אף-ערך-סוד לא נכתב ליומן — רק סוגים ומספרים.

// WIF לא-דחוס: 5[HJK] + 49–50 base58 = 51–52 תווים
const WIF_RE = /\b5[HJK][1-9A-HJ-NP-Za-km-z]{49,50}\b/g;
// base58 בעל-אנטרופיה-גבוהה 51–52 (תופס WIF-דחוס K/L ובני-משפחה) — מדויק-רק
// עם שער-אנטרופיה (אותיות-קטנות+גדולות+ספרות) כדי-לא-לרסק מזהים-אקראיים
const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{51,52}\b/g;
// hex-64 — מפתח-EVM פרטי / seed גולמי (digest-ים יירסקו גם-כן — ראה-כנות למעלה).
// lookaround במקום \b: צריך-לתפוס גם אחרי-קידומת 0x (שם \b נכשל — x הוא תו-מילה),
// ובאותה-נשימה לא-לתפוס בתוך מחרוזת-hex ארוכה יותר.
const HEX64_RE = /(?<![a-fA-F0-9])[a-fA-F0-9]{64}(?![a-fA-F0-9])/g;
// מפתח-מורחב-פרטי BIP32 (xprv/yprv/zprv) — base58 ארוך
const XPRV_RE = /\b[xyz]prv[1-9A-HJ-NP-Za-km-z]{50,107}\b/g;
// רצף-מילים-דמוי-מנטרה: 12–24 מילים-אנגליות-קטנות באורך 3–8 (BIP39-לייק)
const MNEMONIC_RE = /\b[a-z]{3,8}(?:\s[a-z]{3,8}){11,23}\b/g;
// GitHub PAT (ghp_/gho_/ghu_/ghs_/ghr_)
const GH_PAT_RE = /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g;

// שער-האנטרופיה ל-base58 הגנרי: מחייב שילוב-מחלקות-תווים (WIF אמיתי עומד בו)
function looksHighEntropyBase58(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);
}

// prefilter זול: התאמה-מועמדת-אחת-לפחות בשביל-להתחיל-לעבוד
const PREFILTER = new RegExp(
  [
    WIF_RE.source,
    BASE58_RE.source,
    HEX64_RE.source,
    XPRV_RE.source,
    GH_PAT_RE.source,
    MNEMONIC_RE.source,
  ].join('|'),
  '',
);

export type ScrubKind = 'wif' | 'base58-secret' | 'hex64' | 'xprv' | 'mnemonic' | 'github-pat';

export interface ScrubReport {
  text: string;
  redactions: Partial<Record<ScrubKind, number>>;
  total: number;
}

function pass(text: string, re: RegExp, kind: ScrubKind, counts: Partial<Record<ScrubKind, number>>, gate?: (m: string) => boolean): string {
  return text.replace(re, (m) => {
    if (gate && !gate(m)) return m;
    counts[kind] = (counts[kind] || 0) + 1;
    return `[REDACTED:${kind}]`;
  });
}

/** סריקה+דיווח מלא (משמש בפנים; נחשף למי שרוצה-מטריקה). */
export function scrubReport(text: string): ScrubReport {
  const counts: Partial<Record<ScrubKind, number>> = {};
  if (!text || !PREFILTER.test(text)) return { text, redactions: counts, total: 0 };
  let out = text;
  out = pass(out, WIF_RE, 'wif', counts);
  out = pass(out, BASE58_RE, 'base58-secret', counts, looksHighEntropyBase58);
  out = pass(out, HEX64_RE, 'hex64', counts);
  out = pass(out, XPRV_RE, 'xprv', counts);
  out = pass(out, MNEMONIC_RE, 'mnemonic', counts);
  out = pass(out, GH_PAT_RE, 'github-pat', counts);
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  return { text: out, redactions: counts, total };
}

/**
 * מנקה סודות מטקסט-חופשי לפני-כתיבה. מחזיר את הטקסט המנוקה.
 * מתריע ביומן (בלי-ערכים!) כשנרסק משהו.
 */
export function scrub(text: string): string {
  const r = scrubReport(text);
  if (r.total > 0) {
    const kinds = Object.entries(r.redactions).map(([k, n]) => `${k}×${n}`).join(', ');
    console.warn(`[secret-scrub] redacted ${r.total} candidate secret(s) (${kinds}) from free-text before persist (len=${text.length})`);
  }
  return r.text;
}
