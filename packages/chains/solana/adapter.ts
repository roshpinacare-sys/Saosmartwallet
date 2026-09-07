/**
 * Saosmartwallet — Solana chain adapter (M3)
 * ==========================================
 * Implements the frozen ChainAdapter seam (packages/chains/chain-adapter.ts)
 * for Solana mainnet-beta. Read paths talk JSON-RPC through @solana/web3.js
 * with endpoint failover; write paths build legacy Transaction messages and
 * sign locally with the vault-provided Ed25519 key.
 *
 * SEAM MAPPING (documented, deliberate):
 *   chainId        "solana:<cluster>" — Solana has no numeric chain id
 *   flavor         "other"
 *   getAccount     name = base58 pubkey
 *   balances       liquid = native SOL ("x SOL" — exact BigInt lamport math)
 *   getRcManabar   null — no RC system; fees are per-signature lamports
 *   roles          exactly ["active"] — single-key chain
 *   broadcast      gated behind allowBroadcast:true (M0 fail-closed pattern)
 *
 * SAFETY: broadcast() is hard-gated like every other adapter in this repo.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Message,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
  type TransactionSignature,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { base58 } from "@scure/base";

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
} from "../chain-adapter";
import { ASSOCIATED_TOKEN_PROGRAM_ID, MEMO_PROGRAM_ID, SOLANA_CLUSTER, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./programs/programs";
import { DEFAULT_COMMITMENT, type CommitmentLevel } from "./commitment";

// ---------------------------------------------------------------------------
// Address / key helpers (vault integration — Ed25519 → base58)
// ---------------------------------------------------------------------------

/** Validates + canonicalizes a base58 Solana address. */
export function toSolanaAddress(raw: string): string {
  const s = raw.trim();
  try {
    const pk = new PublicKey(s);
    return pk.toBase58();
  } catch {
    throw new Error(`invalid solana address: "${raw.slice(0, 50)}"`);
  }
}

/** Keypair from a vault Ed25519 seed (32B) or full secret key (64B). */
export function keypairFromSecretBytes(bytes: Uint8Array): Keypair {
  if (bytes.length === 32) return Keypair.fromSeed(new Uint8Array(bytes));
  if (bytes.length === 64) return Keypair.fromSecretKey(new Uint8Array(bytes));
  throw new Error("solana key must be 32-byte seed or 64-byte secret key");
}

/** Address derived from a 32-byte Ed25519 seed (vault keys). */
export function solanaAddressFromSeed(seed: Uint8Array): string {
  return keypairFromSecretBytes(seed).publicKey.toBase58();
}

// ---------------------------------------------------------------------------
// Amount helpers — exact BigInt lamport math, never floats
// ---------------------------------------------------------------------------

/** Formats lamports (bigint|string) into an exact "X.Y" SOL decimal string. */
export function formatLamports(lamports: string | bigint): string {
  const v = typeof lamports === "bigint" ? lamports : BigInt(lamports);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / BigInt(LAMPORTS_PER_SOL);
  const frac = (abs % BigInt(LAMPORTS_PER_SOL)).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

// ---------------------------------------------------------------------------
// Chain info (extended read model per M3 spec)
// ---------------------------------------------------------------------------

export interface SolanaChainInfo {
  network: "solana";
  cluster: typeof SOLANA_CLUSTER;
  /** Current slot (the "block height" of Solana). */
  blockHeight: number;
  absoluteSlot: number;
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  /** `solana-core` version string reported by the node. */
  nodeVersion: string | null;
  nativeToken: { symbol: string; decimals: number };
  via: string;
}

export interface SolanaAccountInfo {
  address: string;
  /** lamports, decimal string. */
  balance: string;
  /** Owner program of the account (System for plain wallets). */
  ownerProgram: string | null;
  executable: boolean;
  dataLength: number;
}

export interface SplTokenBalance {
  mint: string;
  /** Raw token units as decimal string (integer). */
  amount: string;
  decimals: number | null;
  formatted: string | null;
  tokenProgram: string;
}

export interface SolanaSignatureStatus {
  signature: string;
  slot: number | null;
  confirmations: number | null;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  err: unknown | null;
  finalized: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface SolanaAdapterOptions {
  /** Candidate JSON-RPC endpoints, tried in order. */
  rpcUrls: string[];
  commitment?: CommitmentLevel;
  /** Explicit broadcast opt-in — never enabled implicitly. */
  allowBroadcast?: boolean;
  requestTimeoutMs?: number;
}

/** Adapter op vocabulary. */
export type SolanaOperationType = "transfer" | "spl_transfer" | "memo";

export class SolanaAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly flavor: ChainFlavor = "other";
  readonly capabilities: ReadonlySet<AdapterCapability> = new Set<AdapterCapability>([
    "query-balances",
    "query-history",
    "sign-active",
    // "broadcast" is added ONLY when allowBroadcast is passed — fail closed.
  ]);
  private readonly broadcastAllowed: boolean;
  private readonly timeoutMs: number;
  private readonly commitment: CommitmentLevel;
  private readonly connections: Connection[] = [];
  private activeIndex = -1;

  constructor(private readonly opts: SolanaAdapterOptions) {
    if (!opts.rpcUrls.length) throw new Error("SolanaAdapter requires at least one rpcUrl");
    this.chainId = `solana:${SOLANA_CLUSTER}`;
    this.broadcastAllowed = opts.allowBroadcast === true;
    this.timeoutMs = opts.requestTimeoutMs ?? 10_000;
    this.commitment = opts.commitment ?? DEFAULT_COMMITMENT;
    for (const url of opts.rpcUrls) {
      this.connections.push(new Connection(url, this.commitment));
    }
  }

  // -- transport failover ---------------------------------------------------

  private async acquire(): Promise<{ connection: Connection; via: string }> {
    const order = [this.activeIndex, ...this.connections.map((_, i) => i).filter((i) => i !== this.activeIndex)]
      .filter((i) => i >= 0);
    for (const i of order) {
      try {
        const v = await Promise.race([
          this.connections[i].getVersion(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ping timeout")), Math.min(this.timeoutMs, 5_000))),
        ]);
        if (typeof v["solana-core"] !== "string") throw new Error("bad version response");
        this.activeIndex = i;
        return { connection: this.connections[i], via: this.opts.rpcUrls[i] };
      } catch {
        continue;
      }
    }
    throw new Error(`all solana RPC endpoints failed (${this.opts.rpcUrls.length} tried)`);
  }

  // -- ChainAdapter: read paths ---------------------------------------------

  async health(): Promise<ChainHealthReport> {
    const checkedAt = new Date().toISOString();
    try {
      const { connection } = await this.acquire();
      const slot = await Promise.race([
        connection.getSlot(this.commitment),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("health timeout")), this.timeoutMs)),
      ]);
      if (typeof slot !== "number") throw new Error("no slot");
      return {
        reachable: true,
        chainId: this.chainId,
        headBlock: slot,
        // Solana gives no head timestamp here; lag is not measurable from slot alone.
        lagSeconds: undefined,
        namespaces: ["solana"],
        checkedAt,
      };
    } catch {
      return { reachable: false, chainId: this.chainId, checkedAt };
    }
  }

  async getAccount(name: string): Promise<AccountSnapshot | null> {
    const address = toSolanaAddress(name);
    const { connection } = await this.acquire();
    const info = await Promise.race([
      connection.getAccountInfo(new PublicKey(address)),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error("RPC timeout")), this.timeoutMs)).catch(() => null),
    ]);
    if (info === null) {
      // On Solana a funded account always exists; null here means the RPC
      // answered and the address has never been funded — still an address.
      return { name: address, balances: { liquid: "0 SOL" } };
    }
    return { name: address, balances: { liquid: `${formatLamports(BigInt(info.lamports))} SOL` } };
  }

  async getBalances(name: string): Promise<TokenBalances> {
    const address = toSolanaAddress(name);
    const { connection } = await this.acquire();
    const balance = await Promise.race([
      connection.getBalance(new PublicKey(address), this.commitment),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("RPC timeout")), this.timeoutMs)),
    ]);
    return { liquid: `${formatLamports(BigInt(balance))} SOL` };
  }

  async getRcManabar(_name: string): Promise<RcManabar | null> {
    void _name;
    // Honest: Solana has no RC manabar; fees are per-signature lamports.
    return null;
  }

  // -- Extended read model ---------------------------------------------------

  async getChainInfo(): Promise<SolanaChainInfo> {
    const { connection, via } = await this.acquire();
    const [epochInfo, slot, version] = await Promise.all([
      connection.getEpochInfo(this.commitment),
      connection.getSlot(this.commitment),
      connection.getVersion().catch(() => null),
    ]);
    return {
      network: "solana",
      cluster: SOLANA_CLUSTER,
      blockHeight: slot,
      absoluteSlot: epochInfo.absoluteSlot,
      epoch: epochInfo.epoch,
      slotIndex: epochInfo.slotIndex,
      slotsInEpoch: epochInfo.slotsInEpoch,
      nodeVersion: version ? version["solana-core"] ?? null : null,
      nativeToken: { symbol: "SOL", decimals: 9 },
      via,
    };
  }

  async getAccountInfo(addressRaw: string): Promise<SolanaAccountInfo> {
    const address = toSolanaAddress(addressRaw);
    const { connection } = await this.acquire();
    const info = await connection.getAccountInfo(new PublicKey(address));
    if (!info) {
      return { address, balance: "0", ownerProgram: null, executable: false, dataLength: 0 };
    }
    return {
      address,
      balance: String(info.lamports),
      ownerProgram: info.owner.toBase58(),
      executable: info.executable,
      dataLength: info.data.length,
    };
  }

  /** All SPL token balances held by `ownerRaw` (both Token and Token-2022). */
  async getTokenBalances(ownerRaw: string): Promise<SplTokenBalance[]> {
    const owner = new PublicKey(toSolanaAddress(ownerRaw));
    const { connection } = await this.acquire();
    const out: SplTokenBalance[] = [];
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const res = await connection.getParsedTokenAccountsByOwner(owner, { programId: program });
      for (const { account } of res.value) {
        const parsed = account.data.parsed as {
          info?: {
            mint?: string;
            tokenAmount?: { amount?: string; decimals?: number; uiAmountString?: string };
          };
        } | undefined;
        const i = parsed?.info;
        if (!i?.mint || !i.tokenAmount?.amount) continue;
        const decimals = typeof i.tokenAmount.decimals === "number" ? i.tokenAmount.decimals : null;
        out.push({
          mint: i.mint,
          amount: i.tokenAmount.amount,
          decimals,
          formatted: i.tokenAmount.uiAmountString ?? null,
          tokenProgram: program.toBase58(),
        });
      }
    }
    // Deterministic order — mint address.
    return out.sort((a, b) => a.mint.localeCompare(b.mint));
  }

  async getSignatureStatus(signature: string): Promise<SolanaSignatureStatus> {
    const { connection } = await this.acquire();
    const res = await connection.getSignatureStatuses([signature as TransactionSignature], {
      searchTransactionHistory: true,
    });
    const v = res.value[0];
    if (!v) {
      return { signature, slot: null, confirmations: null, confirmationStatus: null, err: null, finalized: false };
    }
    return {
      signature,
      slot: v.slot ?? null,
      confirmations: typeof v.confirmations === "number" ? v.confirmations : null,
      confirmationStatus: v.confirmationStatus ?? null,
      err: v.err ?? null,
      finalized: v.confirmationStatus === "finalized",
    };
  }

  // -- ChainAdapter: write paths ---------------------------------------------

  static readonly OPERATION_TYPES: ReadonlySet<string> = new Set<SolanaOperationType>([
    "transfer",
    "spl_transfer",
    "memo",
  ]);

  /**
   * Builds a legacy Transaction: fresh blockhash + fee payer + validated
   * instructions. Fail-closed payload validation.
   */
  async buildOperations(ops: Array<{ type: string; payload: Record<string, unknown> }>): Promise<UnsignedTx> {
    if (ops.length === 0) throw new Error("solana buildOperations requires at least one op");
    const { connection } = await this.acquire();

    if (typeof ops[0].payload.from !== "string") {
      throw new Error("first solana op payload requires string from (becomes the fee payer)");
    }
    const feePayer = new PublicKey(toSolanaAddress(ops[0].payload.from));

    const built: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const instructions: TransactionInstruction[] = [];

    for (const op of ops) {
      if (op.type === "transfer") {
        const p = op.payload as { from?: unknown; to?: unknown; amountLamports?: unknown };
        if (typeof p.to !== "string") throw new Error("transfer requires string to");
        if (typeof p.amountLamports !== "string" || !/^\d+$/.test(p.amountLamports)) {
          throw new Error('transfer amountLamports must be an integer string like "1000000"');
        }
        const lamports = BigInt(p.amountLamports);
        if (lamports <= 0n) throw new Error("transfer amountLamports must be positive");
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: feePayer,
            toPubkey: new PublicKey(toSolanaAddress(p.to)),
            lamports,
          }),
        );
        built.push({ type: op.type, payload: op.payload });
      } else if (op.type === "spl_transfer") {
        const p = op.payload as { from?: unknown; to?: unknown; mint?: unknown; amountRaw?: unknown };
        if (typeof p.mint !== "string") throw new Error("spl_transfer requires string mint");
        if (typeof p.to !== "string") throw new Error("spl_transfer requires string to (owner of destination ATA)");
        if (typeof p.amountRaw !== "string" || !/^\d+$/.test(p.amountRaw)) {
          throw new Error("spl_transfer amountRaw must be an integer token-units string");
        }
        const amount = BigInt(p.amountRaw);
        if (amount <= 0n) throw new Error("spl_transfer amountRaw must be positive");
        const mint = new PublicKey(toSolanaAddress(p.mint));
        const destOwner = new PublicKey(toSolanaAddress(p.to));

        const sourceAta = await getAssociatedTokenAddress(mint, feePayer, true);
        const sourceInfo = await connection.getAccountInfo(sourceAta);
        if (!sourceInfo) {
          throw new Error(
            `source SPL account ${sourceAta.toBase58()} does not exist for mint ${mint.toBase58()} — fund/create it first (fail closed)`,
          );
        }
        const mintInfo = await connection.getParsedAccountInfo(mint);
        const parsedMint = (mintInfo.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed;
        const decimals = parsedMint?.info?.decimals;
        if (typeof decimals !== "number") {
          throw new Error(`could not read decimals for mint ${mint.toBase58()}`);
        }
        const destAta = await getAssociatedTokenAddress(mint, destOwner, true);
        // Idempotent create — no-op when the ATA exists, pays rent otherwise.
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            feePayer,
            destAta,
            destOwner,
            mint,
          ),
        );
        instructions.push(
          createTransferCheckedInstruction(
            sourceAta,
            mint,
            destAta,
            feePayer,
            amount,
            decimals,
          ),
        );
        built.push({ type: op.type, payload: op.payload });
      } else if (op.type === "memo") {
        const p = op.payload as { text?: unknown };
        if (typeof p.text !== "string" || p.text.length === 0 || Buffer.byteLength(p.text, "utf8") > 566) {
          throw new Error("memo requires non-empty text ≤566 bytes (Memo program limit)");
        }
        instructions.push({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(p.text, "utf8"),
        });
        built.push({ type: op.type, payload: op.payload });
      } else {
        throw new Error(`operation "${op.type}" is not supported (transfer, spl_transfer, memo)`);
      }
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(this.commitment);
    const tx = new Transaction({ feePayer, recentBlockhash: blockhash }).add(...instructions);

    return {
      chainId: this.chainId,
      operations: built,
      metadata: {
        recentBlockhash: blockhash,
        lastValidBlockHeight,
        feePayer: feePayer.toBase58(),
        instructionCount: instructions.length,
        // The canonical pre-signature MESSAGE bytes (wire hex) — exactly what
        // Ed25519 signs. Renamed honestly: not a digest, the message itself.
        messageHex: Buffer.from(tx.serializeMessage()).toString("hex"),
      },
    };
  }

  /**
   * Signs the message locally. Key material never leaves this call.
   * Role policy (fail closed): exactly ["active"] — the single-key model.
   *
   * Pipeline: Message.from(messageHex) → Transaction.populate → tx.sign(kp)
   * → tx.serialize() (official signing path; the signature covers the exact
   * message bytes produced by buildOperations — no state, no trust).
   */
  async sign(tx: UnsignedTx, keys: SigningKeys, roles: KeyRole[]): Promise<SignedTx> {
    if (!Array.isArray(roles) || roles.length !== 1 || roles[0] !== "active") {
      throw new Error('solana signing requires exactly roles ["active"]');
    }
    const key = keys.byRole.active;
    if (key === undefined) throw new Error('no key provided for role "active"');

    const meta = (tx.metadata ?? {}) as {
      recentBlockhash?: string;
      feePayer?: string;
      messageHex?: string;
    };
    if (typeof meta.recentBlockhash !== "string" || typeof meta.feePayer !== "string" || typeof meta.messageHex !== "string") {
      throw new Error("UnsignedTx.metadata must carry recentBlockhash/feePayer/messageHex (use buildOperations)");
    }

    let keypair: Keypair;
    if (key instanceof Uint8Array) {
      keypair = keypairFromSecretBytes(key);
    } else if (key instanceof Keypair) {
      keypair = key;
    } else if (typeof key === "object" && key !== null && (key as { bytes?: unknown }).bytes instanceof Uint8Array) {
      // Vault PrivateKey handle (duck-typed .bytes): the same 32 secp256k1
      // scalar bytes interpreted as an Ed25519 SEED (M3 unified key scheme).
      keypair = keypairFromSecretBytes((key as { bytes: Uint8Array }).bytes);
    } else if (typeof key === "string") {
      const bytes = base58.decode(key.trim());
      keypair = keypairFromSecretBytes(bytes);
    } else {
      throw new Error("keys.byRole.active must be Uint8Array(32|64), Keypair, vault PrivateKey or base58 secret key");
    }
    if (keypair.publicKey.toBase58() !== meta.feePayer) {
      throw new Error(
        `key signer ${keypair.publicKey.toBase58()} != feePayer ${meta.feePayer} — rebuild with buildOperations`,
      );
    }

    // Re-parse the exact wire message produced by buildOperations.
    let transaction: Transaction;
    try {
      const message = Message.from(Buffer.from(meta.messageHex, "hex"));
      transaction = Transaction.populate(message, []); // empty signatures; .sign() fills slot #0
    } catch (err) {
      throw new Error(`messageHex does not parse as a Solana message: ${err instanceof Error ? err.message : "unknown"}`);
    }

    // Fail closed: the key must be the required (fee-payer) signer of this
    // message — Transaction.sign() would also throw, but we say WHY first.
    if (keypair.publicKey.toBase58() !== meta.feePayer) {
      throw new Error("signing key is not the required signer of this message");
    }

    transaction.sign(keypair);
    const rawWire = transaction.serialize(); // full wire: sigcount ‖ sig ‖ message

    const signedMeta: Record<string, unknown> = {
      ...meta,
      rawTransaction: Buffer.from(rawWire).toString("base64"),
      signer: keypair.publicKey.toBase58(),
    };
    return {
      ...tx,
      metadata: signedMeta,
      signatures: [base58.encode(transaction.signatures[0]!.signature ?? new Uint8Array(64))],
      rolesUsed: ["active"],
    };
  }

  async broadcast(tx: SignedTx): Promise<BroadcastResult> {
    if (!this.broadcastAllowed) {
      throw new Error(
        "broadcast disabled: construct SolanaAdapter with allowBroadcast:true to enable (M0 gate)",
      );
    }
    const raw = (tx.metadata as { rawTransaction?: Uint8Array | string } | undefined)?.rawTransaction;
    if (!raw) throw new Error("broadcast requires sign() metadata (rawTransaction)");
    const { connection } = await this.acquire();
    const bytes = typeof raw === "string"
      ? new Uint8Array(Buffer.from(raw, "base64"))
      : new Uint8Array(raw);
    const sig = await connection.sendRawTransaction(bytes, { skipPreflight: false });
    return { txId: sig, raw: { signature: sig } };
  }
}
