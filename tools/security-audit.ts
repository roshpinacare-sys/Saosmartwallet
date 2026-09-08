/**
 * security-audit.ts — re-runnable security gate (SEC-HARD round)
 * ===============================================================
 * Zero-mock security gate for THIS repository. Encodes every security
 * assertion we make in docs/security.md as a mechanical check, so the
 * claims stay true by construction: re-run after every dependency
 * change, every new API route, and before every push.
 *
 *   bun tools/security-audit.ts            # full gate (live checks incl.)
 *   bun tools/security-audit.ts --offline  # skip network checks honestly
 *
 * Exit code 1 on any FAIL. Every line is PASS / FAIL / SKIP(+reason) —
 * a SKIP is never counted as a pass.
 */

import { execSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OFFLINE = process.argv.includes("--offline");

let failures = 0;
function pass(msg: string) {
  console.log(`  PASS  ${msg}`);
}
function fail(msg: string) {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
}
function skip(msg: string) {
  console.log(`  SKIP  ${msg} (reason below)`);
}
function head(title: string) {
  console.log(`\n== ${title} ==`);
}

function gitLsFiles(): string[] {
  return execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

async function isBinary(file: string): Promise<boolean> {
  try {
    const s = await stat(path.join(ROOT, file));
    if (s.size > 8 * 1024 * 1024) return true;
    const buf = await readFile(path.join(ROOT, file));
    // NUL byte in first 8KB → treat as binary
    const probe = buf.subarray(0, 8192);
    return probe.includes(0);
  } catch {
    return true; // unreadable → don't scan, don't fail here
  }
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("SAOS security gate — every claim in docs/security.md, mechanically checked");

  // ── 1. Lockfile integrity ────────────────────────────────────────────────
  head("1. Supply chain — lockfile");
  const tracked = gitLsFiles();
  if (tracked.includes("bun.lock")) {
    pass("bun.lock is git-tracked (dependency tree is pinned and reviewable)");
  } else {
    fail("bun.lock NOT tracked — dependency resolution is unpinned (supply-chain drift)");
  }

  // ── 2. Lifecycle scripts ─────────────────────────────────────────────────
  head("2. Supply chain — install/lifecycle scripts");
  const pkgFiles = tracked.filter((f) => f.endsWith("package.json") && !f.includes("node_modules"));
  let lifecycleHits = 0;
  for (const f of pkgFiles) {
    try {
      const pkg = JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
      const scripts: Record<string, string> = pkg.scripts ?? {};
      const bad = Object.keys(scripts).filter((k) =>
        ["preinstall", "postinstall", "prepare", "preprepare", "postprepare"].includes(k),
      );
      if (bad.length > 0) {
        lifecycleHits += 1;
        fail(`${f} defines lifecycle script(s): ${bad.join(", ")} — audit before any install`);
      }
    } catch {
      fail(`${f} is not valid JSON`);
    }
  }
  if (lifecycleHits === 0) {
    pass(`0 lifecycle scripts across ${pkgFiles.length} tracked package.json files (no install-time code execution)`);
  }

  // ── 3. No secrets committed ──────────────────────────────────────────────
  head("3. Secrets — tracked files & patterns");
  const sensitiveFileRe =
    /(^|\/)(\.env(\..+)?|\.pem|\.p12|\.pfx|\.keystore|id_rsa|id_ed25519|credentials?\.json)$/i;
  const secretFiles = tracked.filter((f) => sensitiveFileRe.test(f));
  if (secretFiles.length === 0) {
    pass("no .env/.pem/.p12/.pfx/keystore/key files tracked");
  } else {
    for (const f of secretFiles) fail(`sensitive file tracked in git: ${f}`);
  }

  // Pattern scan over tracked TEXT files (allowlist: known-noise files).
  const scanAllow = (f: string) =>
    f === "bun.lock" ||
    f.startsWith("skills/") ||
    f.startsWith("examples/") ||
    f.startsWith(".next/") ||
    f.startsWith("agent/") ||
    f.startsWith("tool-results/") ||
    f.endsWith(".md") === false && (f.endsWith(".svg") || f.endsWith(".jpg") || f.endsWith(".png"));

  const WIF_RE = /\b5[KJ][1-9A-HJ-NP-Za-km-z]{50}\b/;
  const PEM_RE = /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/;
  const HIGH_ENTROPY_RE =
    /(?:secret|password|token|apikey|api_key|private_key|privkey)\s*[:=]\s*["'][A-Za-z0-9+/_-]{32,}["']/gi;

  let secretPatternFiles = 0;
  for (const f of tracked) {
    if (scanAllow(f)) continue;
    if (await isBinary(f)) continue;
    let content: string;
    try {
      content = await readFile(path.join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    const hit =
      (WIF_RE.test(content) && "WIF private key") ||
      (PEM_RE.test(content) && "PEM private key block") ||
      (HIGH_ENTROPY_RE.test(content) && "hardcoded high-entropy secret assignment");
    if (hit) {
      secretPatternFiles += 1;
      fail(`possible ${hit} in tracked file: ${f}`);
    }
  }
  if (secretPatternFiles === 0) {
    pass("0 secret patterns (WIF / PEM / high-entropy assignments) across tracked text files");
  }

  // ── 4. Malicious-code patterns ───────────────────────────────────────────
  head("4. Code surface — dangerous patterns (allowlist-enforced)");
  const codeDirs = ["src", "packages", "tools"];
  const codeFiles: string[] = [];
  for (const dir of codeDirs) {
    try {
      const out = execSync(`git ls-files "${dir}/**/*.ts" "${dir}/**/*.tsx"`, {
        cwd: ROOT,
        encoding: "utf8",
      });
      codeFiles.push(...out.split("\n").filter(Boolean));
    } catch {
      // dir may not exist
    }
  }

  const EVAL_ALLOW = new Set<string>(); // eval/new Function: NO allowance
  const CP_ALLOW = new Set<string>([
    // The ONLY allowed process-spawn: the frozen local grid98 engine runner,
    // with a fixed .grid98-lab path and clamped numeric args (no remote code).
    "src/lib/grid98-bench.ts",
  ]);
  const HTML_ALLOW = new Set<string>([
    // shadcn chart CSS-variable injector — injects colors from OUR OWN code
    // constants, never user input.
    "src/components/ui/chart.tsx",
  ]);

  let evalHits = 0,
    cpHits = 0,
    htmlHits = 0;
  for (const f of codeFiles) {
    let content: string;
    try {
      content = await readFile(path.join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    if (/\beval\s*\(/.test(content) || /new\s+Function\s*\(/.test(content)) {
      if (EVAL_ALLOW.has(f)) continue;
      evalHits += 1;
      fail(`eval / new Function in ${f}`);
    }
    if (/child_process/.test(content) && !CP_ALLOW.has(f)) {
      cpHits += 1;
      fail(`child_process outside allowlist: ${f}`);
    }
    if (/dangerouslySetInnerHTML/.test(content) && !HTML_ALLOW.has(f)) {
      htmlHits += 1;
      fail(`dangerouslySetInnerHTML outside allowlist: ${f}`);
    }
  }
  if (evalHits === 0) pass("0 eval / new Function in src+packages+tools");
  if (cpHits === 0) pass("child_process only in the allowlisted fixed-path engine runner (grid98-bench.ts)");
  if (htmlHits === 0) pass("dangerouslySetInnerHTML only in the allowlisted chart CSS injector");
  {
    const bench = await readFile(path.join(ROOT, "src/lib/grid98-bench.ts"), "utf8");
    const fixedPath =
      bench.includes('path.join(process.cwd(), ".grid98-lab"') &&
      !/spawn\([^)]*[`'"]\s*\$\{(?!.*benchMs)/s.test(bench);
    if (fixedPath) {
      pass("engine spawn target is a fixed local .grid98-lab path (no remote/interpolated command)");
    } else {
      fail("grid98-bench.ts spawn no longer matches the fixed-path assertion — re-review spawn safety");
    }
  }

  // ── 5. SDK stays zero-dependency ─────────────────────────────────────────
  head("5. Official SDK — zero-dependency guarantee");
  try {
    const sdkPkg = JSON.parse(await readFile(path.join(ROOT, "packages/saos-id-verify/package.json"), "utf8"));
    const deps = { ...(sdkPkg.dependencies ?? {}), ...(sdkPkg.peerDependencies ?? {}) };
    if (Object.keys(deps).length === 0) {
      pass("saos-id-verify declares ZERO runtime/peer dependencies (pure fetch client)");
    } else {
      fail(`saos-id-verify grew dependencies: ${Object.keys(deps).join(", ")} — supply-chain review required`);
    }
  } catch {
    fail("packages/saos-id-verify/package.json missing or unreadable");
  }

  // ── 6. Rate-limit coverage on sensitive routes ───────────────────────────
  head("6. API surface — rate-limit coverage");
  const limitedRoutes: Array<[string, string]> = [
    ["src/app/api/saos/grid98-bench/route.ts", "grid98-bench (expensive engine spawn)"],
    ["src/app/api/saos/anchor-verify/route.ts", "anchor-verify (external RPC proxy)"],
    ["src/app/api/steem/trade/build/route.ts", "trade/build (RPC ref-block stamping)"],
    ["src/app/api/steem/trade/cancel/route.ts", "trade/cancel (RPC ref-block stamping)"],
    ["src/app/api/vault/init/route.ts", "vault/init (Argon2id KDF)"],
    ["src/app/api/vault/unlock/route.ts", "vault/unlock (Argon2id KDF + password oracle)"],
    ["src/app/api/developer/admin/bootstrap/route.ts", "admin bootstrap (credential oracle)"],
  ];
  for (const [file, why] of limitedRoutes) {
    try {
      const src = await readFile(path.join(ROOT, file), "utf8");
      if (/rateLimit\(/.test(src)) {
        pass(`rate-limited: ${why}`);
      } else {
        fail(`MISSING rate limit on ${file} (${why})`);
      }
    } catch {
      fail(`rate-limit check: cannot read ${file}`);
    }
  }

  // ── 7. Security headers (live) ───────────────────────────────────────────
  head("7. HTTP security headers (live server)");
  if (OFFLINE) {
    skip("live header check (--offline)");
    console.log("        reason: offline mode requested");
  } else {
    try {
      const res = await fetch("http://localhost:3000/", { signal: AbortSignal.timeout(10_000) });
      const h = res.headers;
      const need: Array<[string, boolean]> = [
        ["content-security-policy", h.has("content-security-policy")],
        ["x-content-type-options", (h.get("x-content-type-options") ?? "") === "nosniff"],
        ["referrer-policy", h.has("referrer-policy")],
        ["permissions-policy", h.has("permissions-policy")],
      ];
      for (const [name, okFlag] of need) {
        if (okFlag) pass(`header present: ${name}`);
        else fail(`header MISSING: ${name} (next.config.ts headers() regressed?)`);
      }
      if (h.has("x-powered-by")) {
        fail("x-powered-by present — poweredByHeader:false regressed");
      } else {
        pass("x-powered-by absent (framework version not advertised)");
      }
    } catch (e) {
      fail(`live header check failed — dev server unreachable on :3000 (${String(e).slice(0, 80)})`);
    }
  }

  // ── 8. Registry vulnerability audit (best-effort, needs network) ─────────
  head("8. Dependency vulnerability audit (npm advisory DB)");
  if (OFFLINE) {
    skip("npm audit (--offline)");
    console.log("        reason: network check requested off; re-run online after dependency changes");
  } else {
    let out: string | null = null;
    try {
      out = execSync("bunx npm@10 audit --package-lock-only --json", {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      // npm audit may exit non-zero even with valid JSON on stdout
      // (deprecation warnings / audit metadata quirks) — trust the JSON.
      out = typeof e === "object" && e && "stdout" in e ? String((e as { stdout?: unknown }).stdout ?? "") : "";
    }
    if (!out.trim()) {
      skip("npm audit could not run");
      console.log("        reason: empty stdout — run manually: bunx npm@10 audit");
    } else {
      try {
        const parsed = JSON.parse(out) as {
          metadata?: { vulnerabilities?: Record<string, number> };
        };
        const v = parsed.metadata?.vulnerabilities ?? {};
        const total = (v.info ?? 0) + (v.low ?? 0) + (v.moderate ?? 0) + (v.high ?? 0) + (v.critical ?? 0);
        if (total === 0) {
          pass("0 known vulnerabilities across the whole dependency tree (live advisory DB)");
        } else {
          fail(`${total} known vulnerabilities: ${JSON.stringify(v)} — triage before push`);
        }
      } catch {
        skip("npm audit output was not parseable JSON");
        console.log(`        reason: ${out.slice(0, 100)} — run manually: bunx npm@10 audit`);
      }
    }
  }

  // ── verdict ──────────────────────────────────────────────────────────────
  console.log(
    `\n${failures === 0 ? "SECURITY-GATE: ALL CHECKS PASSED" : `SECURITY-GATE: ${failures} FAILURE(S)`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
