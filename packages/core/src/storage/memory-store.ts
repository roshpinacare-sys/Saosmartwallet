/**
 * Saosmartwallet — in-memory storage implementations (M2)
 * ========================================================
 * Used by tools, verification scripts and chaos tests. Prisma-backed stores
 * live in the app layer (src/lib/vault-stores.ts) — same interfaces.
 */

import type { AuditEvent, AuditQueryFilters } from "../types";
import type { AuditStore, VaultStateRecord, VaultStorage } from "./types";

export class MemoryVaultStorage implements VaultStorage {
  private record: VaultStateRecord | null = null;

  async load(): Promise<VaultStateRecord | null> {
    return this.record ? { ...this.record } : null;
  }

  async save(stateJson: string, genesisHash: string): Promise<void> {
    this.record = { stateJson, genesisHash, updatedAt: Date.now() };
  }
}

export class MemoryAuditStore implements AuditStore {
  private events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    if (this.events.some((e) => e.seq === event.seq)) {
      throw new Error(`audit seq collision: ${event.seq}`);
    }
    this.events.push(event);
  }

  async query(filters: AuditQueryFilters): Promise<AuditEvent[]> {
    return this.filter(filters).sort((a, b) => b.seq - a.seq);
  }

  async count(filters: AuditQueryFilters): Promise<number> {
    return this.filter(filters).length;
  }

  async head(): Promise<AuditEvent | null> {
    if (this.events.length === 0) return null;
    return this.events.reduce((max, e) => (e.seq > max.seq ? e : max));
  }

  async all(): Promise<AuditEvent[]> {
    return [...this.events].sort((a, b) => a.seq - b.seq);
  }

  private filter(f: AuditQueryFilters): AuditEvent[] {
    return this.events.filter((e) => {
      if (f.types && f.types.length > 0 && !f.types.includes(e.type)) return false;
      if (f.vaultId && e.actor.vaultId !== f.vaultId && e.target.vaultId !== f.vaultId) return false;
      if (f.from !== undefined && e.timestamp < f.from) return false;
      if (f.to !== undefined && e.timestamp > f.to) return false;
      if (f.result && e.result !== f.result) return false;
      return true;
    });
  }
}
