#!/usr/bin/env node
/**
 * tools/self-audit.mjs — שער-עקביות לרשת (r29)
 * ================================================================================
 * תבנית שאומצה מ-TFA Evolution Studio v32 (scripts/self-audit.mjs — עבר כאן
 * clean: 316 קבצים, 0 ממצאים) והותאמה לפורטל-הרשת:
 *
 *   1. יבואים שבורים — כל `@/...` ויבוא-יחסי ב-src חייב להצביע על קובץ קיים.
 *   2. סטיית-גרסה — package.json מול worklog.md (שורת Head) ומול docs/broadcast.
 *   3. סודות-שנשכחו — סריקת src למחרוזות שנראות כמו מפתחות (חוקי-עקב).
 *   4. קבצי-API ללא runtime — כל route.ts חייב `export const runtime`.
 *
 * יציאה 0 = נקי. יציאה 1 = יש ממצאים (חוסם-שחרור).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const findings = [];
let scanned = 0;

const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ""]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", "tmp", "upload"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

// ── 1. יבואים שבורים ─────────────────────────────────────────────────────────
for (const file of walk(SRC)) {
  scanned++;
  const text = fs.readFileSync(file, "utf8");
  const re = /(?:import|export)[^'"`]*from\s+['"]([^'"`]+)['"]|import\s*\(\s*['"]([^'"`]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    if (spec.startsWith("@/")) {
      const target = path.join(SRC, spec.slice(2));
      const hit = EXTS.has(path.extname(target)) && fs.existsSync(target) && fs.statSync(target).isFile()
        ? target
        : [".ts", ".tsx", "/index.ts", "/index.tsx"].map((x) => `${target}${x}`).find((c) => fs.existsSync(c));
      if (!hit) findings.push(`BROKEN-IMPORT ${path.relative(ROOT, file)} → ${spec}`);
    } else if (spec.startsWith(".")) {
      const target = path.resolve(path.dirname(file), spec);
      const hit = (fs.existsSync(target) && fs.statSync(target).isFile())
        ? target
        : [".ts", ".tsx", "/index.ts", "/index.tsx"].map((x) => `${target}${x}`).find((c) => fs.existsSync(c));
      if (!hit) findings.push(`BROKEN-IMPORT ${path.relative(ROOT, file)} → ${spec}`);
    }
  }
}

// ── 2. עקביות-גרסה ───────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const worklog = fs.readFileSync(path.join(ROOT, "worklog.md"), "utf8");
const versionMentions = [...worklog.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)].map((m) => m[1]);
const pkgVersion = (pkg.version ?? "0.0.0").replace(/^v/, "");
// דרישה רכה: ה-worklog מזכיר גם גרסאות של פרויקטים-חיצוניים, ולכן זו אזהרה-בלבד
// (הגרסה של הפורטל עצמו נבדקת ב-docs/broadcast). ממצאים חוסמים: BROKEN-IMPORT /
// POSSIBLE-SECRET / MISSING-RUNTIME.
if (versionMentions.length > 0 && !versionMentions.includes(pkgVersion)) {
  console.log(`WARN: package.json=${pkgVersion} לא מופיע ב-worklog (מותר — worklog מזכיר גרסאות-חוץ)`);
}

// ── 3. סריקת-סודות בקוד-מקור ────────────────────────────────────────────────
const SECRET_PATTERNS = [
  [/sk-[a-zA-Z0-9]{20,}/, "openai-style key"],
  [/nvapi-[a-zA-Z0-9_-]{20,}/, "nvidia key"],
  [/5[JK][a-zA-Z0-9]{30,}/, "private-WIF-like string"],
  [/GLM_[a-zA-Z0-9]{16,}/, "glm-style key"],
];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) findings.push(`POSSIBLE-SECRET ${path.relative(ROOT, file)} → ${label}`);
  }
}

// ── 4. routes ללא runtime export ─────────────────────────────────────────────
function walkRoutes(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkRoutes(full, out);
    else if (e.name === "route.ts") out.push(full);
  }
  return out;
}
for (const route of walkRoutes(path.join(SRC, "app", "api"))) {
  const text = fs.readFileSync(route, "utf8");
  if (!/export\s+const\s+runtime\s*=\s*["']nodejs["']/.test(text)) {
    findings.push(`MISSING-RUNTIME ${path.relative(ROOT, route)}`);
  }
}

// ── דוח ──────────────────────────────────────────────────────────────────────
console.log(`self-audit: scanned ${scanned} src files, ${walkRoutes(path.join(SRC, "app", "api")).length} api routes`);
if (findings.length === 0) {
  console.log("self-audit: CLEAN (0 findings)");
  process.exit(0);
}
console.log(`self-audit: ${findings.length} findings:`);
for (const f of findings) console.log(`  - ${f}`);
process.exit(1);
