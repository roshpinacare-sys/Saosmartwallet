/**
 * ROAST round 6 — live endpoint AUTH MATRIX (read-only probing).
 * r4 covered vault-M2 paths, r5 covered vault-M3 paths — by memory of "the
 * sensitive ones". r6 probes EVERY route file in the repo anonymously and
 * prints the matrix; anything mutating that answers 200/400/500 to an
 * anonymous caller is a truth-gap (auth must be fail-closed BEFORE input).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/app/api";
const BASE = "http://localhost:3000";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

interface Row {
  route: string;
  method: string;
  status: number;
  bodyHint: string;
}

async function probe(routePath: string, method: string): Promise<Row> {
  const url = BASE + routePath;
  let status = 0;
  let bodyHint = "";
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify({}),
      signal: AbortSignal.timeout(12_000),
    });
    status = res.status;
    const text = await res.text();
    bodyHint = text.slice(0, 90).replace(/\s+/g, " ");
  } catch (e) {
    bodyHint = e instanceof Error ? e.message.slice(0, 80) : String(e);
  }
  return { route: routePath, method, status, bodyHint };
}

async function main() {
  const files = walk(ROOT);
  console.log(`routes found: ${files.length}`);
  const rows: Row[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const routePath = "/" + f.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) =>
      new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src),
    );
    for (const m of methods) {
      rows.push(await probe(routePath, m));
    }
  }
  // sort: suspicious first (2xx/4xx-but-not-401-403 on mutating verbs), then by route
  const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const suspicious = rows.filter((r) => mutating.has(r.method) && r.status !== 401 && r.status !== 403);
  const clean = rows.filter((r) => !suspicious.includes(r));
  console.log(`\n=== SUSPECT (anonymous mutating, NOT 401/403): ${suspicious.length} ===`);
  for (const r of suspicious) console.log(`  ${r.status} ${r.method} ${r.route} :: ${r.bodyHint}`);
  console.log(`\n=== FULL MATRIX (${rows.length} probes) ===`);
  for (const r of rows) console.log(`  ${r.status} ${r.method.padEnd(6)} ${r.route} :: ${r.bodyHint.slice(0, 70)}`);
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
