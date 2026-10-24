/**
 * Saosmartwallet — full-lifecycle atomic-swap rehearsal harness (packages/swap, agent-9, wave W49)
 * ===================================================================================================
 * The DIRECTIVE §3 "production-grade" proof instrument: drives the REAL session
 * coordinator, the REAL witness layer and the REAL oracle-proven Graphene
 * packer through complete swap lifecycles — happy path (settle both legs) and
 * the two honest failure endings (responder absent → refund A at/after T1;
 * initiator absent → refund B at/after T2) — with a deterministic injected
 * clock, zero network, zero broadcast, and zero randomness.
 *
 * The product is a SELF-VERIFYING hash-chained report (SAOS-SWAP-REHEARSAL/1):
 * every step records the full wire block (account, jsonId, authority,
 * refBlockNum/refBlockPrefix, expiration, chainIdHex) plus the canonical
 * witness JSON, so an external verifier can rebuild each step's txid
 * byte-for-byte through `verifyRehearsalReport` — including the sha256
 * preimage↔hashlock binding re-proof inside the witness validator.
 *
 * Production-order honesty: the wire evidence for a lock is built BEFORE the
 * session commit (the txid a broadcaster would observe is the digest of that
 * evidence), and the leg's record expiry is asserted equal to the witnessed
 * expiry after commit — the rehearsal rehearses the real sequence
 * broadcast→commit, not a reordered fiction.
 *
 * Fail-closed laws:
 *   • REHEARSAL IDENTITY: party ids MUST start with "rehearsal:" — the harness
 *     refuses production-looking accounts (broadcast-confusion guard; the
 *     rehearsal signs nothing, it only builds and digests wire evidence).
 *   • POSTING-AUTHORITY ONLY: all rehearsal ops use the posting hand (the
 *     agent hand); active authority is a funds operation and stays out of
 *     rehearsal scope by construction.
 *   • INJECTED CLOCK: now0 must be a non-negative integer; every step and
 *     every transaction expiration derives from it — no wall-clock anywhere.
 *   • DERIVED SECRETS: the preimage and the per-leg chain ids derive
 *     deterministically from ASCII seeds through sha256 — never random, never
 *     literals, never production material.
 *   • PROBE HONESTY: each scenario deliberately attempts a law-violating
 *     action and records the refusal; if a law ever stops refusing, the
 *     rehearsal fails LOUDLY (RehearsalError) instead of passing silently.
 *   • HASH-CHAIN: report.hash = sha256(canonicalJson(report minus hash));
 *     prevHash links rehearsals into a chain (genesis = 64 zeros); a caller
 *     supplying prevHash must supply 64 lowercase hex chars.
 */

import {
  canonicalJson,
  sha256Bytes,
  verifyReceiptChain,
  type HtlcReceipt,
} from "./htlc";
import {
  createSwapSession,
  sessionInitiateLegA,
  sessionRespondLegB,
  sessionClaimLegB,
  sessionCounterClaimLegA,
  sessionRefundLeg,
  sessionPhase,
  verifySessionReceipts,
  type SwapPhase,
  type SwapSessionView,
} from "./session";
import {
  buildWitnessTransaction,
  canonicalWitnessJson,
  bytesToHex,
  hexToBytes,
  witnessTransactionDigest,
  HTLC_WITNESS_JSON_ID,
  type WitnessPayload,
} from "./witness";
import { OP_IDS } from "../../chains/steem/src/operations";

// ---------------------------------------------------------------------------
// Laws + constants
// ---------------------------------------------------------------------------

export class RehearsalError extends Error {}

/** The mandatory prefix for every rehearsal party id. */
export const REHEARSAL_ID_PREFIX = "rehearsal:";
/** Report schema identity. */
export const REHEARSAL_KIND = "SAOS-SWAP-REHEARSAL/1" as const;
/** The custom_json id used ONLY for refund reclamation witnesses in rehearsal. */
export const REHEARSAL_REFUND_JSON_ID = "saos.htlc.refund";

// Deterministic wire constants (rehearsal domain — documented, not secrets).
const REHEARSAL_T1_SECONDS = 3600;
const REHEARSAL_T2_SECONDS = 1800;
const REHEARSAL_TX_EXPIRATION_SECONDS = 3600;
const REHEARSAL_REF_BLOCK_NUM = 0x1234;
const REHEARSAL_REF_BLOCK_PREFIX = 0xbeefcafe;
const CLOCK_TICK_SECONDS = 1;
const GENESIS_PREV_HASH = "0".repeat(64);

export type RehearsalScenario = "happy-path" | "responder-absent" | "initiator-absent";
export type RehearsalVerdict = "SETTLED" | "REFUND-A" | "REFUND-B";

export type RehearsalStepName =
  | "initiate-legA"
  | "respond-legB"
  | "claim-legB"
  | "counter-claim-legA"
  | "refund-legA"
  | "refund-legB";

export interface RehearsalWire {
  account: string;
  jsonId: string;
  authority: "posting" | "active";
  refBlockNum: number;
  refBlockPrefix: number;
  expiration: number;
  /** 64 lowercase hex — the per-leg derived 32-byte chain id. */
  chainIdHex: string;
}

export interface RehearsalStepEvidence {
  step: RehearsalStepName;
  at: number;
  /** sha256(chainId ‖ serialized witness tx) — the REAL wire digest. */
  txid: string;
  /** The canonical witness JSON that was packed into the tx. */
  witnessJson: string;
  wire: RehearsalWire;
  /** The session phase AFTER this step. */
  phase: SwapPhase;
}

export interface RehearsalRefusal {
  refused: string;
  because: string;
}

export interface RehearsalReport {
  v: 1;
  kind: typeof REHEARSAL_KIND;
  swapId: string;
  scenario: RehearsalScenario;
  verdict: RehearsalVerdict;
  steps: RehearsalStepEvidence[];
  refusals: RehearsalRefusal[];
  /** The session's raw hash-chained receipts (events in order). */
  receipts: HtlcReceipt[];
  /** verifyReceiptChain outcome over `receipts`, carried for convenience. */
  receiptChain: { ok: boolean; brokenAt?: number; length: number };
  legs: {
    legA: { chain: string; asset: string; amount: string; timeoutSeconds: number };
    legB: { chain: string; asset: string; amount: string; timeoutSeconds: number };
  };
  prevHash: string;
  hash: string;
}

export interface RehearsalOptions {
  /** Injected genesis clock (non-negative integer unix seconds) — the ONLY time source. */
  now0: number;
  scenario?: RehearsalScenario;
  /** Defaults to `rehearsal-<scenario>-<now0>` (charset-safe for HTLC ids). */
  swapId?: string;
  /** Both parties MUST carry the rehearsal: prefix (broadcast-confusion guard). */
  initiator?: string;
  responder?: string;
  /** Chain id override for legA/legB (32 bytes each); defaults are derived per leg. */
  chainIdA?: Uint8Array;
  chainIdB?: Uint8Array;
  /** Deterministic preimage override (16..1024 bytes); default derives 32 bytes from the swapId seed. */
  preimage?: Uint8Array;
  /** Hash-chain link to a previous rehearsal report (64 lowercase hex) — defaults to genesis. */
  prevHash?: string;
}

// ---------------------------------------------------------------------------
// Derivation helpers (deterministic — sha256 over ASCII seeds, never literals)
// ---------------------------------------------------------------------------

function utf8(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "utf8"));
}

function deriveChainId(swapId: string, leg: "A" | "B"): Uint8Array {
  return sha256Bytes(utf8(`saos-swap-rehearsal:chain:${swapId}:${leg}`));
}

function derivePreimage(swapId: string): Uint8Array {
  return sha256Bytes(utf8(`saos-swap-rehearsal:preimage:${swapId}`));
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The single source of truth for the report hash (used by build AND verify). */
export function rehearsalReportHash(report: Omit<RehearsalReport, "hash"> | RehearsalReport): string {
  const core = { ...report } as Partial<RehearsalReport>;
  delete core.hash;
  return bytesToHex(sha256Bytes(utf8(canonicalJson(core))));
}

// ---------------------------------------------------------------------------
// Witness payload builders
// ---------------------------------------------------------------------------

function hashlockPayload(session: SwapSessionView, leg: "A" | "B", expiresAt: number): WitnessPayload {
  const spec = leg === "A" ? session.legA.spec : session.legB.spec;
  return {
    v: 1,
    swap: session.swapId,
    phase: "hashlock",
    leg,
    chain: spec.chain,
    hashlock: bytesToHex(session.hashlock),
    expiresAt,
  };
}

function revealPayload(session: SwapSessionView, leg: "A" | "B", preimage: Uint8Array, expiresAt: number): WitnessPayload {
  const spec = leg === "A" ? session.legA.spec : session.legB.spec;
  return {
    v: 1,
    swap: session.swapId,
    phase: "preimage",
    leg,
    chain: spec.chain,
    hashlock: bytesToHex(session.hashlock),
    preimage: bytesToHex(preimage),
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Wire evidence builder (REAL packer path, deterministic)
// ---------------------------------------------------------------------------

interface LegWireArgs {
  leg: "A" | "B";
  payload: WitnessPayload;
  account: string;
  jsonId: string;
  chainId: Uint8Array;
  now: number;
}

/** Builds a witness custom_json tx for a rehearsal step and returns its digest evidence. */
function witnessStepEvidence(args: LegWireArgs): { txid: string; witnessJson: string; wire: RehearsalWire } {
  const wire: RehearsalWire = {
    account: args.account,
    jsonId: args.jsonId,
    authority: "posting",
    refBlockNum: REHEARSAL_REF_BLOCK_NUM,
    refBlockPrefix: REHEARSAL_REF_BLOCK_PREFIX,
    expiration: args.now + REHEARSAL_TX_EXPIRATION_SECONDS,
    chainIdHex: bytesToHex(args.chainId),
  };
  const spec = {
    kind: "custom_json" as const,
    account: args.account,
    payload: args.payload,
    jsonId: args.jsonId,
    authority: "posting" as const,
  };
  const buildTx = () =>
    buildWitnessTransaction({
      refBlockNum: wire.refBlockNum,
      refBlockPrefix: wire.refBlockPrefix,
      expiration: wire.expiration,
      operations: [spec],
    });
  // Determinism pin: rebuilding the identical tx must digest identically.
  const d1 = bytesToHex(witnessTransactionDigest(buildTx(), args.chainId, OP_IDS));
  const d2 = bytesToHex(witnessTransactionDigest(buildTx(), args.chainId, OP_IDS));
  if (d1 !== d2) {
    throw new RehearsalError("packer determinism violated: identical witness tx digested differently");
  }
  return { txid: d1, witnessJson: canonicalWitnessJson(args.payload), wire };
}

// ---------------------------------------------------------------------------
// Probe helper (fail-closed honesty: a law that stops refusing fails the run)
// ---------------------------------------------------------------------------

function probe(refusals: RehearsalRefusal[], refused: string, attempt: () => void): void {
  try {
    attempt();
  } catch (err) {
    refusals.push({ refused, because: err instanceof Error ? err.message : String(err) });
    return;
  }
  throw new RehearsalError(`fail-closed probe did not refuse: ${refused}`);
}

function verdictFor(scenario: RehearsalScenario): RehearsalVerdict {
  if (scenario === "happy-path") return "SETTLED";
  if (scenario === "responder-absent") return "REFUND-A";
  return "REFUND-B";
}

interface LegSpecInput {
  chain: string;
  asset: string;
  amount: string;
}

const REHEARSAL_LEG_A: LegSpecInput = { chain: "steem", asset: "STEEM", amount: "1.000 STEEM" };
const REHEARSAL_LEG_B: LegSpecInput = { chain: "hive", asset: "HIVE", amount: "1.000 HIVE" };

function legSpec(spec: LegSpecInput, initiator: string, responder: string, timeoutSeconds: number) {
  return { chain: spec.chain, asset: spec.asset, amount: spec.amount, initiator, responder, timeoutSeconds };
}

// ---------------------------------------------------------------------------
// The rehearsal driver
// ---------------------------------------------------------------------------

/**
 * Runs one complete rehearsal and returns the self-verifying report.
 * Throws RehearsalError on any harness-law violation; underlying session /
 * witness / packer errors surface as their own fail-closed types.
 */
export function rehearseAtomicSwap(opts: RehearsalOptions): RehearsalReport {
  if (!Number.isInteger(opts.now0) || opts.now0 < 0) {
    throw new RehearsalError("now0 must be a non-negative integer unix timestamp (injected clock law)");
  }
  if (opts.prevHash !== undefined && (typeof opts.prevHash !== "string" || !HEX64.test(opts.prevHash))) {
    throw new RehearsalError("prevHash must be 64 lowercase hex chars (hash-chain link law)");
  }
  const scenario: RehearsalScenario = opts.scenario ?? "happy-path";
  const swapId = opts.swapId ?? `rehearsal-${scenario}-${opts.now0}`;
  if (typeof swapId !== "string" || swapId.length === 0) {
    throw new RehearsalError("swapId must be a non-empty string");
  }
  const initiator = opts.initiator ?? `${REHEARSAL_ID_PREFIX}alice`;
  const responder = opts.responder ?? `${REHEARSAL_ID_PREFIX}bob`;
  for (const [role, id] of [["initiator", initiator], ["responder", responder]] as const) {
    if (typeof id !== "string" || !id.startsWith(REHEARSAL_ID_PREFIX)) {
      throw new RehearsalError(`${role} id must carry the "${REHEARSAL_ID_PREFIX}" prefix — the rehearsal refuses production-looking accounts (broadcast-confusion guard)`);
    }
  }
  const preimage = opts.preimage ? new Uint8Array(opts.preimage) : derivePreimage(swapId);
  const chainIdA = opts.chainIdA ? new Uint8Array(opts.chainIdA) : deriveChainId(swapId, "A");
  const chainIdB = opts.chainIdB ? new Uint8Array(opts.chainIdB) : deriveChainId(swapId, "B");

  const refusals: RehearsalRefusal[] = [];

  // Probe 1 — the SAFETY law (every scenario): T1 <= T2 must refuse to exist.
  probe(refusals, "construct T1<=T2 session", () => {
    createSwapSession({
      swapId,
      legA: legSpec(REHEARSAL_LEG_A, initiator, responder, REHEARSAL_T2_SECONDS),
      legB: legSpec(REHEARSAL_LEG_B, responder, initiator, REHEARSAL_T2_SECONDS),
      preimage,
    });
  });

  const { view, preimage: sessionPreimage } = createSwapSession({
    swapId,
    legA: legSpec(REHEARSAL_LEG_A, initiator, responder, REHEARSAL_T1_SECONDS),
    legB: legSpec(REHEARSAL_LEG_B, responder, initiator, REHEARSAL_T2_SECONDS),
    preimage,
  });

  const steps: RehearsalStepEvidence[] = [];
  let clock = opts.now0;

  // Step 1 — initiator locks legA (T1). Wire evidence FIRST (broadcast order),
  // then the session commit with the observed digest as the txid, then the
  // expiry binding assert (witnessed expiry === record expiry).
  const expiryA = clock + REHEARSAL_T1_SECONDS;
  const evA = witnessStepEvidence({
    leg: "A",
    payload: hashlockPayload(view, "A", expiryA),
    account: initiator,
    jsonId: HTLC_WITNESS_JSON_ID,
    chainId: chainIdA,
    now: clock,
  });
  sessionInitiateLegA(view, { now: clock, txid: evA.txid });
  if (view.legA.record?.expiresAt !== expiryA) {
    throw new RehearsalError("expiry binding violated: legA record expiry diverges from the witnessed expiry");
  }
  steps.push({ step: "initiate-legA", at: clock, ...evA, phase: sessionPhase(view) });
  clock += CLOCK_TICK_SECONDS;

  if (scenario === "initiator-absent") {
    // Probe — claim legB before legB exists: sequencing law must refuse.
    probe(refusals, "claim legB in draft", () => {
      sessionClaimLegB(view, { now: clock, preimage: sessionPreimage });
    });
  }

  if (scenario !== "responder-absent") {
    // Step 2 — responder locks legB (T2 < T1) under the SAME hashlock.
    const expiryB = clock + REHEARSAL_T2_SECONDS;
    const evB = witnessStepEvidence({
      leg: "B",
      payload: hashlockPayload(view, "B", expiryB),
      account: responder,
      jsonId: HTLC_WITNESS_JSON_ID,
      chainId: chainIdB,
      now: clock,
    });
    sessionRespondLegB(view, { now: clock, txid: evB.txid });
    if (view.legB.record?.expiresAt !== expiryB) {
      throw new RehearsalError("expiry binding violated: legB record expiry diverges from the witnessed expiry");
    }
    steps.push({ step: "respond-legB", at: clock, ...evB, phase: sessionPhase(view) });
    clock += CLOCK_TICK_SECONDS;

    if (scenario === "happy-path") {
      // Probe — counter-claim before ANY public reveal: fail-closed on history.
      probe(refusals, "counter-claim before public reveal", () => {
        sessionCounterClaimLegA(view, { now: clock, preimage: sessionPreimage });
      });
      // Step 3 — initiator claims legB by REVEALING the preimage (before T2).
      const evRevealB = witnessStepEvidence({
        leg: "B",
        payload: revealPayload(view, "B", sessionPreimage, view.legB.record?.expiresAt ?? clock),
        account: initiator,
        jsonId: HTLC_WITNESS_JSON_ID,
        chainId: chainIdB,
        now: clock,
      });
      sessionClaimLegB(view, { now: clock, preimage: sessionPreimage });
      steps.push({ step: "claim-legB", at: clock, ...evRevealB, phase: sessionPhase(view) });
      clock += CLOCK_TICK_SECONDS;
      // Step 4 — responder counter-claims legA with the now-public preimage.
      const evRevealA = witnessStepEvidence({
        leg: "A",
        payload: revealPayload(view, "A", sessionPreimage, view.legA.record?.expiresAt ?? clock),
        account: responder,
        jsonId: HTLC_WITNESS_JSON_ID,
        chainId: chainIdA,
        now: clock,
      });
      sessionCounterClaimLegA(view, { now: clock, preimage: sessionPreimage });
      steps.push({ step: "counter-claim-legA", at: clock, ...evRevealA, phase: sessionPhase(view) });
      clock += CLOCK_TICK_SECONDS;
    } else {
      // initiator-absent — the initiator never claims; legB refunds at/after T2.
      const expiryB = view.legB.record?.expiresAt ?? clock;
      const refundAt = Math.max(clock, expiryB);
      const evRefundB = witnessStepEvidence({
        leg: "B",
        payload: hashlockPayload(view, "B", expiryB),
        account: responder,
        jsonId: REHEARSAL_REFUND_JSON_ID,
        chainId: chainIdB,
        now: refundAt,
      });
      sessionRefundLeg(view, { leg: "B", now: refundAt });
      steps.push({ step: "refund-legB", at: refundAt, ...evRefundB, phase: sessionPhase(view) });
      clock = refundAt + CLOCK_TICK_SECONDS;
    }
  } else {
    // responder-absent — the responder never locks; legA refunds at/after T1.
    const expiryARecord = view.legA.record?.expiresAt ?? clock;
    const refundAt = Math.max(clock, expiryARecord);
    const evRefundA = witnessStepEvidence({
      leg: "A",
      payload: hashlockPayload(view, "A", expiryARecord),
      account: initiator,
      jsonId: REHEARSAL_REFUND_JSON_ID,
      chainId: chainIdA,
      now: refundAt,
    });
    sessionRefundLeg(view, { leg: "A", now: refundAt });
    steps.push({ step: "refund-legA", at: refundAt, ...evRefundA, phase: sessionPhase(view) });
    clock = refundAt + CLOCK_TICK_SECONDS;
    // Probe — respond after refund: sequencing law must refuse.
    probe(refusals, "respond after legA refund", () => {
      sessionRespondLegB(view, { now: clock, txid: "rehearsal-probe" });
    });
  }

  const receiptChain = verifySessionReceipts(view);
  if (!receiptChain.ok) {
    throw new RehearsalError(`session receipt chain broke at ${receiptChain.brokenAt ?? "?"} — rehearsal refuses to report`);
  }

  const core: Omit<RehearsalReport, "hash"> = {
    v: 1,
    kind: REHEARSAL_KIND,
    swapId,
    scenario,
    verdict: verdictFor(scenario),
    steps,
    refusals,
    receipts: view.receipts,
    receiptChain,
    legs: {
      legA: { chain: view.legA.spec.chain, asset: view.legA.spec.asset, amount: view.legA.spec.amount, timeoutSeconds: view.legA.spec.timeoutSeconds },
      legB: { chain: view.legB.spec.chain, asset: view.legB.spec.asset, amount: view.legB.spec.amount, timeoutSeconds: view.legB.spec.timeoutSeconds },
    },
    prevHash: opts.prevHash ?? GENESIS_PREV_HASH,
  };
  return { ...core, hash: rehearsalReportHash(core) };
}

// ---------------------------------------------------------------------------
// External verification (the report is self-verifying evidence)
// ---------------------------------------------------------------------------

export interface RehearsalVerifyResult {
  ok: boolean;
  reason?: "format" | "prev-hash-format" | "receipt-chain" | "step-digest-mismatch" | "verdict-mismatch" | "hash-mismatch";
  stepIndex?: number;
  receipts: { ok: boolean; brokenAt?: number; length: number };
}

/**
 * Rebuilds every step's wire digest from the report's own evidence (real
 * packer path), re-verifies the session receipt chain, re-checks the verdict
 * against the recorded final phase, and re-computes the report hash.
 */
export function verifyRehearsalReport(report: RehearsalReport): RehearsalVerifyResult {
  if (!report || report.kind !== REHEARSAL_KIND || report.v !== 1) {
    return { ok: false, reason: "format", receipts: { ok: false, length: 0 } };
  }
  if (typeof report.prevHash !== "string" || !HEX64.test(report.prevHash)) {
    return { ok: false, reason: "prev-hash-format", receipts: { ok: false, length: 0 } };
  }
  const receipts = verifyReceiptChain(report.receipts ?? []);
  if (!receipts.ok) {
    return { ok: false, reason: "receipt-chain", receipts };
  }
  for (let i = 0; i < (report.steps ?? []).length; i++) {
    const step = report.steps[i];
    try {
      const payload = JSON.parse(step.witnessJson) as WitnessPayload;
      const tx = buildWitnessTransaction({
        refBlockNum: step.wire.refBlockNum,
        refBlockPrefix: step.wire.refBlockPrefix,
        expiration: step.wire.expiration,
        operations: [{ kind: "custom_json", account: step.wire.account, payload, jsonId: step.wire.jsonId, authority: step.wire.authority }],
      });
      const digest = bytesToHex(witnessTransactionDigest(tx, hexToBytes(step.wire.chainIdHex), OP_IDS));
      if (digest !== step.txid) {
        return { ok: false, reason: "step-digest-mismatch", stepIndex: i, receipts };
      }
    } catch {
      return { ok: false, reason: "step-digest-mismatch", stepIndex: i, receipts };
    }
  }
  const lastPhase = report.steps[report.steps.length - 1]?.phase;
  const expectedPhase = report.verdict === "SETTLED" ? "settled" : report.verdict === "REFUND-A" ? "legA-refunded" : "legB-refunded";
  if (lastPhase !== expectedPhase) {
    return { ok: false, reason: "verdict-mismatch", receipts };
  }
  if (rehearsalReportHash(report) !== report.hash) {
    return { ok: false, reason: "hash-mismatch", receipts };
  }
  return { ok: true, receipts };
}
