/**
 * Saosmartwallet — SwapSession orchestrator (task 4-c, directive §3)
 * ==================================================================
 * A SwapSession holds BOTH sides' view of one swap (an initiator-side and a
 * redeemer-side SwapMachine) and advances them in lockstep on validated
 * messages. Every accepted message is recorded into a sha256-chained receipt
 * chain (the fleet hash-chain law, messages.ts) whose final hash — the
 * session chain hash — is the session's identity:
 *
 *   receipts()  → the hash-chained audit trail (tamper-evident)
 *   chainHash() → the last record's hash (sealable, signable)
 *   verify()    → re-verifies the whole chain
 *
 * Vault integration (packages/vault, AES-256-GCM, fail-closed):
 *   sealSessionReceipt(vault, id, session) → seals chainHash() as an opaque
 *   vault secret with public meta (swapId, receipt count).
 *   openSessionReceipt(vault, id) → returns the sealed chain hash for
 *   comparison against a live session — a diverged/tampered history no
 *   longer matches the sealed truth.
 *
 * The receipt chain hash is also directly Ed25519-signable through the
 * vault (vault.signEd25519) — sign now or later, the hash is the artifact.
 *
 * DIVERGENCE LAW (fail-closed): the two views must always agree. If one view
 * ever advances while the other refuses (an internal invariant breach), the
 * session is POISONED — every further operation throws HTLC_E_DIVERGENCE
 * until the process is restarted from a trustworthy state. No silent drift.
 */

import { HtlcError } from "./errors";
import {
  appendRecord,
  validateOffer,
  verifyChain,
  type HtlcMessage,
  type Offer,
  type ReceiptRecord,
} from "./messages";
import { SwapMachine, type SwapState } from "./state";

// ---------------------------------------------------------------------------
// vault seam — structural type; packages/vault satisfies it exactly
// ---------------------------------------------------------------------------

/**
 * The minimal vault surface this package integrates with. `packages/vault`'s
 * Vault class satisfies it structurally — no import, no dependency edge, the
 * integration is typed but decoupled.
 */
export interface VaultLike {
  sealKey(input: {
    id: string;
    type: "opaque";
    material: Buffer | string;
    meta?: Record<string, unknown> | null;
  }): Promise<unknown>;
  unsealKey(id: string): Promise<{ type: string; material: Buffer; meta: Record<string, unknown> | null }>;
}

export interface SealedSessionReceipt {
  id: string;
  chainHash: string;
  swapId: string;
  receipts: number;
}

export interface OpenedSessionReceipt {
  id: string;
  chainHash: string;
  swapId: string | null;
  receipts: number | null;
}

const CHAIN_HASH_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// SwapSession
// ---------------------------------------------------------------------------

export class SwapSession {
  private readonly offer: Offer;
  private readonly clock: () => number;
  private readonly initiatorView: SwapMachine;
  private readonly redeemerView: SwapMachine;
  private readonly records: ReceiptRecord[] = [];
  /** Set when the dual-view invariant is ever breached — permanent, fail-closed. */
  private poisoned = false;

  /** Fails closed on an invalid offer; records the genesis offer receipt. */
  constructor(offer: Offer, clock: () => number = Date.now) {
    this.offer = validateOffer(offer);
    if (typeof clock !== "function") {
      throw new HtlcError("HTLC_E_BAD_INPUT", "clock must be a function returning epoch ms");
    }
    this.clock = clock;
    this.initiatorView = new SwapMachine(this.offer, clock);
    this.redeemerView = new SwapMachine(this.offer, clock);
    this.record("offer", this.offer, "Initiated");
  }

  get swapId(): string {
    return this.offer.swapId;
  }

  /**
   * The agreed swap state — both views MUST agree; disagreement is an
   * internal invariant breach and throws HTLC_E_DIVERGENCE (fail-closed).
   */
  get state(): SwapState {
    this.assertHealthy();
    this.assertAgree();
    return this.initiatorView.state;
  }

  /** The initiator-side machine view (read-only audit access). */
  get initiator(): Readonly<SwapMachine> {
    return this.initiatorView;
  }

  /** The redeemer-side machine view (read-only audit access). */
  get redeemer(): Readonly<SwapMachine> {
    return this.redeemerView;
  }

  /**
   * Applies a validated message to BOTH views in lockstep and appends a
   * receipt record. Refusals propagate as typed HtlcErrors with BOTH views
   * and the receipt chain untouched.
   */
  submit(message: HtlcMessage): SwapSession {
    this.assertHealthy();

    if (message.kind === "offer") {
      throw new HtlcError(
        "HTLC_E_INVALID_TRANSITION",
        `session ${this.offer.swapId} is already opened with its offer — offer messages cannot be submitted`,
      );
    }
    if (message.swapId !== this.offer.swapId) {
      throw new HtlcError(
        "HTLC_E_SWAP_MISMATCH",
        `message targets swap "${message.swapId}" but this session is "${this.offer.swapId}"`,
      );
    }

    switch (message.kind) {
      case "lock": {
        this.initiatorView.lock("initiator");
        try {
          this.redeemerView.lock("initiator");
        } catch (e) {
          this.poisonDualView(e, "lock");
        }
        this.assertAgree();
        this.record("lock", message, "Locked");
        break;
      }
      case "claim": {
        this.initiatorView.claim("redeemer", message.secret);
        try {
          this.redeemerView.claim("redeemer", message.secret);
        } catch (e) {
          this.poisonDualView(e, "claim");
        }
        this.assertAgree();
        this.record("claim", message, "Redeemed");
        break;
      }
      case "refund": {
        this.initiatorView.refund("initiator");
        try {
          this.redeemerView.refund("initiator");
        } catch (e) {
          this.poisonDualView(e, "refund");
        }
        this.assertAgree();
        this.record("refund", message, "Refunded");
        break;
      }
    }
    return this;
  }

  /** The hash-chained receipt trail (copy — callers may tamper their copy). */
  receipts(): readonly ReceiptRecord[] {
    return [...this.records];
  }

  /** Re-verifies the whole receipt chain (always true for a healthy session). */
  verify(): boolean {
    return verifyChain(this.records);
  }

  /** The chain hash: last record's hash (session always has ≥1 record). */
  chainHash(): string {
    return this.records[this.records.length - 1].hash;
  }

  // ------------------------------------------------------------------ internal

  private assertHealthy(): void {
    if (this.poisoned) {
      throw new HtlcError(
        "HTLC_E_DIVERGENCE",
        `session ${this.offer.swapId} is poisoned by an earlier dual-view divergence — refusing all operations`,
      );
    }
  }

  private assertAgree(): void {
    if (this.initiatorView.state !== this.redeemerView.state) {
      this.poisoned = true;
      throw new HtlcError(
        "HTLC_E_DIVERGENCE",
        `views diverged on swap ${this.offer.swapId}: initiator=${this.initiatorView.state} ` +
          `redeemer=${this.redeemerView.state} — session poisoned (fail-closed)`,
      );
    }
  }

  private poisonDualView(cause: unknown, op: string): never {
    this.poisoned = true;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new HtlcError(
      "HTLC_E_DIVERGENCE",
      `initiator view accepted "${op}" but redeemer view refused on swap ${this.offer.swapId} ` +
        `— session poisoned: ${detail}`,
    );
  }

  private record(kind: ReceiptRecord["kind"], payload: HtlcMessage, result: SwapState): void {
    try {
      this.records.push(
        appendRecord(this.records, {
          kind,
          at: this.clock(),
          swapId: this.offer.swapId,
          payload,
          result,
        }),
      );
    } catch (e) {
      this.poisoned = true;
      const detail = e instanceof Error ? e.message : String(e);
      throw new HtlcError(
        "HTLC_E_DIVERGENCE",
        `receipt append failed on swap ${this.offer.swapId} — session poisoned: ${detail}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// vault integration — seal / open the session receipt chain hash
// ---------------------------------------------------------------------------

/**
 * Seals the session's final receipt-chain hash as an opaque vault secret.
 * Public meta records the swapId, receipt count and the hash itself (the
 * hash is public data — it commits to the history without revealing
 * secrets). Duplicate ids fail closed inside the vault.
 */
export async function sealSessionReceipt(
  vault: VaultLike,
  id: string,
  session: SwapSession,
): Promise<SealedSessionReceipt> {
  if (!session.verify()) {
    throw new HtlcError(
      "HTLC_E_BAD_INPUT",
      `refusing to seal session ${session.swapId}: its receipt chain does not verify`,
    );
  }
  const chainHash = session.chainHash();
  await vault.sealKey({
    id,
    type: "opaque",
    material: chainHash,
    meta: { protocol: "SAOS-HTLC/1", swapId: session.swapId, receipts: session.receipts().length, chainHash },
  });
  return { id, chainHash, swapId: session.swapId, receipts: session.receipts().length };
}

/**
 * Opens a sealed session receipt. Fail-closed: a non-opaque payload, a
 * wrong-shaped chain hash or any vault auth failure throws.
 */
export async function openSessionReceipt(vault: VaultLike, id: string): Promise<OpenedSessionReceipt> {
  const unsealed = await vault.unsealKey(id);
  if (unsealed.type !== "opaque") {
    throw new HtlcError("HTLC_E_BAD_INPUT", `sealed value under "${id}" is type "${unsealed.type}", not opaque`);
  }
  const chainHash = unsealed.material.toString("utf8");
  if (!CHAIN_HASH_RE.test(chainHash)) {
    throw new HtlcError("HTLC_E_BAD_INPUT", `sealed value under "${id}" is not a valid receipt chain hash`);
  }
  const meta = unsealed.meta;
  return {
    id,
    chainHash,
    swapId: typeof meta?.swapId === "string" ? meta.swapId : null,
    receipts: typeof meta?.receipts === "number" ? meta.receipts : null,
  };
}
