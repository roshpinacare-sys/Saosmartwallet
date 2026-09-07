/**
 * Saosmartwallet — Sovereign Key Vault storage seams (M2)
 * =======================================================
 * packages/core is storage-agnostic: it defines the interfaces here; the app
 * layer (src/lib/vault-stores.ts) provides Prisma-backed implementations and
 * tools/tests use the in-memory store (storage/memory-store.ts).
 *
 * VaultStorage persists ONE state document (the non-secret hierarchy +
 * sealed keys). AuditStore persists the tamper-evident event chain.
 */

import type { AuditEvent, AuditQueryFilters } from "../types";

export interface VaultStateRecord {
  stateJson: string;
  genesisHash: string;
  updatedAt: number;
}

export interface VaultStorage {
  /** Returns the persisted state record, or null when the vault was never initialized. */
  load(): Promise<VaultStateRecord | null>;
  /** Upserts the state document. Implementations must make this atomic. */
  save(stateJson: string, genesisHash: string): Promise<void>;
}

export interface AuditStore {
  /** Persists one event; must preserve seq ordering (unique seq). */
  append(event: AuditEvent): Promise<void>;
  /** Newest-first page by default (implementations decide ordering; audit.ts sorts). */
  query(filters: AuditQueryFilters): Promise<AuditEvent[]>;
  /** Total events matching the same filters (ignores limit/offset). */
  count(filters: AuditQueryFilters): Promise<number>;
  /** Highest-seq event, or null for an empty chain. */
  head(): Promise<AuditEvent | null>;
  /** Every event, ascending seq — integrity walks only. */
  all(): Promise<AuditEvent[]>;
}
