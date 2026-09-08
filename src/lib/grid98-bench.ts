/**
 * grid98-bench.ts — Demo 2: Grid98 LIVE benchmark (the real engine, no reimplementation)
 * =====================================================================================
 * This does NOT simulate anything. It spawns the ACTUAL production engine
 * (sovereign/node/grid98.cjs, sparse-cloned from the steem repo into
 * .grid98-lab/) with its own `--bench` mode:
 *
 *   grid98.cjs --bench <ms>
 *     → boots the kernel from the real chain-archive.jsonl
 *     → clones the resident state
 *     → replays REAL archive transactions through kernel.applyTx
 *     → records { txs, ms, txsPerSec, capabilityPerDay } into grid98-state.json
 *
 * After the run we read the engine's own ledger (grid98-state.json) and
 * report its measured bench plus the honesty-gate counters the engine
 * accumulated over its life (skippedForEdge / rejected / edgeLeak).
 * Anti-mock: if the lab is missing or the engine fails, we say so —
 * we never fall back to quoting numbers we did not measure now.
 */

import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const LAB_STEEM = path.join(process.cwd(), ".grid98-lab", "steem");
const GRID98_CJS = path.join(LAB_STEEM, "sovereign", "node", "grid98.cjs");
const ARCHIVE = path.join(LAB_STEEM, "sovereign", "node", "chain-archive.jsonl");
const STATE = path.join(LAB_STEEM, "sovereign", "node", "grid98-state.json");

const DEFAULT_BENCH_MS = 20_000;
const MAX_BENCH_MS = 60_000;

export interface Grid98BenchResult {
  ok: boolean;
  measuredAt: string;
  error?: string;
  /** Our live run — measured NOW by the real engine in this sandbox. */
  run: {
    at: string | null;
    ms: number | null;
    txs: number | null;
    txsPerSec: number | null;
    capabilityPerDay: number | null;
    passes: number | null;
    note: string | null;
  } | null;
  /** Honesty-gate counters from the engine's ledger (lifetime discipline). */
  gates: {
    skippedForEdge: number | null;
    rejected: number | null;
    edgeLeak: number | null;
    treasuryPnlMicro: number | null;
    floorSteps: Array<{ at: string; floor: number; backedByMicro: number }>;
  };
  /** Engine provenance — what exactly ran. */
  provenance: {
    engineFile: string;
    archiveFile: string | null;
    archiveBytes: number | null;
    benchMode: string;
  };
  /** Public cross-chain references — clearly labeled, NOT our measurement. */
  references: Array<{ name: string; tps: string; source: string }>;
  runLog?: string[];
}

interface Grid98State {
  at?: string;
  treasuryPnlµ?: number;
  skippedForEdge?: number;
  rejected?: number;
  edgeLeak?: number;
  steps?: Array<{ at: string; floor: number; backedByµ?: number }>;
  bench?: { at?: string; ms?: number; txs?: number; txsPerSec?: number; capabilityPerDay?: number; passes?: number; note?: string };
}

async function labReady(): Promise<{ ready: boolean; reason?: string; archiveBytes: number | null }> {
  try {
    await stat(GRID98_CJS);
  } catch {
    return { ready: false, reason: "grid98-lab not hydrated (engine file missing) — setup runs offline", archiveBytes: null };
  }
  try {
    const s = await stat(ARCHIVE);
    return { ready: true, archiveBytes: s.size };
  } catch {
    return { ready: false, reason: "chain-archive.jsonl missing in lab", archiveBytes: null };
  }
}

function readState(raw: string): Grid98State | null {
  try {
    return JSON.parse(raw) as Grid98State;
  } catch {
    return null;
  }
}

async function runEngineBench(benchMs: number): Promise<{ result: Grid98State | null; log: string[]; exitCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    const log: string[] = [];
    const child = spawn("bun", [GRID98_CJS, "--bench", String(benchMs)], {
      cwd: path.join(LAB_STEEM, "sovereign", "node"),
      env: { ...process.env, G98_TICK_MS: "8000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      log.push("[lab] timeout — killing engine child");
      child.kill("SIGKILL");
    }, benchMs + 150_000); // boot replays the full 39.7MB archive before timing starts
    child.stdout.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) if (line.trim()) log.push(line.trim());
    });
    child.stderr.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) if (line.trim()) log.push(`[stderr] ${line.trim()}`);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ result: null, log, exitCode: null, error: e.message });
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      try {
        const raw = await readFile(STATE, "utf8");
        resolve({ result: readState(raw), log, exitCode: code });
      } catch {
        resolve({ result: null, log, exitCode: code, error: "engine finished but grid98-state.json unreadable" });
      }
    });
  });
}

export async function grid98Bench(benchMsInput?: number): Promise<Grid98BenchResult> {
  const measuredAt = new Date().toISOString();
  const benchMs = Math.min(MAX_BENCH_MS, Math.max(5_000, Math.round(benchMsInput ?? DEFAULT_BENCH_MS)));
  const ready = await labReady();

  if (!ready.ready) {
    return {
      ok: false,
      measuredAt,
      error: ready.reason,
      run: null,
      gates: { skippedForEdge: null, rejected: null, edgeLeak: null, treasuryPnlMicro: null, floorSteps: [] },
      provenance: { engineFile: GRID98_CJS, archiveFile: null, archiveBytes: null, benchMode: `--bench ${benchMs}` },
      references: PUBLIC_REFERENCES,
    };
  }

  const { result, log, exitCode, error } = await runEngineBench(benchMs);

  // The bench result may also come from the pre-existing recorded ledger if the
  // child died — distinguish honestly via the bench.at timestamp freshness.
  const bench = result?.bench ?? null;
  const fresh = !!bench?.at && Math.abs(Date.now() - new Date(bench.at).getTime()) < 10 * 60_000;

  return {
    ok: !!(fresh && bench?.txsPerSec),
    measuredAt,
    error: error ?? (fresh ? undefined : `no fresh bench in engine ledger (exitCode=${exitCode})`),
    run: bench
      ? {
          at: bench.at ?? null,
          ms: bench.ms ?? null,
          txs: bench.txs ?? null,
          txsPerSec: bench.txsPerSec ?? null,
          capabilityPerDay: bench.capabilityPerDay ?? null,
          passes: bench.passes ?? null,
          note: bench.note ?? null,
        }
      : null,
    gates: {
      skippedForEdge: typeof result?.skippedForEdge === "number" ? result.skippedForEdge : null,
      rejected: typeof result?.rejected === "number" ? result.rejected : null,
      edgeLeak: typeof result?.edgeLeak === "number" ? result.edgeLeak : null,
      treasuryPnlMicro: typeof result?.treasuryPnlµ === "number" ? result.treasuryPnlµ : null,
      floorSteps: (result?.steps ?? []).slice(-12).map((s) => ({ at: s.at, floor: s.floor, backedByMicro: s.backedByµ ?? 0 })),
    },
    provenance: {
      engineFile: "sovereign/node/grid98.cjs (production engine, sparse-cloned)",
      archiveFile: "sovereign/node/chain-archive.jsonl",
      archiveBytes: ready.archiveBytes,
      benchMode: `--bench ${benchMs}`,
    },
    references: PUBLIC_REFERENCES,
    runLog: log.slice(-40),
  };
}

const PUBLIC_REFERENCES = [
  { name: "Ethereum (L1)", tps: "~15", source: "public knowledge — NOT our measurement" },
  { name: "Solana (advertised)", tps: "~2,000-4,000 real-world", source: "public network dashboards — NOT our measurement" },
  { name: "Grid98 (measured here)", tps: "live run above", source: "this sandbox, this request" },
];
