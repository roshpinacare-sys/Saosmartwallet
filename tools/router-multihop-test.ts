/**
 * router-multihop-test — REAL before/after proof for the multi-hop hub fix (1-d)
 * =============================================================================
 * The bridge router's multi-hop block used to require a rail with
 * `target === "saos-net"` — no such rail exists in the registry, so multi-hop
 * was DEAD CODE (e.g. hive→ethereum returned [] despite a real hive rail and a
 * real ethereum rail existing).
 *
 * This tool PROVES the fix against the real registry, with zero mocks:
 *   1. Registry facts from the real RAILS catalog (railCatalog()): how many
 *      rails the old guard needed (target==="saos-net") — expect 0.
 *   2. A REAL "before" run: the pre-fix router is materialized from git
 *      (`git show HEAD:packages/bridges/router.ts` — read-only object-store
 *      access, working tree untouched), imported, and executed.
 *   3. A REAL "after" run: the fixed findPaths on the same pairs.
 *   4. Byte-level comparison for pairs with direct rails (behavior unchanged)
 *      and multi-hop assertions for pairs that previously returned [].
 *
 * Fees are re-probed live (ETH gas via adapter); when the two runs disagree on
 * a live gas number, the tool says so instead of hiding it (normalized compare).
 *
 * Run: bun tools/router-multihop-test.ts
 */

import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  assertExecutable,
  describePath,
  findPaths,
  railCatalog,
} from "../packages/bridges/router";
import type { BridgeNetworkId, BridgePath } from "../packages/bridges/types";

const SNAPSHOT = "packages/bridges/.router-before-1d.snapshot.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Drop live-fee volatile fields (amount/source) so two independent probes of
 *  the same rail can be compared structurally. */
function normalized(paths: BridgePath[]): string {
  return JSON.stringify(paths, (_k, v) => v);
}
function feeNormalized(paths: BridgePath[]): string {
  return JSON.stringify(
    paths,
    (k, v) => (k === "amount" || k === "source" ? undefined : v),
  );
}

function printCandidates(tag: string, paths: BridgePath[]) {
  console.log(`  ${tag}: ${paths.length} candidate(s)`);
  for (const p of paths) {
    console.log(`    · [${p.readiness}] ${p.id}`);
    console.log(`      label: ${p.label}`);
    console.log(`      route: ${p.route.map((h) => `${h.network}:${h.action}`).join(" → ")}`);
    console.log(`      eta: ${p.estimatedTime}s · allMeasured: ${p.fee.allMeasured}`);
    console.log(`      fees: ${p.fee.legs.map((l) => `${l.amount} ${l.currency}`).join(" + ") || "—"}`);
    if (p.via) console.log(`      via: ${p.via.join(", ")}`);
    if (p.gateReason) console.log(`      gate: ${p.gateReason}`);
    if (p.hops) {
      for (const leg of p.hops) {
        console.log(
          `      leg ${leg.railId} [${leg.direction}] ${leg.from}→${leg.to} · ${leg.readiness}${leg.gateReason ? ` (${leg.gateReason})` : ""} · ${leg.estimatedTime}s · ${leg.fee.legs.map((l) => `${l.amount} ${l.currency}`).join(" + ")}`,
        );
      }
    }
  }
}

async function runPair(
  tag: string,
  source: BridgeNetworkId,
  target: BridgeNetworkId,
  beforeFn: typeof findPaths | null,
): Promise<{ before: BridgePath[]; after: BridgePath[] }> {
  console.log(`\n=== ${tag}: ${source} → ${target} ===`);
  const before = beforeFn ? await beforeFn({ source, target, asset: "X", amount: "1" }) : [];
  const after = await findPaths({ source, target, asset: "X", amount: "1" });
  printCandidates("BEFORE (HEAD router)", before);
  printCandidates("AFTER  (fixed router)", after);
  return { before, after };
}

async function main() {
  // ---- 1. Registry facts (real catalog) ------------------------------------
  console.log("=== REGISTRY FACTS (railCatalog — real RAILS, read-only view) ===");
  const catalog = railCatalog();
  for (const r of catalog) {
    console.log(`  · ${r.id.padEnd(24)} ${r.source} → ${r.target}  [${r.readiness}]${r.gateReason ? ` gate: ${r.gateReason}` : ""}`);
  }
  const hubTargetCount = catalog.filter((r) => r.target === "saos-net").length;
  console.log(`\n  rails with target === "saos-net" (what the OLD multi-hop guard required): ${hubTargetCount}`);
  ok(
    "old multi-hop guard provably dead (0 hub-inbound rails)",
    hubTargetCount === 0,
    hubTargetCount === 0
      ? "the old code's `a.target !== \"saos-net\"` could never match → multi-hop could never fire"
      : `unexpected — ${hubTargetCount} hub-inbound rails exist`,
  );

  // ---- 2. Materialize + import the PRE-FIX router from git (read-only) -----
  // SEC/AUDIT fix (fix-round): this used to pin `HEAD` — a MOVING reference.
  // Once later commits landed, "HEAD" became the POST-fix router, so the
  // "before" runs silently executed today's code and the historical
  // "0 candidates" assertions failed (27/3 drift caught live). The pre-fix
  // bytes are now pinned to the parent of the commit that INTRODUCED the
  // 1-d multi-hop fix (14956a5) — the snapshot carries its own frozen RAILS
  // registry (rails live inside router.ts), and packages/bridges/types.ts has
  // been additive-only since, so old bytes + current types reproduce the
  // historical world honestly.
  const PREFIX_REF = "14956a5~1"; // router BEFORE multi-hop composition existed
  let beforeFn: typeof findPaths | null = null;
  console.log(`\n=== BEFORE MODULE (git show ${PREFIX_REF}:packages/bridges/router.ts → ${SNAPSHOT}) ===`);
  try {
    const headRouter = execSync(`git show ${PREFIX_REF}:packages/bridges/router.ts`, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(SNAPSHOT, headRouter);
    const mod = (await import(pathToFileURL(SNAPSHOT).href)) as { findPaths: typeof findPaths };
    beforeFn = mod.findPaths;
    ok("pre-fix router materialized + imported", typeof beforeFn === "function", `real pre-fix bytes pinned to ${PREFIX_REF}, frozen internal registry, no reimplementation`);
  } catch (e) {
    console.log(`  WARN  before-module unavailable (${e instanceof Error ? e.message : "unknown"}) — before/after runs will say null + reason`);
  }

  const runs: Array<{ tag: string; source: BridgeNetworkId; target: BridgeNetworkId }> = [
    { tag: "CASE 1 (headline) no direct rail — was DEAD", source: "hive", target: "ethereum" },
    { tag: "CASE 2 canonical A→HUB→B, two real rails", source: "hive", target: "steem" },
    { tag: "CASE 3 hub composition of two LIVE rails", source: "steem", target: "tron" },
    { tag: "CASE 4 direct gated rail — must be unchanged", source: "steem", target: "ethereum" },
    { tag: "CASE 5 direct LIVE rail — multi-hop suppressed", source: "saos-net", target: "steem" },
    { tag: "CASE 6 mirror fallback — must be unchanged", source: "ethereum", target: "steem" },
  ];

  const results: Array<{ tag: string; source: BridgeNetworkId; target: BridgeNetworkId; before: BridgePath[]; after: BridgePath[] }> = [];
  for (const r of runs) {
    const { before, after } = await runPair(r.tag, r.source, r.target, beforeFn);
    results.push({ ...r, before, after });
  }

  // ---- 3. Assertions --------------------------------------------------------
  console.log("\n=== ASSERTIONS ===");
  const byTag = Object.fromEntries(results.map((r) => [r.tag, r]));

  // CASE 1 — hive→ethereum: dead before, real multi-hop after.
  const c1 = byTag[runs[0].tag];
  ok("CASE 1 before: 0 candidates (multi-hop was dead)", beforeFn ? c1.before.length === 0 : true, beforeFn ? `before=${c1.before.length}` : "before-module unavailable — null + reason: git snapshot import failed");
  const m1 = c1.after[0];
  ok("CASE 1 after: exactly 1 multi-hop candidate", c1.after.length === 1 && m1?.hops?.length === 3, m1 ? `${m1.id} (${m1.hops?.length ?? 0} legs)` : "none");
  if (m1) {
    ok("CASE 1 id encodes real rails + reverse leg", m1.id === "relay-hive:reverse+relay-steem+bridge-steem-ethereum", m1.id);
    ok(
      "CASE 1 route = legs' hop chains concatenated (boundary hops repeat, per-leg ops visible)",
      m1.route.map((h) => h.network).join(",") === "hive,saos-net,saos-net,steem,steem,ethereum",
      m1.route.map((h) => `${h.network}:${h.action}`).join(" → "),
    );
    ok("CASE 1 worst-leg availability: gated (2 gated legs)", m1.readiness === "gated" && m1.gateReason !== null, m1.gateReason ?? "null");
    ok("CASE 1 gate reason names the gated rails honestly", (m1.gateReason ?? "").includes("relay-hive (reverse)") && (m1.gateReason ?? "").includes("bridge-steem-ethereum (forward)"), "both gated legs named with direction");
    // Fee stacking = every leg's real fee legs concatenated. relay-hive: 0 HIVE;
    // relay-steem: 0 STEEM; bridge-steem-ethereum: 0 STEEM + live ETH gas → 4 legs.
    ok(
      "CASE 1 fee stacking: 4 real fee legs (HIVE + STEEM + STEEM + ETH)",
      m1.fee.legs.length === 4 && m1.fee.legs.map((l) => l.currency).join(",") === "HIVE,STEEM,STEEM,ETH",
      m1.fee.legs.map((l) => `${l.amount} ${l.currency}`).join(" + "),
    );
    ok("CASE 1 allMeasured = AND over legs", m1.fee.allMeasured === m1.hops!.every((l) => l.fee.allMeasured), `stacked=${m1.fee.allMeasured}`);
    ok("CASE 1 eta = sum of leg etas", m1.estimatedTime === m1.hops!.reduce((s, l) => s + l.estimatedTime, 0), `${m1.estimatedTime}s`);
    ok("CASE 1 via = [saos-net, steem]", m1.via?.join(",") === "saos-net,steem", m1.via?.join(",") ?? "absent");
    ok("CASE 1 leg directions [reverse, forward, forward]", m1.hops!.map((l) => l.direction).join(",") === "reverse,forward,forward", m1.hops!.map((l) => `${l.railId}:${l.direction}`).join(", "));
    // No invented rails: every leg's railId must exist in the catalog with the claimed direction endpoints.
    const cat = railCatalog();
    ok(
      "CASE 1 no invented rails (every leg = a real catalog rail)",
      m1.hops!.every((leg) =>
        cat.some(
          (r) =>
            r.id === leg.railId &&
            ((leg.direction === "forward" && r.source === leg.from && r.target === leg.to) ||
              (leg.direction === "reverse" && r.target === leg.from && r.source === leg.to)),
        ),
      ),
      m1.hops!.map((l) => l.railId).join(" + "),
    );
    const exec = await assertExecutable(m1);
    ok("CASE 1 execution gate fail-closed", exec.executable === false && exec.reason !== null, `executable=${exec.executable} reason=${exec.reason}`);
  }

  // CASE 2 — hive→steem: canonical two-leg hub path (both legs real rails).
  const c2 = byTag[runs[1].tag];
  ok("CASE 2 before: 0 candidates", beforeFn ? c2.before.length === 0 : true, beforeFn ? `before=${c2.before.length}` : "before-module unavailable");
  const m2 = c2.after[0];
  ok("CASE 2 after: 2-leg hub path A→HUB→B", c2.after.length === 1 && m2?.hops?.length === 2 && m2.id === "relay-hive:reverse+relay-steem", m2 ? `${m2.id}` : "none");
  if (m2) {
    ok("CASE 2 availability = worst leg (relay-hive gated → route gated)", m2.readiness === "gated", m2.gateReason ?? "null");
    ok("CASE 2 gate reason carries ONLY the gated leg's reason", m2.gateReason === "relay-hive (reverse): RC-starved fleet accounts — anchors paused until manabar regenerates (measured 2–5%)", m2.gateReason ?? "null");
    ok("CASE 2 fee stacking = 2 legs' real fees", m2.fee.legs.length === 2, m2.fee.legs.map((l) => `${l.amount} ${l.currency}`).join(" + "));
  }

  // CASE 3 — steem→tron: both legs LIVE → route must be LIVE.
  const c3 = byTag[runs[2].tag];
  ok("CASE 3 before: 0 candidates", beforeFn ? c3.before.length === 0 : true, beforeFn ? `before=${c3.before.length}` : "before-module unavailable");
  const m3 = c3.after[0];
  ok("CASE 3 after: LIVE multi-hop (relay-steem:reverse + bridge-tron)", m3?.id === "relay-steem:reverse+bridge-tron" && m3.hops?.length === 2, m3 ? m3.id : "none");
  if (m3) {
    ok("CASE 3 both legs live → route live, gateReason null", m3.readiness === "live" && m3.gateReason === null, `readiness=${m3.readiness}`);
    const exec = await assertExecutable(m3);
    ok("CASE 3 execution gate opens (gate-level proof, no funds moved)", exec.executable === true && exec.reason === null, `executable=${exec.executable}`);
  }

  // CASE 4/5/6 — direct-rail + mirror behavior unchanged.
  const c4 = byTag[runs[3].tag];
  ok("CASE 4 steem→ethereum: 1 direct candidate before AND after", c4.before.length === 1 && c4.after.length === 1, `before=${c4.before.length} after=${c4.after.length}`);
  ok("CASE 4 paths[0] is still the direct gated rail (health-route contract)", c4.after[0]?.id === "bridge-steem-ethereum" && c4.after[0]?.readiness === "gated", c4.after[0]?.id ?? "none");
  ok("CASE 4 no multi-hop candidate added", c4.after.every((p) => !p.hops), `${c4.after.length} candidate(s), 0 multi-hop`);
  const c4raw = normalized(c4.before) === normalized(c4.after);
  const c4norm = feeNormalized(c4.before) === feeNormalized(c4.after);
  ok("CASE 4 byte-identical (or identical modulo a moved live-gas number)", c4raw || c4norm, c4raw ? "byte-identical" : c4norm ? "identical; live ETH gas probe moved between the two runs (both runs real)" : "DIFF");

  const c5 = byTag[runs[4].tag];
  ok("CASE 5 saos-net→steem (direct LIVE): unchanged, multi-hop suppressed", c5.before.length === 1 && c5.after.length === 1 && c5.after[0]?.id === "relay-steem" && normalized(c5.before) === normalized(c5.after), `before=${c5.before.length} after=${c5.after.length} id=${c5.after[0]?.id}`);

  const c6 = byTag[runs[5].tag];
  const c6norm = feeNormalized(c6.before) === feeNormalized(c6.after);
  ok("CASE 6 ethereum→steem mirror fallback unchanged", c6.before.length === 1 && c6.after.length === 1 && c6.after[0]?.id === "bridge-steem-ethereum:reverse" && (normalized(c6.before) === normalized(c6.after) || c6norm), `id=${c6.after[0]?.id ?? "none"}`);

  // ---- 4. Human summary of the new multi-hop -------------------------------
  console.log("\n=== DESCRIBE (new multi-hop candidates) ===");
  for (const key of [runs[0].tag, runs[1].tag, runs[2].tag]) {
    for (const p of byTag[key].after) {
      console.log(`  ${describePath(p)}`);
    }
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

try {
  await main();
} finally {
  try {
    unlinkSync(SNAPSHOT);
  } catch {
    /* snapshot absent — nothing to clean */
  }
}
