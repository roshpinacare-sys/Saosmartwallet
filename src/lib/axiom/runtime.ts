/**
 * runtime.ts — ראנטיים AxiomState לפורטל (r29)
 * ================================================================================
 * מנהל-יחיד (singleton) שמחזיק LSSKernel אחד לכל שורש-מותר.
 *
 * אבטחה (מדריכי SRS):
 *   · שורשים מותרים = רשימה-לבנה קשיחה בלבד (src, prisma, scripts, docs).
 *   · ה-kernel עצמו חי תחת db/axiom/<key> — מחוץ לעץ-המקור.
 *   · כל root עובר containsPath מול שורש-הפרויקט.
 *   · query/bundle עם תקרות-תוצאות ותקרת-בייטים (מניעת DoS).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { LSSKernel } from "./phase0/kernel";
import { IncrementalEngine } from "./phase2/incremental";
import { parseQuery, evaluate } from "./phase2/query";
import type { Query } from "./phase2/query";
import { bundleFiles as bundle } from "./phase2/bundle";
import { containsPath, sanitizeId } from "@/lib/hardening";

const PROJECT_ROOT = path.resolve(process.cwd(), "..") === path.resolve("/") ? process.cwd() : process.cwd();

/** רשימה-לבנה: מפתח → תיקייה-יחסית לשורש-הפרויקט. */
export const AXIOM_ROOTS: Record<string, string> = {
  src: "src",
  prisma: "prisma",
  scripts: "scripts",
  docs: "docs",
} as const;

export type AxiomRootKey = keyof typeof AXIOM_ROOTS;

export const MAX_QUERY_RESULTS = 400;
export const MAX_BUNDLE_BYTES = 512 * 1024;

const kernels = new Map<string, LSSKernel>();
const engines = new Map<string, IncrementalEngine>();
const lastSync = new Map<string, { at: string; scanned: number; changed: number; removed: number }>();

function storeDir(key: string): string {
  return path.join(process.cwd(), "db", "axiom", key);
}

/** אימות מפתח-שורש + החזרת הנתיב המוחלט המותר. */
export function resolveRoot(rawKey: unknown): { key: AxiomRootKey; absPath: string } {
  const key = sanitizeId(rawKey);
  if (!key || !(key in AXIOM_ROOTS)) {
    throw new Error(`unknown axiom root (allowed: ${Object.keys(AXIOM_ROOTS).join(", ")})`);
  }
  const absPath = path.resolve(process.cwd(), AXIOM_ROOTS[key]);
  if (!containsPath(PROJECT_ROOT, absPath)) {
    throw new Error("axiom root escapes project");
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
    throw new Error(`axiom root missing on disk: ${key}`);
  }
  return { key: key as AxiomRootKey, absPath };
}

function getKernel(key: AxiomRootKey): LSSKernel {
  let k = kernels.get(key);
  if (!k) {
    k = new LSSKernel(storeDir(key));
    kernels.set(key, k);
  }
  return k;
}

function getEngine(key: AxiomRootKey): IncrementalEngine {
  let e = engines.get(key);
  if (!e) {
    // הפורטל ממפה `@/x` → `src/x` (tsconfig paths); כשהשורש הוא src עצמו,
    // היעד ביחס לשורש הוא ".". לשאר השורשים הכינויים לא רלוונטיים.
    const aliases = key === "src" ? [{ prefix: "@/", target: "." }] : [];
    e = new IncrementalEngine({ aliases });
    engines.set(key, e);
  }
  return e;
}

export interface SyncOutcome {
  key: AxiomRootKey;
  scanned: number;
  changed: number;
  removed: number;
  unchanged: number;
  seq: string;
  checkpointed: boolean;
  at: string;
}

/** סנכרון אינקרמנטלי + checkpoint + fsync. */
export function axiomSync(rawKey: unknown): SyncOutcome {
  const { key, absPath } = resolveRoot(rawKey);
  const kernel = getKernel(key);
  const report = getEngine(key).sync(kernel, absPath);
  let checkpointed = false;
  if (report.changed.length > 0 || report.removed.length > 0) {
    kernel.checkpoint();
    checkpointed = true;
  }
  kernel.sync();
  const out: SyncOutcome = {
    key,
    scanned: report.scanned,
    changed: report.changed.length,
    removed: report.removed.length,
    unchanged: report.unchanged,
    seq: kernel.stats().seq.toString(),
    checkpointed,
    at: new Date().toISOString(),
  };
  lastSync.set(key, { at: out.at, scanned: out.scanned, changed: out.changed, removed: out.removed });
  return out;
}

export interface QueryOutcome {
  key: AxiomRootKey;
  query: string;
  ids: string[];
  truncated: boolean;
  total: number;
}

/** הרצת שאילתת-DSL מדויקת. */
export function axiomQuery(rawKey: unknown, rawQ: unknown): QueryOutcome {
  const { key } = resolveRoot(rawKey);
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  if (q.length === 0 || q.length > 300) throw new Error("query must be 1..300 chars");
  let parsed: Query;
  try {
    parsed = parseQuery(q);
  } catch (e) {
    throw new Error(`bad query: ${e instanceof Error ? e.message : String(e)}`);
  }
  const kernel = getKernel(key);
  const result = evaluate(kernel, parsed);
  const ids = Array.from(result).sort();
  return {
    key,
    query: q,
    ids: ids.slice(0, MAX_QUERY_RESULTS),
    truncated: ids.length > MAX_QUERY_RESULTS,
    total: ids.length,
  };
}

export interface BundleEntry {
  id: string;
  bytes: number;
  text: string;
}

export interface BundleOutcome {
  key: AxiomRootKey;
  entry: string;
  order: string[];
  cycles: string[][];
  entries: BundleEntry[];
  totalBytes: number;
  truncated: boolean;
}

/** בניית באנדל הקשר דטרמיניסטי (תלויות → תלויים). */
export function axiomBundle(rawKey: unknown, rawEntry: unknown): BundleOutcome {
  const { key } = resolveRoot(rawKey);
  const entry = typeof rawEntry === "string" ? rawEntry.trim() : "";
  if (!entry.startsWith("file:")) throw new Error("entry must be file:<path>");
  const kernel = getKernel(key);
  const res = bundle(kernel, new Set([entry]));
  const out: BundleOutcome = {
    key,
    entry,
    order: res.order,
    cycles: res.cycles,
    entries: [],
    totalBytes: 0,
    truncated: false,
  };
  for (const id of res.order) {
    if (!id.startsWith("file:")) continue;
    const rel = id.slice("file:".length);
    const raw = kernel.get(`source://${rel}`);
    if (!raw) continue;
    const bytes = raw.byteLength;
    if (out.totalBytes + bytes > MAX_BUNDLE_BYTES) {
      out.truncated = true;
      break;
    }
    out.totalBytes += bytes;
    out.entries.push({ id, bytes, text: new TextDecoder().decode(raw) });
  }
  return out;
}

export interface AxiomStatus {
  key: AxiomRootKey;
  seq: string;
  keyCount: number;
  checkpointSeq: string | null;
  filesIndexed: number;
  symbolsIndexed: number;
  lastSync: { at: string; scanned: number; changed: number; removed: number } | null;
}

/** סטטוס ללא-כתיבה (בטוח לקריאה תדירה). */
export function axiomStatus(rawKey: unknown): AxiomStatus {
  const { key } = resolveRoot(rawKey);
  const kernel = getKernel(key);
  let files = 0;
  let symbols = 0;
  for (const k of kernel.keys()) {
    if (k.startsWith("file-index://")) files++;
    else if (k.startsWith("ast://node/symbol:")) symbols++;
  }
  const st = kernel.stats();
  return {
    key,
    seq: st.seq.toString(),
    keyCount: st.keyCount,
    checkpointSeq: st.checkpointSeq ? st.checkpointSeq.toString() : null,
    filesIndexed: files,
    symbolsIndexed: symbols,
    lastSync: lastSync.get(key) ?? null,
  };
}
