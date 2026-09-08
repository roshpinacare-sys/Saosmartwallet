/**
 * tools/system-status.ts — System Owner report generator (M4)
 * ===========================================================
 * Probes the LIVE /api/system/health endpoint (the same surface the
 * dashboard uses) and writes:
 *   · docs/system-status.json  — canonical machine report
 *   · docs/system-status.md    — human summary (markdown tables)
 *
 * ANTI-MOCK: nothing here invents numbers. What the probe cannot measure
 * is reported as failed/null with the reason, exactly as measured.
 *
 * Usage:  bun tools/system-status.ts   (server on :3000 must be running)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.HEALTH_BASE ?? "http://localhost:3000";
const OUT_DIR = path.resolve("docs");

interface ChainLike {
  id: string;
  name: string;
  family: string;
  kind: string;
  status: string;
  headHeight: number | null;
  lagSeconds: number | null;
  stateAgeSeconds: number | null;
  version: string | null;
  note: string;
  probedAt: string;
}

interface HealthDoc {
  ok: boolean;
  generatedAt: string;
  summary: { networksUp: string; liveRails: number; gatedRails: number; criticalIssues: number };
  checks: {
    networks: { latencyMs: number; chains: ChainLike[] | null; error: string | null };
    bridges: {
      latencyMs: number;
      rails: Array<{ id: string; rail: string; mechanism: string; status: string; evidence: string; explorer: string | null }>;
      analytics: Record<string, unknown> | null;
      routes: Record<string, { readiness: string; gateReason: string | null; estimatedTime: number | null; fee: Array<{ network: string; amount: string; currency: string }> | null }>;
      error: string | null;
    };
    vault: Record<string, unknown>;
    dex: Record<string, unknown>;
  };
  issues: Array<{ component: string; severity: string; detail: string; action: string }>;
  selfHealing: Record<string, string>;
}

async function gitShortSha(): Promise<string> {
  try {
    const { execSync } = await import("node:child_process");
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const res = await fetch(`${BASE}/api/system/health`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`health endpoint HTTP ${res.status}`);
  const health = (await res.json()) as HealthDoc;
  const sha = await gitShortSha();

  const report = {
    ...health,
    meta: {
      generator: "tools/system-status.ts (M4 System Owner)",
      server: BASE,
      gitSha: sha,
    },
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "system-status.json"), JSON.stringify(report, null, 2) + "\n", "utf8");

  // ---- human summary -------------------------------------------------------
  const lines: string[] = [];
  lines.push("# Saosmartwallet — System Status Report");
  lines.push("");
  lines.push(`Generated: \`${report.generatedAt}\` · git \`${sha}\` · source: live \`/api/system/health\``);
  lines.push("");
  lines.push(`**Summary:** networks \`${report.summary.networksUp}\` · rails live \`${report.summary.liveRails}\` · rails gated \`${report.summary.gatedRails}\` · critical issues \`${report.summary.criticalIssues}\``);
  lines.push("");

  lines.push("## Networks");
  lines.push("");
  lines.push("| Network | Status | Head | Lag/State | Version/Evidence |");
  lines.push("|---------|--------|------|-----------|------------------|");
  for (const c of report.checks.networks.chains ?? []) {
    const head = c.headHeight !== null ? c.headHeight.toLocaleString("en-US") : "—";
    const lag = c.lagSeconds !== null ? `${c.lagSeconds}s lag` : c.stateAgeSeconds !== null ? `state ${Math.round(c.stateAgeSeconds / 60)}m old` : "—";
    const ver = c.version ?? c.note;
    lines.push(`| ${c.name} | ${c.status === "online" ? "UP" : c.status.toUpperCase()} | ${head} | ${lag} | ${ver} |`);
  }
  lines.push("");

  lines.push("## Bridge rails");
  lines.push("");
  lines.push("| Rail | Status | Evidence |");
  lines.push("|------|--------|----------|");
  for (const r of report.checks.bridges.rails) {
    lines.push(`| ${r.rail} | ${r.status.toUpperCase()} | ${r.evidence} |`);
  }
  lines.push("");

  lines.push("## Direct bridge routes (live router quotes)");
  lines.push("");
  for (const [k, q] of Object.entries(report.checks.bridges.routes ?? {})) {
    const fees = (q.fee ?? []).map((f) => `${f.amount} ${f.currency}`).join(" + ") || "—";
    lines.push(`- **${k}** — \`${q.readiness}\`${q.gateReason ? ` — ${q.gateReason}` : ""} · fee: ${fees} · ETA ${q.estimatedTime ?? "?"}s`);
  }
  lines.push("");

  lines.push("## Vault");
  lines.push("");
  const v = report.checks.vault;
  lines.push("```json");
  lines.push(JSON.stringify(v, null, 2));
  lines.push("```");
  lines.push("");

  lines.push("## DEX (STEEM/SBD internal market)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.checks.dex, null, 2));
  lines.push("```");
  lines.push("");

  if (report.issues.length > 0) {
    lines.push("## Issues & actions");
    lines.push("");
    lines.push("| Component | Severity | Detail | Action |");
    lines.push("|-----------|----------|--------|--------|");
    for (const i of report.issues) {
      lines.push(`| ${i.component} | ${i.severity} | ${i.detail} | ${i.action} |`);
    }
    lines.push("");
  } else {
    lines.push("## Issues & actions");
    lines.push("");
    lines.push("None detected in this probe.");
    lines.push("");
  }

  lines.push("## Self-healing posture");
  lines.push("");
  for (const [k, val] of Object.entries(report.selfHealing)) {
    lines.push(`- **${k}** — ${val}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("*Every number in this report was measured live at generation time. What cannot be measured is reported as failed/null with the reason — never fabricated.*");

  await writeFile(path.join(OUT_DIR, "system-status.md"), lines.join("\n") + "\n", "utf8");
  console.log(`system-status: ${report.summary.networksUp} networks up · ${report.summary.liveRails} live rails · ${report.summary.criticalIssues} critical issues`);
  console.log("wrote docs/system-status.json + docs/system-status.md");
}

main().catch((e) => {
  console.error("system-status FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
