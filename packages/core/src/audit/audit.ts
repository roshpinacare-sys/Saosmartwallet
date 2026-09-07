/**
 * Saosmartwallet — tamper-evident audit system (layer 6)
 * ======================================================
 * Append-only event chain over an {@link AuditStore}: every event's hash is
 * `sha256_hex(previousEventHash ‖ canonicalJson({seq,timestamp,type,actor,
 * target,result,reason}))`, anchored at a per-vault genesis hash. The previous
 * hash is deliberately EXCLUDED from its own preimage (it is already bound via
 * chaining), so `verifyIntegrity` can recompute every hash from the stored
 * chain alone. Hash mismatches are reported, NEVER repaired.
 *
 * Also provides newest-first paginated queries and json/csv/pdf compliance
 * reports bound to the chain head, plus `buildOperationContext` — the bridge
 * that turns raw audit events into the `OperationContext` the policy engine
 * consumes.
 */

import { createHash, randomUUID } from "node:crypto";
import { bytesToB64, canonicalJson, parseSats } from "../encoding";
import type {
  AuditActor,
  AuditEvent,
  AuditEventType,
  AuditQueryFilters,
  AuditTarget,
  ComplianceReport,
  ComplianceReportFormat,
  HistoryEntry,
  NetworkId,
  OperationContext,
} from "../types";
import type { AuditStore } from "../storage/types";
import { renderPdfReport } from "./pdf";

// ---------------------------------------------------------------------------
// Public option/input shapes
// ---------------------------------------------------------------------------

/** Constructor options for {@link AuditSystem}. */
export interface AuditSystemOptions {
  /** Clock override (tests / deterministic replay). Defaults to `Date.now`. */
  now?: () => number;
}

/** Input for {@link AuditSystem.log}. */
export interface LogAuditInput {
  /** Event type (see `AuditEventType`). */
  type: AuditEventType;
  /** Who acted — vault/key/device identity. */
  actor: AuditActor;
  /** What was acted upon — vault/key/operation + free-form detail. */
  target: AuditTarget;
  /** Outcome of the audited action. */
  result: "success" | "failure" | "blocked";
  /** Optional human-readable reason (hash-bound, surfaces in reports). */
  reason?: string;
  /** Vault instance id — anchors the chain genesis for a fresh store. */
  vaultInstanceId: string;
}

/** Result of {@link AuditSystem.verifyIntegrity}. */
export interface AuditIntegrityResult {
  /** True when the whole chain recomputed cleanly. */
  integrityOk: boolean;
  /** Number of events whose hashes were recomputed (includes a failing one). */
  eventsChecked: number;
  /** Seq of the first corrupt/discontinuous event, or null when intact. */
  firstBadSeq: number | null;
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

/** sha256 over a UTF-8 string, hex-encoded — the only hash used in this layer. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** The exact field set bound into an event hash (mirrors `AuditEvent` minus ids/hashes). */
interface HashPreimageFields {
  seq: number;
  timestamp: number;
  type: AuditEventType;
  actor: AuditActor;
  target: AuditTarget;
  result: "success" | "failure" | "blocked";
  reason?: string;
}

/**
 * `sha256_hex(previousEventHash ‖ canonicalJson(fields))` — the single hash
 * formula shared by `log` and `verifyIntegrity`. `previousEventHash` is the
 * CHAIN prefix, not part of the canonical JSON; `reason` is dropped when
 * undefined by `canonicalJson`.
 */
function computeEventHash(previousEventHash: string, fields: HashPreimageFields): string {
  return sha256Hex(
    previousEventHash +
      canonicalJson({
        seq: fields.seq,
        timestamp: fields.timestamp,
        type: fields.type,
        actor: fields.actor,
        target: fields.target,
        result: fields.result,
        reason: fields.reason,
      }),
  );
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

const CSV_HEADER = "seq,timestamp_iso,type,result,vault_id,reason,event_hash";

/** Context event types feeding `buildOperationContext` (signing lifecycle only). */
const CONTEXT_TYPES: readonly AuditEventType[] = ["signing_attempt", "broadcast", "policy_violation"];

/** ISO-8601 UTC timestamp for reports. */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Truncate a report line to `max` characters with an ellipsis. */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

/**
 * Redact an event for non-sensitive reports: drops `actor.ipAddress`,
 * `actor.deviceId` and `actor.location`, keeping only internal vault/key ids.
 * Target data (operation details) is compliance-relevant and stays.
 */
function redactActor(e: AuditEvent): AuditEvent {
  return { ...e, actor: { vaultId: e.actor.vaultId, keyId: e.actor.keyId } };
}

/**
 * CSV cell encoder: strips newlines/tabs to keep one physical row per event,
 * prefixes cells starting with `= + - @` with `'` (CSV-formula injection
 * guard), and quote-wraps cells containing commas/quotes (doubling quotes).
 */
function csvCell(value: string): string {
  let s = value.replace(/[\r\n\t]+/g, " ");
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One CSV row per event (fixed 7-column layout, see {@link CSV_HEADER}). */
function csvRow(e: AuditEvent): string {
  const cells = [
    String(e.seq),
    iso(e.timestamp),
    e.type,
    e.result,
    e.actor.vaultId ?? e.target.vaultId ?? "",
    e.reason ?? "",
    e.eventHash,
  ];
  return cells.map(csvCell).join(",");
}

/** Short human summary for a PDF per-event line (reason, or operation digest). */
function eventSummary(e: AuditEvent): string {
  if (e.reason !== undefined) return e.reason;
  const op = e.target.operation;
  if (op === undefined) return "";
  return `${op.type} ${op.amountSatoshis} ${op.symbol}` + (op.counterparty ? ` to ${op.counterparty}` : "");
}

// ---------------------------------------------------------------------------
// AuditSystem
// ---------------------------------------------------------------------------

/**
 * The audit layer: hash-chained logging, querying, integrity verification,
 * compliance reporting and operation-context building. All state lives in the
 * injected {@link AuditStore}; this class itself is stateless.
 */
export class AuditSystem {
  private readonly store: AuditStore;
  private readonly now: () => number;

  /**
   * @param store — persistence seam (memory for tests, Prisma-backed in the app).
   * @param opts — optional clock override for deterministic tests.
   */
  constructor(store: AuditStore, opts?: AuditSystemOptions) {
    this.store = store;
    this.now = opts?.now ?? Date.now;
  }

  /**
   * Chain anchor for a vault instance:
   * `sha256("saos-audit-genesis:" + vaultInstanceId)`, hex-encoded. Event 0's
   * `previousEventHash` equals this value, binding the chain to the vault.
   */
  genesisHash(vaultInstanceId: string): string {
    return sha256Hex(`saos-audit-genesis:${vaultInstanceId}`);
  }

  /**
   * Append one event to the hash chain. The head (or the vault genesis hash
   * for an empty chain) determines `previousEventHash` and `seq`; the event
   * hash is computed over the canonical JSON of
   * `{seq,timestamp,type,actor,target,result,reason}` prefixed with the
   * previous hash. Persists via `store.append` and returns the full event.
   */
  async log(input: LogAuditInput): Promise<AuditEvent> {
    const head = await this.store.head();
    const previousEventHash = head !== null ? head.eventHash : this.genesisHash(input.vaultInstanceId);
    const seq = head !== null ? head.seq + 1 : 0;
    const timestamp = this.now();
    const event: AuditEvent = {
      id: `evt-${seq}-${randomUUID().slice(0, 8)}`,
      seq,
      timestamp,
      type: input.type,
      actor: input.actor,
      target: input.target,
      result: input.result,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      previousEventHash,
      eventHash: "",
    };
    event.eventHash = computeEventHash(previousEventHash, event);
    await this.store.append(event);
    return event;
  }

  /**
   * Query events: store filtering, then newest-first sort, then
   * `limit` (default 100, clamped to ≤ 500) and `offset` applied here so the
   * semantics hold regardless of the store implementation.
   */
  async query(filters: AuditQueryFilters): Promise<AuditEvent[]> {
    const storeFilters: AuditQueryFilters = {
      types: filters.types,
      vaultId: filters.vaultId,
      from: filters.from,
      to: filters.to,
      result: filters.result,
    };
    const all = await this.store.query(storeFilters);
    const sorted = [...all].sort((a, b) => b.seq - a.seq);
    const limit = filters.limit === undefined ? 100 : Math.min(Math.max(filters.limit, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);
    return sorted.slice(offset, offset + limit);
  }

  /** Total events matching the filters (delegates to the store; ignores limit/offset). */
  async count(filters: AuditQueryFilters): Promise<number> {
    return this.store.count(filters);
  }

  /** Highest-seq event (chain head), or null for an empty chain. */
  async head(): Promise<AuditEvent | null> {
    return this.store.head();
  }

  /**
   * Walk the whole chain ascending and recompute every event hash from the
   * PREVIOUS event's stored hash (genesis for seq 0) plus the canonical
   * fields; verify seq continuity and that each stored `previousEventHash`
   * links correctly. First mismatch wins. Corrupt events are never repaired —
   * callers must escalate (the vault is treated as compromised).
   */
  async verifyIntegrity(vaultInstanceId: string): Promise<AuditIntegrityResult> {
    const events = await this.store.all();
    let previousHash = this.genesisHash(vaultInstanceId);
    let expectedSeq = 0;
    for (const event of events) {
      const broken =
        event.seq !== expectedSeq ||
        event.previousEventHash !== previousHash ||
        computeEventHash(previousHash, event) !== event.eventHash;
      if (broken) {
        return { integrityOk: false, eventsChecked: expectedSeq + 1, firstBadSeq: event.seq };
      }
      previousHash = event.eventHash;
      expectedSeq = event.seq + 1;
    }
    return { integrityOk: true, eventsChecked: events.length, firstBadSeq: null };
  }

  /**
   * Generate a compliance report for a period (inclusive bounds on
   * `timestamp`). Events are re-filtered to the exact period, sorted
   * ascending, and the report is bound to the chain head hash at generation
   * time plus the live integrity verdict.
   *
   * Body by format:
   * - `json` — pretty-printed `{period, generatedAt, headHash, integrityOk,
   *   counts, events}`; actors are REDACTED (ip/device/location dropped)
   *   unless `includeSensitive` is true.
   * - `csv` — fixed header `seq,timestamp_iso,type,result,vault_id,reason,
   *   event_hash` with quote-escaping and CSV-injection guards.
   * - `pdf` — base64-encoded PDF bytes (binary travels as base64 per the
   *   core serialization rules) rendered from text lines.
   */
  async generateReport(
    period: { start: number; end: number },
    format: ComplianceReportFormat,
    opts: { vaultInstanceId: string; title?: string; includeSensitive?: boolean },
  ): Promise<ComplianceReport> {
    const fetched = await this.store.query({ from: period.start, to: period.end });
    const events = fetched
      .filter((e) => e.timestamp >= period.start && e.timestamp <= period.end)
      .sort((a, b) => a.seq - b.seq);
    const integrity = await this.verifyIntegrity(opts.vaultInstanceId);
    const head = await this.store.head();
    const headHash = head !== null ? head.eventHash : this.genesisHash(opts.vaultInstanceId);
    const generatedAt = this.now();

    let body: string;
    switch (format) {
      case "json": {
        const counts: Record<string, number> = {};
        for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
        const report = {
          period,
          generatedAt,
          headHash,
          integrityOk: integrity.integrityOk,
          counts,
          events: opts.includeSensitive === true ? events : events.map(redactActor),
        };
        body = JSON.stringify(report, null, 2);
        break;
      }
      case "csv": {
        const rows = [CSV_HEADER, ...events.map(csvRow)];
        body = rows.join("\n") + "\n";
        break;
      }
      case "pdf": {
        const lines: string[] = [
          opts.title ?? "Saosmartwallet — Audit Compliance Report",
          "",
          `Period: ${iso(period.start)} – ${iso(period.end)}`,
          `Generated: ${iso(generatedAt)}`,
          `Vault instance: ${opts.vaultInstanceId}`,
          `Chain head: ${headHash}`,
          integrity.integrityOk
            ? "Integrity: VERIFIED (hash chain intact)"
            : `Integrity: FAILED — first bad event at seq ${integrity.firstBadSeq}`,
          `Events in period: ${events.length}`,
          "",
        ];
        for (const e of events) {
          lines.push(truncate(`#${e.seq} [${e.type}] ${e.result} ${eventSummary(e)}`, 90));
        }
        body = bytesToB64(renderPdfReport(lines));
        break;
      }
    }

    return {
      period,
      format,
      body,
      eventCount: events.length,
      generatedAt,
      headHash,
      integrityOk: integrity.integrityOk,
    };
  }

  /**
   * Build the policy-engine `OperationContext` for a vault instance at a
   * point in time. Pulls signing-lifecycle events (signing_attempt / broadcast
   * / policy_violation) for the vault up to `base.timestamp`, maps the newest
   * `historyLimit` (default 200) into `HistoryEntry[]` (amount/symbol/
   * counterparty taken from `target.operation` when present), and computes the
   * user-behavior aggregates from that same window:
   *
   * - `averageTransferSatoshis` — bigint mean of transfer-type amounts, "0"
   *   when there are none;
   * - `averageOperationsPerHour` — events in the trailing 24h ÷ 24, raised to
   *   ≥ 1 when any event exists;
   * - `typicalCounterparties` — counterparties with ≥ 2 successful events,
   *   sorted for determinism.
   *
   * `dayOfWeek`/`hourOfDay` are UTC-derived from `base.timestamp`.
   */
  async buildOperationContext(
    vaultInstanceId: string,
    base: { timestamp: number; network: NetworkId; trustedDevice: boolean; stepUpSatisfied: boolean; historyLimit?: number },
  ): Promise<OperationContext> {
    const historyLimit = base.historyLimit ?? 200;
    const pulled = await this.store.query({ vaultId: vaultInstanceId, types: [...CONTEXT_TYPES] });
    const mine = pulled
      .filter(
        (e) =>
          e.timestamp <= base.timestamp &&
          (e.actor.vaultId === vaultInstanceId || e.target.vaultId === vaultInstanceId),
      )
      .sort((a, b) => b.seq - a.seq);

    const history: HistoryEntry[] = mine.slice(0, historyLimit).map((e) => {
      const op = e.target.operation;
      return {
        timestamp: e.timestamp,
        type: op !== undefined ? op.type : e.type,
        network: op !== undefined ? op.network : base.network,
        counterparty: op !== undefined ? op.counterparty : null,
        amountSatoshis: op !== undefined ? op.amountSatoshis : "0",
        symbol: op !== undefined ? op.symbol : "",
        result: e.result,
      };
    });

    const transferAmounts: bigint[] = [];
    for (const h of history) {
      if (!h.type.startsWith("transfer")) continue;
      try {
        transferAmounts.push(parseSats(h.amountSatoshis));
      } catch {
        // Malformed amount on a historical entry — exclude from the mean.
      }
    }
    const averageTransferSatoshis =
      transferAmounts.length > 0
        ? (transferAmounts.reduce((acc, v) => acc + v, 0n) / BigInt(transferAmounts.length)).toString()
        : "0";

    const dayAgo = base.timestamp - 86_400_000;
    const opsIn24h = history.filter((h) => h.timestamp > dayAgo).length;
    const averageOperationsPerHour = opsIn24h === 0 ? 0 : Math.max(opsIn24h / 24, 1);

    const successCounts = new Map<string, number>();
    for (const h of history) {
      if (h.counterparty === null || h.counterparty === "" || h.result !== "success") continue;
      successCounts.set(h.counterparty, (successCounts.get(h.counterparty) ?? 0) + 1);
    }
    const typicalCounterparties = [...successCounts.entries()]
      .filter(([, n]) => n >= 2)
      .map(([cp]) => cp)
      .sort();

    const at = new Date(base.timestamp);
    return {
      timestamp: base.timestamp,
      dayOfWeek: at.getUTCDay(),
      hourOfDay: at.getUTCHours(),
      network: base.network,
      history,
      userBehavior: { averageTransferSatoshis, averageOperationsPerHour, typicalCounterparties },
      trustedDevice: base.trustedDevice,
      stepUpSatisfied: base.stepUpSatisfied,
    };
  }
}
