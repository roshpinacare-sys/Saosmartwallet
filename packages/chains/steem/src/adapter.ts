/**
 * Saosmartwallet — Steem chain adapter (M0)
 * =========================================
 * Implements the frozen ChainAdapter seam (packages/chains/chain-adapter.ts)
 * for the Steem protocol. Read paths talk JSON-RPC 2.0 (appbase/condenser);
 * write paths sign locally with packages/crypto and serialize with the
 * evidence-validated binary engine.
 *
 * SAFETY: broadcast() is hard-gated — the constructor defaults to
 * allowBroadcast:false and the method fails closed without it. An M0 wallet
 * must be physically unable to move funds by accident.
 */

import {
  type AdapterCapability,
  type AccountSnapshot,
  type ChainAdapter,
  type ChainFlavor,
  type ChainHealthReport,
  type KeyRole,
  type RcManabar,
  type SignedTx,
  type SigningKeys,
  type TokenBalances,
  type UnsignedTx,
  type BroadcastResult,
} from "../../chain-adapter";
import { PrivateKey, STEEM_ROLES, type SteemRole } from "../../../crypto/src/index";
import { SerializationError, parseAsset } from "./serializer";
import type { LimitOrderCancelOperation, LimitOrderCreateOperation, SteemOperationName } from "./operations";
import {
  STEEM_CHAIN_ID,
  SIGNATURE_SIZE,
  type SteemTransaction,
  appendSignatures,
  serializeTransaction,
  transactionDigest,
} from "./transaction";

// ---------------------------------------------------------------------------
// Account naming (observed chain rules; the chain remains the final arbiter)
// ---------------------------------------------------------------------------

const ACCOUNT_NAME_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export function validateAccountName(name: string): string {
  if (name.length < 3 || name.length > 16) {
    throw new SerializationError(`account name length must be 3..16: "${name}"`);
  }
  // steemd is_valid_account_name: total length 3..16; each dot-segment must be
  // ≥ 3 chars, start [a-z], middle [a-z0-9-], end [a-z0-9]. There is NO
  // per-segment maximum beyond the 16-char total — verified against mainnet:
  // "steem-venezuela" (15-char single segment) is a live account since 2020-08-08.
  for (const segment of name.split(".")) {
    if (segment.length < 3) throw new SerializationError(`account segment too short: "${segment}"`);
    if (!/^[a-z][a-z0-9-]*$/.test(segment) || !/[a-z0-9]$/.test(segment)) {
      throw new SerializationError(`invalid account name: "${name}"`);
    }
  }
  if (!ACCOUNT_NAME_RE.test(name)) throw new SerializationError(`invalid account name: "${name}"`);
  return name;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface SteemAdapterOptions {
  /** JSON-RPC endpoint, e.g. https://api.steemit.com (D1 dev endpoint). */
  rpcUrl: string;
  /** 32-byte chain id. Default: Steem mainnet (32 zero bytes). Forks MUST override. */
  chainId?: Uint8Array;
  /** Public key prefix. Default "STM" (mainnet); testnet forks use "TST". */
  addressPrefix?: string;
  /** Explicit broadcast opt-in — never enabled implicitly. */
  allowBroadcast?: boolean;
  requestTimeoutMs?: number;
}

interface RpcAccountRaw {
  name: string;
  created?: string;
  balance?: string;
  sbd_balance?: string;
  vesting_shares?: string;
  savings_balance?: string;
  savings_sbd_balance?: string;
  active?: { key_auths?: Array<[string, number]> };
  posting?: { key_auths?: Array<[string, number]> };
  owner?: { key_auths?: Array<[string, number]> };
  memo_key?: string;
}

export class SteemAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly flavor: ChainFlavor = "steem-family";
  readonly capabilities: ReadonlySet<AdapterCapability> = new Set<AdapterCapability>([
    "query-balances",
    "query-rc",
    "sign-active",
    "sign-posting",
    // "broadcast" is added ONLY when allowBroadcast is passed — fail closed.
  ]);
  private readonly broadcastAllowed: boolean;
  private readonly chainIdBytes: Uint8Array;
  private readonly addressPrefix: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: SteemAdapterOptions) {
    this.chainIdBytes = opts.chainId ?? STEEM_CHAIN_ID;
    if (this.chainIdBytes.length !== 32) throw new SerializationError("chainId must be 32 bytes");
    this.chainId = Buffer.from(this.chainIdBytes).toString("hex");
    this.addressPrefix = opts.addressPrefix ?? "STM";
    this.broadcastAllowed = opts.allowBroadcast === true;
    this.timeoutMs = opts.requestTimeoutMs ?? 10_000;
    if (this.broadcastAllowed) {
      (this.capabilities as Set<AdapterCapability>).add("broadcast");
    }
  }

  // -- transport -----------------------------------------------------------

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(this.opts.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(`RPC error: ${body.error.message ?? "unknown"}`);
    return body.result as T;
  }

  // -- ChainAdapter: read paths ---------------------------------------------

  async health(): Promise<ChainHealthReport> {
    const checkedAt = new Date().toISOString();
    try {
      const dgp = await this.rpc<{ head_block_number: number; time?: string }>(
        "condenser_api.get_dynamic_global_properties",
        [],
      );
      const headMs = dgp.time ? Date.parse(dgp.time.endsWith("Z") ? dgp.time : `${dgp.time}Z`) : NaN;
      return {
        reachable: true,
        chainId: this.chainId,
        headBlock: dgp.head_block_number,
        lagSeconds: Number.isFinite(headMs) ? Math.round((Date.now() - headMs) / 1000) : undefined,
        checkedAt,
      };
    } catch (err) {
      return {
        reachable: false,
        chainId: this.chainId,
        checkedAt,
      };
    }
  }

  async getAccount(name: string): Promise<AccountSnapshot | null> {
    validateAccountName(name);
    const list = await this.rpc<RpcAccountRaw[]>("condenser_api.get_accounts", [[name]]);
    const raw = list?.[0];
    if (!raw) return null;
    return {
      name: raw.name,
      created: raw.created,
      balances: this.mapBalances(raw),
    };
  }

  async getBalances(name: string): Promise<TokenBalances> {
    validateAccountName(name);
    const list = await this.rpc<RpcAccountRaw[]>("condenser_api.get_accounts", [[name]]);
    const raw = list?.[0];
    if (!raw) throw new Error(`account not found: ${name}`);
    return this.mapBalances(raw);
  }

  private mapBalances(raw: RpcAccountRaw): TokenBalances {
    // Raw chain strings are passed through untouched — no float math on chain assets.
    return {
      liquid: raw.balance ?? "0.000 STEEM",
      vestingShares: raw.vesting_shares ?? "0.000000 VESTS",
      debt: raw.sbd_balance ?? "0.000 SBD",
    };
  }

  async getRcManabar(name: string): Promise<RcManabar | null> {
    validateAccountName(name);
    // Wire shape (verified live 2026-09-07): max_rc sits on the ACCOUNT level,
    // current_mana inside rc_manabar. (M0 read max_rc from rc_manabar — a
    // latent bug surfaced by the M1 dashboard: percent always computed 0.)
    const res = await this.rpc<{
      rc_accounts: Array<{ rc_manabar?: { current_mana: string }; max_rc?: string }>;
    }>("rc_api.find_rc_accounts", { accounts: [name] });
    const acc = res.rc_accounts?.[0];
    const mana = acc?.rc_manabar;
    if (!mana) return null;
    const cur = Number(mana.current_mana);
    const max = Number(acc?.max_rc ?? "0");
    return {
      currentMana: mana.current_mana,
      maxRc: acc?.max_rc ?? "0",
      percent: max > 0 && Number.isFinite(cur) ? Math.round((cur / max) * 1000) / 10 : 0,
    };
  }

  // -- ChainAdapter: write paths --------------------------------------------

  /** Ops that move/commit funds or mutate open orders — always require an ACTIVE (or owner) signature. A cancel refunds the caller, but it still mutates order state, so the chain demands active/owner authority and we mirror that. */
  private static readonly FUNDS_OPS: ReadonlySet<string> = new Set(["transfer", "limit_order_create", "limit_order_cancel"]);

  /**
   * Validates and stamps a limit_order_create payload (M1 DEX). Asset strings
   * are parsed fail-closed; only STEEM/SBD are accepted for internal-market
   * orders, and the two sides must be opposite symbols.
   */
  private validateLimitOrderPayload(p: Record<string, unknown>): void {
    if (typeof p.owner !== "string") throw new SerializationError("limit_order_create requires string owner");
    validateAccountName(p.owner);
    if (!Number.isInteger(p.orderid) || (p.orderid as number) < 0 || (p.orderid as number) > 0xffffffff) {
      throw new SerializationError("limit_order_create orderid must be an integer in [0, 4294967295]");
    }
    if (typeof p.amount_to_sell !== "string" || typeof p.min_to_receive !== "string") {
      throw new SerializationError('limit_order_create requires asset strings like "1.000 STEEM"');
    }
    const sell = parseAsset(p.amount_to_sell);
    const receive = parseAsset(p.min_to_receive);
    if (sell.amount <= 0n) throw new SerializationError("amount_to_sell must be positive");
    if (receive.amount < 0n) throw new SerializationError("min_to_receive must be non-negative");
    const bookSymbols = new Set(["STEEM", "SBD"]);
    if (!bookSymbols.has(sell.symbol) || !bookSymbols.has(receive.symbol)) {
      throw new SerializationError(`internal-market orders trade STEEM/SBD only (got ${sell.symbol}/${receive.symbol})`);
    }
    if (sell.symbol === receive.symbol) {
      throw new SerializationError("amount_to_sell and min_to_receive must be opposite symbols");
    }
    if (typeof p.fill_or_kill !== "boolean") {
      throw new SerializationError("limit_order_create fill_or_kill must be boolean");
    }
    if (!Number.isInteger(p.expiration)) {
      throw new SerializationError("limit_order_create expiration must be unix seconds (integer)");
    }
    const exp = p.expiration as number;
    const now = Math.floor(Date.now() / 1000);
    // Client-side sanity guard (the chain remains the final arbiter): an order
    // must outlive the signing window but not linger absurdly.
    if (exp <= now + 60) throw new SerializationError("order expiration must be at least 60s in the future");
    if (exp > now + 7 * 86400) throw new SerializationError("order expiration capped at 7 days (client guard)");
  }

  /**
   * Validates a limit_order_cancel payload (M3 DEX lifecycle). Owner must be a
   * syntactically-valid account; orderid the uint32 from the original create.
   */
  private validateLimitOrderCancelPayload(p: Record<string, unknown>): void {
    if (typeof p.owner !== "string") throw new SerializationError("limit_order_cancel requires string owner");
    validateAccountName(p.owner);
    if (!Number.isInteger(p.orderid) || (p.orderid as number) < 0 || (p.orderid as number) > 0xffffffff) {
      throw new SerializationError("limit_order_cancel orderid must be an integer in [0, 4294967295]");
    }
  }

  /**
   * Builds an unsigned transaction with fresh ref-block fields and expiration.
   * M0: transfer. M1: + limit_order_create (the DEX op). M3+: limit_order_cancel
   * (DEX lifecycle closure). Anything else fails closed.
   */
  async buildOperations(ops: Array<{ type: string; payload: Record<string, unknown> }>): Promise<UnsignedTx> {
    for (const op of ops) {
      if (op.type === "transfer") {
        const p = op.payload as { from?: unknown; to?: unknown; amount?: unknown; memo?: unknown };
        if (typeof p.from !== "string" || typeof p.to !== "string") {
          throw new SerializationError("transfer requires string from/to");
        }
        validateAccountName(p.from);
        validateAccountName(p.to);
        if (typeof p.amount !== "string") throw new SerializationError('transfer amount must be an asset string like "1.000 STEEM"');
        parseAsset(p.amount); // validates symbol/precision/decimals — fail closed
        if (p.memo !== undefined && typeof p.memo !== "string") {
          throw new SerializationError("memo must be a string (encryption arrives with Memo Vault)");
        }
      } else if (op.type === "limit_order_create") {
        this.validateLimitOrderPayload(op.payload);
      } else if (op.type === "limit_order_cancel") {
        this.validateLimitOrderCancelPayload(op.payload);
      } else {
        throw new SerializationError(
          `operation "${op.type}" is not supported (transfer, limit_order_create, limit_order_cancel)`,
        );
      }
    }
    const dgp = await this.rpc<{ head_block_number: number; head_block_id: string }>(
      "condenser_api.get_dynamic_global_properties",
      [],
    );
    // Graphene convention: ref_block_num = head & 0xFFFF; prefix = LE u32 of head_block_id bytes [4:8].
    const refBlockNum = dgp.head_block_number & 0xffff;
    const idBytes = Buffer.from(dgp.head_block_id, "hex");
    if (idBytes.length < 8) throw new SerializationError("head_block_id shorter than 8 bytes");
    const refBlockPrefix = idBytes.readUInt32LE(4);
    const expiration = Math.floor(Date.now() / 1000) + 60; // 60s window; well under the 1h chain max
    return {
      chainId: this.chainId,
      operations: ops.map((o) => ({ type: o.type, payload: o.payload })),
      metadata: { refBlockNum, refBlockPrefix, expiration },
    };
  }

  /**
   * Maps an adapter-level operation payload to its wire-exact body.
   * Asset strings are re-parsed here — the payload crosses the API boundary
   * as strings and must never be trusted.
   */
  private toWireOperation(op: { type: string; payload: Record<string, unknown> }): {
    name: SteemOperationName;
    body: SteemTransaction["operations"][number]["body"];
  } {
    if (op.type === "transfer") {
      const p = op.payload as { from: unknown; to: unknown; amount: unknown; memo?: unknown };
      return {
        name: "transfer",
        body: {
          from: String(p.from),
          to: String(p.to),
          amount: parseAsset(String(p.amount)),
          memo: p.memo as string | undefined,
        },
      };
    }
    if (op.type === "limit_order_create") {
      this.validateLimitOrderPayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as {
        owner: string;
        orderid: number;
        amount_to_sell: string;
        min_to_receive: string;
        fill_or_kill: boolean;
        expiration: number;
      };
      const body: LimitOrderCreateOperation = {
        owner: p.owner,
        orderid: p.orderid,
        amount_to_sell: parseAsset(p.amount_to_sell),
        min_to_receive: parseAsset(p.min_to_receive),
        fill_or_kill: p.fill_or_kill,
        expiration: p.expiration,
      };
      return { name: "limit_order_create", body };
    }
    if (op.type === "limit_order_cancel") {
      this.validateLimitOrderCancelPayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as { owner: string; orderid: number };
      const body: LimitOrderCancelOperation = { owner: p.owner, orderid: p.orderid };
      return { name: "limit_order_cancel", body };
    }
    throw new SerializationError(`operation "${op.type}" cannot be signed (unsupported)`);
  }

  /**
   * Signs the transaction digest locally. Key material never leaves this call.
   * Role policy (fail closed): funds-moving ops (transfer, limit_order_create)
   * require an ACTIVE role signature; posting keys are accepted only for
   * posting-family ops (none in M0/M1).
   */
  async sign(tx: UnsignedTx, keys: SigningKeys, roles: KeyRole[]): Promise<SignedTx> {
    if (!Array.isArray(roles) || roles.length === 0) throw new SerializationError("at least one signing role required");
    for (const role of roles) {
      if (!STEEM_ROLES.includes(role as SteemRole)) throw new SerializationError(`unknown role: ${role}`);
    }
    const touchesFunds = tx.operations.some((o) => SteemAdapter.FUNDS_OPS.has(o.type));
    if (roles.includes("posting") && !roles.includes("active") && touchesFunds) {
      // Explicit policy: a posting key must never authorize a funds-moving op.
      throw new SerializationError("policy violation: funds operations cannot be signed with a posting key");
    }
    const { refBlockNum, refBlockPrefix, expiration } = (tx.metadata ?? {}) as {
      refBlockNum?: number;
      refBlockPrefix?: number;
      expiration?: number;
    };
    if (typeof refBlockNum !== "number" || typeof refBlockPrefix !== "number" || typeof expiration !== "number") {
      throw new SerializationError("UnsignedTx.metadata must carry refBlockNum/refBlockPrefix/expiration (use buildOperations)");
    }
    const steemTx: SteemTransaction = {
      refBlockNum,
      refBlockPrefix,
      expiration,
      operations: tx.operations.map((o) => this.toWireOperation(o)),
    };

    const digest = transactionDigest(steemTx, this.chainIdBytes);
    const signatures: string[] = [];
    for (const role of roles) {
      const key = keys.byRole[role];
      if (key === undefined) throw new SerializationError(`no key provided for role "${role}"`);
      const priv = key instanceof PrivateKey ? key : PrivateKey.fromWif(String(key));
      // Digest only — signatures cover sha256(chainId ‖ tx) and nothing else.
      const sig = priv.signRecoverable(digest);
      if (sig.length !== SIGNATURE_SIZE) throw new SerializationError("internal: bad signature length");
      signatures.push(Buffer.from(sig).toString("hex"));
    }
    return {
      ...tx,
      signatures,
      rolesUsed: [...roles],
      metadata: { ...tx.metadata, digestHex: Buffer.from(digest).toString("hex"), serializedHex: Buffer.from(serializeTransaction(steemTx)).toString("hex") },
    };
  }

  async broadcast(tx: SignedTx): Promise<BroadcastResult> {
    if (!this.broadcastAllowed) {
      // Fail closed — M0 wallets never move funds; flip via constructor only.
      throw new SerializationError(
        "broadcast disabled: construct SteemAdapter with allowBroadcast:true to enable (M0 gate)",
      );
    }
    const digestHex = (tx.metadata as { digestHex?: string } | undefined)?.digestHex;
    const serializedHex = (tx.metadata as { serializedHex?: string } | undefined)?.serializedHex;
    if (typeof serializedHex !== "string") {
      throw new SerializationError("broadcast requires sign() metadata (serializedHex)");
    }
    void digestHex;
    const signedWire = appendSignatures(new Uint8Array(Buffer.from(serializedHex, "hex")), tx.signatures);
    const txJson = {
      ref_block_num: (tx.metadata as { refBlockNum: number }).refBlockNum,
      ref_block_prefix: (tx.metadata as { refBlockPrefix: number }).refBlockPrefix,
      expiration: new Date(
        ((tx.metadata as { expiration: number }).expiration) * 1000,
      ).toISOString().slice(0, 19),
      operations: tx.operations.map((o) => [o.type, o.payload] as const),
      extensions: [],
      signatures: tx.signatures,
    };
    const res = await this.rpc<{ id?: string }>("condenser_api.broadcast_transaction", [txJson]);
    return { txId: res?.id ?? "", raw: { wireBytes: signedWire.length } };
  }
}
