/**
 * Saosmartwallet — Prisma-backed vault storage seams (M2, task 4-a)
 * ================================================================
 * App-layer implementations of the storage-agnostic seams defined by
 * packages/core (storage/types.ts):
 *
 *   • PrismaVaultStorage — persists the ONE VaultState document
 *     (row id "vault" in the VaultState table).
 *   • PrismaAuditStore   — persists the tamper-evident AuditEvent chain
 *     (seq-ordered rows; actor/target travel as JSON strings, timestamp as
 *     Int epoch-ms per the frozen prisma/schema.prisma models).
 *
 * Design notes:
 *   • Storage failures surface as VaultError("STORAGE_FAILURE") so every
 *     /api/vault route maps them through mapVaultError consistently.
 *   • AuditStore.query applies the type/from/to/result filters in Prisma and
 *     the vaultId containment filter in JS (exact match on the parsed
 *     actor/target JSON — a raw SQL `contains` would match substring ids).
 *     Rows are returned in ASCENDING seq order; AuditSystem re-sorts/limits
 *     itself, and limit/offset are honored here only when explicitly passed.
 *   • No secrets flow through these stores: the state document's key payloads
 *     are already sealed (AES-256-GCM envelopes) and audit events are
 *     metadata-only by construction.
 */

import { Prisma } from "@prisma/client";

import {
  VaultError,
  type AuditEvent,
  type AuditEventType,
  type AuditQueryFilters,
} from "../../packages/core/src/index";
import type {
  AuditStore,
  VaultStateRecord,
  VaultStorage,
} from "../../packages/core/src/storage/types";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// PrismaVaultStorage — the single vault state document
// ---------------------------------------------------------------------------

const VAULT_ROW_ID = "vault";

export class PrismaVaultStorage implements VaultStorage {
  async load(): Promise<VaultStateRecord | null> {
    try {
      const row = await db.vaultState.findUnique({ where: { id: VAULT_ROW_ID } });
      if (row === null) return null;
      return {
        stateJson: row.stateJson,
        genesisHash: row.genesisHash,
        updatedAt: row.updatedAt.getTime(),
      };
    } catch (err) {
      throw new VaultError(
        "STORAGE_FAILURE",
        `failed to read the vault state record: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  async save(stateJson: string, genesisHash: string): Promise<void> {
    try {
      await db.vaultState.upsert({
        where: { id: VAULT_ROW_ID },
        create: { id: VAULT_ROW_ID, stateJson, genesisHash },
        update: { stateJson, genesisHash },
      });
    } catch (err) {
      throw new VaultError(
        "STORAGE_FAILURE",
        `failed to persist the vault state record: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// PrismaAuditStore — the hash-chained audit events
// ---------------------------------------------------------------------------

type AuditEventRow = {
  id: string;
  seq: number;
  timestamp: bigint;
  type: string;
  actorJson: string;
  targetJson: string;
  result: string;
  reason: string | null;
  previousEventHash: string;
  eventHash: string;
};

/** Parses stored JSON with a fail-soft empty-object fallback (never throws). */
function parseStoredJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Rebuilds the engine's AuditEvent from a persisted row. */
function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    seq: row.seq,
    timestamp: Number(row.timestamp),
    type: row.type as AuditEventType,
    actor: parseStoredJson(row.actorJson) as AuditEvent["actor"],
    target: parseStoredJson(row.targetJson) as AuditEvent["target"],
    result: row.result as AuditEvent["result"],
    ...(row.reason !== null ? { reason: row.reason } : {}),
    previousEventHash: row.previousEventHash,
    eventHash: row.eventHash,
  };
}

/**
 * Exact containment check mirroring AuditSystem.buildOperationContext:
 * the event matches when actor.vaultId OR target.vaultId equals the filter
 * (parsed — never a substring scan, which would match "master" inside
 * "master-x"-style ids).
 */
function rowMatchesVaultId(row: AuditEventRow, vaultId: string): boolean {
  const actor = parseStoredJson(row.actorJson);
  if (actor.vaultId === vaultId) return true;
  const target = parseStoredJson(row.targetJson);
  return target.vaultId === vaultId;
}

export class PrismaAuditStore implements AuditStore {
  async append(event: AuditEvent): Promise<void> {
    try {
      await db.auditEvent.create({
        data: {
          id: event.id,
          seq: event.seq,
          timestamp: BigInt(event.timestamp), // BigInt — epoch ms (Int32 overflows)
          type: event.type,
          actorJson: JSON.stringify(event.actor),
          targetJson: JSON.stringify(event.target),
          result: event.result,
          reason: event.reason ?? null,
          previousEventHash: event.previousEventHash,
          eventHash: event.eventHash,
        },
      });
    } catch (err) {
      // A unique-seq violation under a concurrent append is a storage-level
      // ordering failure — surface it honestly instead of dropping the event.
      const detail = err instanceof Error ? err.message : "unknown";
      throw new VaultError("STORAGE_FAILURE", `failed to append audit event seq ${event.seq}: ${detail}`);
    }
  }

  async query(filters: AuditQueryFilters): Promise<AuditEvent[]> {
    const where: Prisma.AuditEventWhereInput = {};
    if (filters.types !== undefined && filters.types.length > 0) {
      where.type = { in: filters.types };
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      where.timestamp = {
        ...(filters.from !== undefined ? { gte: BigInt(filters.from) } : {}),
        ...(filters.to !== undefined ? { lte: BigInt(filters.to) } : {}),
      };
    }
    if (filters.result !== undefined) {
      where.result = filters.result;
    }

    let rows: AuditEventRow[];
    try {
      rows = await db.auditEvent.findMany({ where, orderBy: { seq: "asc" } });
    } catch (err) {
      throw new VaultError(
        "STORAGE_FAILURE",
        `failed to query audit events: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }

    // vaultId containment in JS (exact parsed match — see rowMatchesVaultId).
    let matched: AuditEventRow[] =
      filters.vaultId !== undefined ? rows.filter((r) => rowMatchesVaultId(r, filters.vaultId as string)) : rows;

    // limit/offset are honored ONLY when the caller passes them (AuditSystem
    // applies its own paging on top; the report/context paths need full sets).
    if (filters.offset !== undefined || filters.limit !== undefined) {
      const offset = Math.max(filters.offset ?? 0, 0);
      matched = matched.slice(offset, filters.limit !== undefined ? offset + Math.max(filters.limit, 0) : undefined);
    }

    return matched.map(toAuditEvent);
  }

  async count(filters: AuditQueryFilters): Promise<number> {
    // Ignores limit/offset by contract. The vaultId containment filter needs
    // parsed rows; the remaining filters are cheap native COUNTs.
    if (filters.vaultId !== undefined) {
      const rows = await this.query({ ...filters, limit: undefined, offset: undefined });
      return rows.length;
    }
    const where: Prisma.AuditEventWhereInput = {};
    if (filters.types !== undefined && filters.types.length > 0) {
      where.type = { in: filters.types };
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      where.timestamp = {
        ...(filters.from !== undefined ? { gte: BigInt(filters.from) } : {}),
        ...(filters.to !== undefined ? { lte: BigInt(filters.to) } : {}),
      };
    }
    if (filters.result !== undefined) {
      where.result = filters.result;
    }
    try {
      return await db.auditEvent.count({ where });
    } catch (err) {
      throw new VaultError(
        "STORAGE_FAILURE",
        `failed to count audit events: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  async head(): Promise<AuditEvent | null> {
    try {
      const row = await db.auditEvent.findFirst({ orderBy: { seq: "desc" } });
      return row === null ? null : toAuditEvent(row);
    } catch (err) {
      throw new VaultError(
        "STORAGE_FAILURE",
        `failed to read the audit chain head: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  async all(): Promise<AuditEvent[]> {
    try {
      const rows = await db.auditEvent.findMany({ orderBy: { seq: "asc" } });
      return rows.map(toAuditEvent);
    } catch (err) {
      throw new VaultError(
        "STORAGE_FAILURE",
        `failed to load the audit chain: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}
