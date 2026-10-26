/**
 * Saosmartwallet packages/hsm-runtime — hash-chained audit log (JSONL)
 * =====================================================================
 * Every operational event (boot, sign, auth-failure class) lands as one JSONL
 * line carrying ONLY public data: fingerprints, key ids, payload DIGESTS,
 * counts. The chain law (the estate's receipts convention, cf. runner-kit
 * anchor-receipt + giant fx-receipts):
 *
 *     hash(entry) = sha256(prevHash + "|" + JSON.stringify(body))
 *
 * where body excludes seq/prevHash/hash. Genesis prevHash is the sha256 of
 * the chain namespace constant. verify() re-walks the whole file and detects
 * ANY mutation (a full-rewrite attack turns into a loud fail-closed verdict).
 */

import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const CHAIN_NAMESPACE = "saos/hsm-runtime/audit/v1";
export const GENESIS_PREV_HASH = createHash("sha256").update(CHAIN_NAMESPACE).digest("hex");

export interface AuditEntry {
  seq: number;
  at: string;
  event: string;
  prevHash: string;
  hash: string;
  [key: string]: unknown;
}

export class HashChainAudit {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Appends one event; returns the sealed entry. Bodies must be public data only. */
  append(event: string, body: Record<string, unknown>, now: () => Date = () => new Date()): AuditEntry {
    const prevHash = this.headHash();
    const seq = this.count() + 1;
    const entry: AuditEntry = {
      seq,
      at: now().toISOString(),
      event,
      ...body,
      prevHash,
      hash: "",
    };
    entry.hash = this.chainHash(prevHash, entry);
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n", { mode: 0o600 });
    return entry;
  }

  /** Re-walks the file; returns an honest verdict (never throws on a broken file). */
  verify(): { ok: boolean; entries: number; brokenAt?: number; reason?: string } {
    if (!existsSync(this.filePath)) return { ok: true, entries: 0 };
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return { ok: false, entries: 0, reason: "unreadable-audit-file" };
    }
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    let prevHash = GENESIS_PREV_HASH;
    for (let i = 0; i < lines.length; i++) {
      let entry: AuditEntry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        return { ok: false, entries: i, brokenAt: i + 1, reason: "unparseable-line" };
      }
      if (entry.prevHash !== prevHash) {
        return { ok: false, entries: i, brokenAt: i + 1, reason: "prev-hash-mismatch" };
      }
      if (entry.hash !== this.chainHash(entry.prevHash, entry)) {
        return { ok: false, entries: i, brokenAt: i + 1, reason: "hash-mismatch" };
      }
      if (entry.seq !== i + 1) {
        return { ok: false, entries: i, brokenAt: i + 1, reason: "seq-gap" };
      }
      prevHash = entry.hash;
    }
    return { ok: true, entries: lines.length };
  }

  headHash(): string {
    if (!existsSync(this.filePath)) return GENESIS_PREV_HASH;
    const raw = readFileSync(this.filePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return GENESIS_PREV_HASH;
    const last = lines[lines.length - 1];
    try {
      return (JSON.parse(last) as AuditEntry).hash;
    } catch {
      // A corrupt tail must not silently fork the chain — refuse to append.
      throw new Error("HSM_E_AUDIT_CORRUPT — audit tail is unparseable; refusing to extend the chain");
    }
  }

  count(): number {
    if (!existsSync(this.filePath)) return 0;
    const st = statSync(this.filePath);
    if (st.size === 0) return 0;
    const raw = readFileSync(this.filePath, "utf8");
    return raw.split("\n").filter((l) => l.trim().length > 0).length;
  }

  /**
   * The chain hash over the PUBLIC body (hash field excluded while pending).
   * Matches the runner-kit anchor-receipt convention closely enough to be
   * independently recomputable by any fleet tool.
   */
  private chainHash(prevHash: string, entry: Omit<AuditEntry, "hash">): string {
    const { hash: _omit, ...body } = entry as AuditEntry;
    void _omit;
    return createHash("sha256").update(prevHash + "|" + JSON.stringify(body)).digest("hex");
  }
}
