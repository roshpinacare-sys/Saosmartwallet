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
} from "../../chain-adapter.js";
import { PrivateKey, STEEM_ROLES, type SteemRole } from "../../../crypto/src/index.js";
import { SerializationError, parseAsset } from "./serializer.js";
import {
  STEEM_CHAIN_ID,
  SIGNATURE_SIZE,
  type SteemTransaction,
  appendSignatures,
  serializeTransaction,
  transactionDigest,
} from "./transaction.js";

// ---------------------------------------------------------------------------
// Account naming (observed chain rules; the chain remains the final arbiter)
// ---------------------------------------------------------------------------

const ACCOUNT_NAME_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export function validateAccountName(name: string): string {
  if (name.length < 3 || name.length > 16) {
    throw new SerializationError(`account name length must be 3..16: "${name}"`);
  }
  for (const segment of name.split(".")) {
    if (segment.length > 13) throw new SerializationError(`account segment too long: "${segment}"`);
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
    const res = await this.rpc<{
      rc_accounts: Array<{ rc_manabar: { current_mana: string; max_rc: string } }>;
    }>("rc_api.find_rc_accounts", { accounts: [name] });
    const mana = res.rc_accounts?.[0]?.rc_manabar;
    if (!mana) return null;
    const cur = Number(mana.current_mana);
    const max = Number(mana.max_rc);
    return {
      currentMana: mana.current_mana,
      maxRc: mana.max_rc,
      percent: max > 0 && Number.isFinite(cur) ? Math.round((cur / max) * 1000) / 10 : 0,
    };
  }

  // -- ChainAdapter: write paths --------------------------------------------

  /**
   * Builds a transfer transaction with fresh ref-block fields and expiration.
   * Only "transfer" is accepted in M0 — anything else fails closed.
   */
  async buildOperations(ops: Array<{ type: string; payload: Record<string, unknown> }>): Promise<UnsignedTx> {
    for (const op of ops) {
      if (op.type !== "transfer") {
        throw new SerializationError(`operation "${op.type}" is not supported in M0 (transfer only)`);
      }
      const p = op.payload as { from?: unknown; to?: unknown; amount?: unknown; memo?: unknown };
      if (typeof p.from !== "string" || typeof p.to !== "string") {
        throw new SerializationError("transfer requires string from/to");
      }
      validateAccountName(p.from);
      validateAccountName(p.to);
      if (typeof p.amount !== "string") throw new SerializationError("transfer amount must be an asset string like \"1.000 STEEM\"");
      parseAsset(p.amount); // validates symbol/precision/decimals — fail closed
      if (p.memo !== undefined && typeof p.memo !== "string") {
        throw new SerializationError("memo must be a string (encryption arrives with Memo Vault)");
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
   * Signs the transaction digest locally. Key material never leaves this call.
   * Role policy (fail closed): transfer requires an ACTIVE role signature;
   * posting keys are accepted only for posting-family ops (none in M0).
   */
  async sign(tx: UnsignedTx, keys: SigningKeys, roles: KeyRole[]): Promise<SignedTx> {
    if (!Array.isArray(roles) || roles.length === 0) throw new SerializationError("at least one signing role required");
    for (const role of roles) {
      if (!STEEM_ROLES.includes(role as SteemRole)) throw new SerializationError(`unknown role: ${role}`);
    }
    if (roles.includes("posting") && !roles.includes("active") && tx.operations.some((o) => o.type === "transfer")) {
      // Explicit policy: a posting key must never authorize a transfer.
      throw new SerializationError("policy violation: transfer cannot be signed with a posting key");
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
      operations: tx.operations.map((o) => ({
        name: "transfer" as const,
        body: {
          from: String((o.payload as { from: unknown }).from),
          to: String((o.payload as { to: unknown }).to),
          amount: parseAsset(String((o.payload as { amount: unknown }).amount)),
          memo: (o.payload as { memo?: unknown }).memo as string | undefined,
        },
      })),
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
      operations: tx.operations.map((o) => ["transfer", o.payload]),
      extensions: [],
      signatures: tx.signatures,
    };
    const res = await this.rpc<{ id?: string }>("condenser_api.broadcast_transaction", [txJson]);
    return { txId: res?.id ?? "", raw: { wireBytes: signedWire.length } };
  }
}
