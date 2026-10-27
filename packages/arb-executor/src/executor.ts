/**
 * packages/arb-executor — the signing rail (deliverable 2)
 * =========================================================
 * Turns EXECUTE verdicts into SIGNED internal-market conversion intents,
 * routed through the repo's production signing seam:
 *
 *   army-keys.json (programmatic load) → sealed runtime vault (0600, outside
 *   git) → packages/hsm-runtime HsmSigner.signSteemFamily (role policy:
 *   funds ops require active authority) → SignReceipt {mode: SIGN-ONLY,
 *   broadcast: DISABLED} → hash-chained receipts file (state consumers).
 *
 * STRUCTURAL SIDE-EFFECT LAW (constitutional):
 *   • there is NO broadcast path in this package — the wire form of a signed
 *     intent is handed to the OWNER's broadcast lever, never to a chain.
 *     Custodial real-funds orders are the OWNER-ONLY lever; workers quote
 *     and sign, they never place real-funds orders.
 *   • the emitted op set is limit_order_create ONLY, fill_or_kill=true —
 *     internal-market market orders. allowTransfersOut=false is enforced by
 *     the policy gate AND by construction (no other op is ever built).
 *   • every act lands in a hash-chained receipts log (HashChainAudit) with
 *     digests only — never key material, never plaintext order secrets.
 */

import { createHash } from "node:crypto";

import { HashChainAudit } from "../../hsm-runtime/src/audit";
import { HsmSigner } from "../../hsm-runtime/src/sign";
import { HsmError } from "../../hsm-runtime/src/errors";
import type { SignReceipt } from "../../hsm-runtime/src/receipt";
import {
  transactionId,
  type SteemTransaction,
} from "../../chains/steem/src/transaction";
import type { LimitOrderCreateOperation } from "../../chains/steem/src/operations";
import { ByteReader, ByteWriter, packAsset, unpackAsset, type Asset } from "../../chains/steem/src/serializer";
import type { ArmedPolicy } from "./policy";
import type { ChainReader, RefBlock } from "./chain";
import type { ConversionDecision } from "./plan";

export { HsmError };

export interface SignedIntent {
  account: string;
  action: ConversionDecision["action"];
  orderId: number;
  txId: string;
  digest: string;
  receipt: SignReceipt;
  decision: ConversionDecision;
}

export interface ExecutorRun {
  at: string;
  mode: "SIGN-ONLY";
  broadcast: "DISABLED-owner-lever";
  policySource: string;
  decisions: ConversionDecision[];
  ledger: { ops: number; askSteemSatoshis: number; bidSbdSatoshis: number };
  intents: SignedIntent[];
  receiptsChain: { ok: boolean; entries: number };
  /** Honest gate for the ETH/SOL corridors (deliverable 3). */
  ethSol: { status: "KEYS-ABSENT-honest"; detail: string };
}

/** Deterministic per-cycle order ids: hash(account|action|cycleTs) % 2^31. */
export function deriveOrderId(account: string, action: string, cycleTs: number): number {
  const h = createHash("sha256").update(`${account}|${action}|${cycleTs}`).digest();
  return h.readUInt32BE(0) % 0x80000000;
}

/** Builds the internal-market market-order op (fill_or_kill at the book). */
export function buildLimitOrderOp(params: {
  account: string;
  orderId: number;
  sellSatoshis: number;
  sellSymbol: "STEEM" | "SBD";
  receiveSatoshis: number;
  receiveSymbol: "STEEM" | "SBD";
  expirationUnix: number;
}): LimitOrderCreateOperation {
  const toAsset = (sat: number, symbol: "STEEM" | "SBD"): Asset => {
    if (!Number.isInteger(sat) || sat <= 0) {
      throw new Error(`EXECUTOR_E_ASSET — ${symbol} amount must be a positive integer satoshi count, got ${sat}`);
    }
    const a: Asset = { amount: BigInt(sat), precision: 3, symbol };
    // wire-exactness proof at build time: pack → unpack → compare
    const w = new ByteWriter();
    packAsset(w, a);
    const back = unpackAsset(new ByteReader(w.toUint8Array()));
    if (back.amount !== a.amount || back.symbol !== symbol || back.precision !== 3) {
      throw new Error(`EXECUTOR_E_ASSET — wire round-trip mismatch for ${sat} ${symbol}`);
    }
    return a;
  };
  return {
    owner: params.account,
    orderid: params.orderId >>> 0,
    amount_to_sell: toAsset(params.sellSatoshis, params.sellSymbol),
    min_to_receive: toAsset(params.receiveSatoshis, params.receiveSymbol),
    fill_or_kill: true,
    expiration: params.expirationUnix,
  };
}

export interface ArbExecutorOptions {
  policy: ArmedPolicy;
  chain: ChainReader;
  signer: HsmSigner;
  /** keyId per account inside the sealed runtime vault. */
  keyIdFor(account: string): string;
  receiptsPath: string;
}

export class ArbExecutor {
  private readonly audit: HashChainAudit;

  constructor(private readonly options: ArbExecutorOptions) {
    this.audit = new HashChainAudit(options.receiptsPath);
  }

  /**
   * Runs one cycle: verify → plan → sign intents. NO broadcast exists here.
   * Signing happens ONLY for decisions whose verdict is EXECUTE under the
   * armed policy stack (thresholds + caps + reserve + RC + authority).
   */
  async runCycle(params: {
    decisions: ConversionDecision[];
    refBlock: RefBlock;
    now: number;
    cycleTs: number;
  }): Promise<ExecutorRun> {
    const { decisions, refBlock, now, cycleTs } = params;
    const intents: SignedIntent[] = [];

    for (const d of decisions) {
      if (d.verdict.kind !== "EXECUTE") continue;
      const keyId = this.options.keyIdFor(d.account);
      const expiration = Math.floor(now / 1000) + this.options.policy.thresholds.orderTtlSec;
      const orderId = deriveOrderId(d.account, d.action, cycleTs);

      // market order: cross the book immediately or die (fill_or_kill) —
      // min_to_receive is the MEASURED top-of-book price, zero invented
      // slippage: if the book moved, the order dies honestly.
      const op = buildLimitOrderOp({
        account: d.account,
        orderId,
        sellSatoshis: d.sellSatoshis,
        sellSymbol: d.action === "BUY_STEEM_WITH_SBD" ? "SBD" : "STEEM",
        receiveSatoshis: d.receiveSatoshis,
        receiveSymbol: d.action === "BUY_STEEM_WITH_SBD" ? "STEEM" : "SBD",
        expirationUnix: expiration,
      });

      const tx: SteemTransaction = {
        refBlockNum: refBlock.refBlockNum,
        refBlockPrefix: refBlock.refBlockPrefix,
        expiration,
        operations: [{ name: "limit_order_create", body: op }],
      };

      const receipt = await this.options.signer.signSteemFamily({
        chain: "steem",
        tx,
        keyId,
        now,
      });

      intents.push({
        account: d.account,
        action: d.action,
        orderId,
        txId: receipt.txId ?? transactionId(tx),
        digest: receipt.digest,
        receipt,
        decision: d,
      });

      this.audit.append("arb.intent", {
        account: d.account,
        action: d.action,
        orderId,
        txId: receipt.txId ?? "",
        digest: receipt.digest,
        wireSha256: receipt.wireSha256,
        spreadBps: Number.isFinite(d.spreadBps) ? d.spreadBps : null,
        thresholdBps: d.thresholdBps,
        mode: receipt.mode,
        broadcast: receipt.broadcast,
      });
    }

    const ledger = { ops: intents.length, askSteemSatoshis: 0, bidSbdSatoshis: 0 };
    for (const i of intents) {
      if (i.action === "BUY_STEEM_WITH_SBD") ledger.bidSbdSatoshis += i.decision.sellSatoshis;
      else ledger.askSteemSatoshis += i.decision.sellSatoshis;
    }

    return {
      at: new Date(now).toISOString(),
      mode: "SIGN-ONLY",
      broadcast: "DISABLED-owner-lever",
      policySource: this.options.policy.sourcePath,
      decisions,
      ledger,
      intents,
      receiptsChain: this.audit.verify(),
      ethSol: {
        status: "KEYS-ABSENT-honest",
        detail:
          "no ETH/SOL keys are vaulted for this rail (no custody file exists in this runtime) — the ETH/SOL execution lane builds and refuses honestly; quotes ride the read-only scanner",
      },
    };
  }
}
