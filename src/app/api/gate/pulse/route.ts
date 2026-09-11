import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError, masterReady } from "@/lib/gate/crypto";
import { readPulseHistory, runPulseCycle } from "@/lib/gate/pulse";

export const runtime = "nodejs";

/**
 * GET /api/gate/pulse — the pulse plane's public read: the latest cycles
 * from the audit trail + the current vault digest + whether the vault is
 * open (signing needs it). No secrets — public state only.
 */
export async function GET() {
  try {
    const [history, digest] = await Promise.all([
      readPulseHistory(),
      import("@/lib/gate/anchor").then((m) => m.vaultDigestV2()).catch(() => null),
    ]);
    return ok({
      plane: "pulse.r33 — הפעימה חוזרת-הביתה",
      vaultOpen: masterReady(),
      digest: digest?.digest ?? null,
      counts: digest?.counts ?? null,
      cycles: history,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * POST /api/gate/pulse — the operator fires a pulse round NOW.
 * { round?: string } — default `operator-<date>`. Operator-only; the vault
 * must be open in this process (fail-closed). Force bypasses the daily
 * one-pulse cap because an explicit operator round IS the intent signal.
 * Honest gates still apply per rail (identity, fuel, gas, RC).
 */
export async function POST(req: Request) {
  try {
    const operator = await requireOperator();
    const body = (await req.json().catch(() => ({}))) as { round?: string; only?: string[] };
    const round = String(body.round || `operator-${new Date().toISOString().slice(0, 10)}`).slice(0, 60);
    const only = Array.isArray(body.only) ? body.only.map((s) => String(s).slice(0, 20)).slice(0, 6) : undefined;
    if (!masterReady()) throw new GateError("vault-locked", "הכספת נעולה — פעימה דורשת פתיחה (fail-closed)");
    const r = await runPulseCycle(round, `operator:${operator.name ?? "operator"}`, { force: true, only });
    if (r.skipped) return ok({ skipped: true, round, meaning: "הפעימה של היום כבר נרשמה" });
    const landed = r.rails.filter((x) => x.ok && x.onChain);
    return ok({
      round,
      digest: r.digest,
      landed: landed.length,
      total: r.rails.length,
      rails: r.rails.map((x) => ({ rail: x.rail, ok: x.ok, txId: x.txId, blockNum: x.blockNum, onChain: x.onChain, mode: x.mode, detail: x.detail, error: x.error })),
    });
  } catch (e) {
    return fail(e);
  }
}
