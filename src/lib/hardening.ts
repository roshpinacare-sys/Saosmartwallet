/**
 * hardening.ts — ערכת-קשיחות r29 (העברה מ-SRS Sovereign Runtime Substrate v8.2.0)
 * ================================================================================
 * תבניות שהוכיחו את עצמן ב-SRS (256 בדיקות ליבה מקומיות, Apache-2.0) והותאמו
 * ל-Node/TS של הפורטל. כל פרימיטיב כאן עומד בפני עצמו, ללא תלות חוץ:
 *
 *   · sanitizeId / sanitizeFileName  — מ-SRS _sanitize_id + _sanitize_task_id
 *     (הכלה של נתיבים, null-bytes, תווי-בקרה, שמות-שמורים של Windows).
 *   · safeLogValue                    — מ-SRS _safe_log_value (מניעת הזרקת-לוג).
 *   · safeParseJsonText               — מ-SRS SafeJSONDecoder (שער-גודל + סריקת
 *     עומק לפני JSON.parse — סגירת PoC ה-50,000-סוגריים).
 *   · atomicWriteJson / atomicWriteBuf — מ-SRS _atomic_write_json
 *     (tmp → fsync → rename → dir-fsync; כתיבה חצי-גמורה בלתי-אפשרית).
 *   · canonicalJson + hmacSign/Verify — מ-SRS _compute_snapshot_hash
 *     (HMAC-SHA256 על JSON ממוין-מפתחות; אימות timing-safe).
 *   · SignedFileStore                 — קובץ-מצב עם מונה-רצף מונוטוני + מראה
 *     מחוץ-לתיקייה (מ-SRS high-water mirror) — דחיית-רולבק אטומית.
 *   · containsPath                    — הכלה-נתיבים (מ-SRS SRS_HOME validation).
 *   · TIBBudget                       — הבנקאי-הזמני מ-TemporalBankerScheduler.tla
 *     (budget/max/refill; BudgetInvariant: לעולם אין חריגה-מיתרה).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ── סניטייזציה ────────────────────────────────────────────────────────────────

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const WINDOWS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/** מזהה נוקה: רק אות/ספרה/קו תחתון/מקף, עד 64 תווים. null אם בלתי-אפשר לנקות. */
export function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return ID_RE.test(s) ? s : null;
}

/**
 * שם-קובץ בטוח (תבנית SRS _sanitize_task_id): sanitize-ולא-דחייה.
 * null-bytes ותווי-בקרה נמחקים, נתיבים מנוטרלים (../ → _), שמות-שמורים
 * של Windows מקבלים קידומת f_, אורך מוגבל ל-96.
 */
export function sanitizeFileName(raw: unknown): string {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/[\u0000-\u001f\u007f]/g, "");            // null + control chars
  s = s.replace(/\.\.[\\/]+/g, "_");                      // traversal בסיסי
  s = s.replace(/[^a-zA-Z0-9._-]/g, "_");                 // whitelist תווים
  s = s.replace(/^[.\\/]+/, "");                          // נקודות/סלשים פותחים
  const stem = s.split(".")[0].toUpperCase();
  if (WINDOWS_RESERVED.has(stem)) s = `f_${s}`;
  return s.slice(0, 96) || "unnamed";
}

/** ערך בטוח ללוג: ASCII נדפס בלבד, חיתוך ל-200 — מניעת הזרקת-לוג (SRS). */
export function safeLogValue(raw: unknown): string {
  const s = typeof raw === "string" ? raw : String(raw ?? "");
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    out += c >= 0x20 && c <= 0x7e ? ch : "?";
  }
  return out.slice(0, 200);
}

// ── JSON בטוח ─────────────────────────────────────────────────────────────────

export interface SafeJsonOptions {
  /** גודל-מרבי בבייטים (ברירת-מחדל 1MB) */
  maxSize?: number;
  /** עומק-מרבי (ברירת-מחדל 100 — SRS) */
  maxDepth?: number;
}

/** סריקת עומק חסכונית לפני parse — סוגריים/מרכאות/בריחות בלבד. */
function scanJsonDepth(text: string): number {
  let depth = 0, max = 0, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { if (inStr) esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") { depth++; if (depth > max) max = depth; }
    else if (ch === "}" || ch === "]") depth--;
  }
  return max;
}

/** JSON.parse מוגן: דחיית-גודל + דחיית-עומק לפני רקורסיית הפרסר. */
export function safeParseJsonText(text: string, opts: SafeJsonOptions = {}): unknown {
  const maxSize = opts.maxSize ?? 1_000_000;
  const maxDepth = opts.maxDepth ?? 100;
  if (text.length > maxSize) throw new Error(`json too large: ${text.length}B`);
  const depth = scanJsonDepth(text);
  if (depth > maxDepth) throw new Error(`json depth ${depth} exceeds ${maxDepth}`);
  return JSON.parse(text);
}

// ── כתיבה אטומית ─────────────────────────────────────────────────────────────

/** כתיבת-באפר אטומית (SRS _atomic_write_json): tmp → fsync → rename → dir-fsync. */
export function atomicWriteBuf(target: string, data: Buffer): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomBytes(4).toString("hex")}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  try {
    const dfd = fs.openSync(dir, "r");
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* dir-fsync לא נתמך בכל פלטפורמה — ה-rename כבר אטומי */ }
}

/** כתיבת JSON אטומית. */
export function atomicWriteJson(target: string, value: unknown): void {
  atomicWriteBuf(target, Buffer.from(JSON.stringify(value, null, 2), "utf8"));
}

// ── HMAC על JSON קנוני ───────────────────────────────────────────────────────

/** JSON קנוני: מפתחות ממוינים רקורסיבית (תבנית SRS sort_keys=True). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

export function hmacSignCanonical(secret: Buffer | string, value: unknown): string {
  return createHmac("sha256", secret).update(canonicalJson(value), "utf8").digest("hex");
}

/** אימות timing-safe של HMAC על ערך. */
export function hmacVerifyCanonical(secret: Buffer | string, value: unknown, mac: string): boolean {
  const expected = hmacSignCanonical(secret, value);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(mac, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── הכלת-נתיבים ──────────────────────────────────────────────────────────────

/** האם candidate נמצא בתוך base (לאחר resolve)? מניעת path-traversal. */
export function containsPath(baseAbs: string, candidateAbs: string): boolean {
  const rel = path.relative(path.resolve(baseAbs), path.resolve(candidateAbs));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ── SignedFileStore: מצב חתום + מונה-רצף + מראה ─────────────────────────────

export interface SignedState<T> {
  /** מצב-היישום עצמו */
  state: T;
  /** מונה מונוטוני — עולה בכל שמירה */
  seq: number;
  updatedAt: string;
}

export interface SignedFileStoreOptions {
  /** מפתח-חתימה (32 בייטים) */
  secret: Buffer;
  /** נתיב קובץ-המצב */
  filePath: string;
  /** נתיב מראה-הרצף — *מחוץ* לתיקיית-המצב כדי שמחיקת-מקומית לא תאפס (SRS R17.5) */
  mirrorPath: string;
}

/**
 * חנות-מצב עמידה-לדיסק-עוין (תבנית SRS persistence.py):
 *   · כל שמירה: seq+1, כתיבה אטומית, HMAC על כל-השדות.
 *   · המראה (mirrorPath) מחזיקה את ה-high-water — max(שני-המקורות).
 *   · טעינה: HMAC נבדק תחילה; seq < high-water → דחייה (התקפת-רולבק).
 */
export class SignedFileStore<T> {
  private readonly opts: SignedFileStoreOptions;

  constructor(opts: SignedFileStoreOptions) {
    this.opts = opts;
  }

  private ensureSecret(): Buffer {
    if (this.opts.secret.length === 32) return this.opts.secret;
    throw new Error("hardening: secret must be 32 bytes");
  }

  private highWater(): number {
    // מקור 1: המראה. מקור 2: שדה ה-seq בקובץ עצמו. מקסימום = fail-safe.
    let mirror = 0;
    try {
      mirror = parseInt(fs.readFileSync(this.opts.mirrorPath, "utf8").trim(), 10) || 0;
    } catch { /* חדש */ }
    let inline = 0;
    try {
      const raw = fs.readFileSync(this.opts.filePath, "utf8");
      const obj = JSON.parse(raw) as { seq?: number };
      inline = typeof obj.seq === "number" ? obj.seq : 0;
    } catch { /* חדש */ }
    return Math.max(mirror, inline);
  }

  /** טעינה מאומתת; זורק על פגיעת-HMAC או רולבק. מחזיר null אם אין קובץ. */
  load(): SignedState<T> | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.opts.filePath, "utf8");
    } catch {
      return null;
    }
    let envelope: { payload: SignedState<T>; mac: string };
    try {
      envelope = JSON.parse(raw) as { payload: SignedState<T>; mac: string };
    } catch {
      throw new Error(`hardening: corrupt state file ${safeLogValue(this.opts.filePath)}`);
    }
    const ok = hmacVerifyCanonical(this.ensureSecret(), envelope.payload, envelope.mac);
    if (!ok) throw new Error("hardening: HMAC mismatch — state file tampered");
    const hw = this.highWater();
    if (envelope.payload.seq < hw) {
      throw new Error(
        `hardening: rollback rejected — seq ${envelope.payload.seq} < high-water ${hw}`,
      );
    }
    return envelope.payload;
  }

  /** שמירה אטומית חתומה עם מונה-רצף מונוטוני. */
  save(state: T): SignedState<T> {
    const next = (this.highWater() || 0) + 1;
    const payload: SignedState<T> = { state, seq: next, updatedAt: new Date().toISOString() };
    const mac = hmacSignCanonical(this.ensureSecret(), payload);
    atomicWriteJson(this.opts.filePath, { payload, mac });
    atomicWriteBuf(this.opts.mirrorPath, Buffer.from(String(next), "utf8"));
    return payload;
  }
}

// ── TIBBudget: הבנקאי-הזמני (TemporalBankerScheduler.tla) ────────────────────

export interface TIBBudgetSnapshot {
  budget: number;
  maxBudget: number;
  /** אסימונים לשעה (refill_rate) */
  refillPerHour: number;
  lastRefillAt: string;
}

/**
 * תקציב אסימונים עם טעינה-מחדש לפי-זמן.
 * אינווריאנטים (מ-TLA+, נאכפים כאן בקוד):
 *   · BudgetInvariant — budget לעולם ≥ 0; spend מעל-היתרה נדחה (לא נחתך).
 *   · NoDeadlock      — עלות > maxBudget נדחית *לפני*-כניסה (grant-עול-שמימה).
 */
export class TIBBudget {
  private budget: number;
  private readonly maxBudget: number;
  private readonly refillPerHour: number;
  private lastRefillMs: number;

  constructor(init: TIBBudgetSnapshot | { maxBudget: number; refillPerHour: number; startAt?: number }) {
    if ("budget" in init) {
      this.budget = Math.max(0, init.budget);
      this.maxBudget = init.maxBudget;
      this.refillPerHour = init.refillPerHour;
      this.lastRefillMs = Date.parse(init.lastRefillAt);
      if (!Number.isFinite(this.lastRefillMs)) this.lastRefillMs = Date.now();
    } else {
      this.budget = init.maxBudget;
      this.maxBudget = init.maxBudget;
      this.refillPerHour = init.refillPerHour;
      this.lastRefillMs = init.startAt ?? Date.now();
    }
  }

  private refill(nowMs: number): void {
    const elapsedH = Math.max(0, (nowMs - this.lastRefillMs) / 3_600_000);
    if (elapsedH > 0) {
      this.budget = Math.min(this.maxBudget, this.budget + elapsedH * this.refillPerHour);
      this.lastRefillMs = nowMs;
    }
  }

  /** האם פעולה בעלות cost מתאפשרת (בלי לחייב)? עלות-על-התקרה נדחית תמיד. */
  canAfford(cost: number, nowMs: number = Date.now()): boolean {
    if (cost > this.maxBudget) return false; // NoDeadlock — דחייה-מראש
    this.refill(nowMs);
    return this.budget >= cost;             // BudgetInvariant
  }

  /** ניכוי בפועל; מחזיר false בלי שינוי אם אין כיסוי. */
  spend(cost: number, nowMs: number = Date.now()): boolean {
    if (!this.canAfford(cost, nowMs)) return false;
    this.budget -= cost;
    return true;
  }

  /** מענק ידני (מנהל) — מוגבל לתקרה. */
  grant(amount: number, nowMs: number = Date.now()): void {
    this.refill(nowMs);
    this.budget = Math.min(this.maxBudget, this.budget + Math.max(0, amount));
  }

  snapshot(nowMs: number = Date.now()): TIBBudgetSnapshot {
    this.refill(nowMs);
    return {
      budget: Math.round(this.budget * 1e6) / 1e6,
      maxBudget: this.maxBudget,
      refillPerHour: this.refillPerHour,
      lastRefillAt: new Date(this.lastRefillMs).toISOString(),
    };
  }
}
