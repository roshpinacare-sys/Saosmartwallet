/**
 * Saosmartwallet — Ethereum chain adapter (M3)
 * ============================================
 * Implements the frozen ChainAdapter seam (packages/chains/chain-adapter.ts)
 * for Ethereum mainnet (EIP-1559 era). Read paths talk ethers v6 against
 * public RPC endpoints with failover; write paths sign locally with ethers
 * Wallet over the vault-provided secp256k1 key (Ethereum shares the curve
 * with Steem — same key bytes, different address encoding).
 *
 * SEAM MAPPING (documented, deliberate):
 *   chainId        "eip155:<number>" (CAIP-2)
 *   flavor         "other"
 *   getAccount     name = 0x address (any case, canonicalized EIP-55)
 *   balances       liquid = native ETH ("x ETH"); vesting/debt undefined
 *   getRcManabar   null — Ethereum has no Resource Credit system (gas instead)
 *   roles          exactly ["active"] — single-key chain; active = funds authority
 *   broadcast      gated behind allowBroadcast:true (M0 fail-closed pattern)
 *
 * SAFETY: broadcast() is hard-gated like SteemAdapter — an adapter constructed
 * without allowBroadcast is physically unable to move funds.
 */

import { ethers } from "ethers";

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
import { ERC20_READ_ABI } from "./abi/erc20";
import { DEFAULT_GAS_LIMITS, estimateEip1559Fees, type FeeSummary, type FeeSpeed, toFeeSummary } from "./gas";
import { isEip1559TxFields, metadataToTxFields, type EvmOperationType, type EvmTransactionReceiptSummary, type EvmTxMetadata } from "./transactions";

// ---------------------------------------------------------------------------
// Address helpers (vault integration — secp256k1 → EIP-55)
// ---------------------------------------------------------------------------

/** EIP-55 canonical address from any-case hex input; throws on garbage. */
export function toEvmAddress(raw: string): string {
  const s = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) {
    throw new Error(`invalid ethereum address: "${raw.slice(0, 42)}"`);
  }
  // getAddress on an all-lowercase string always succeeds (it checksums);
  // this accepts mixed-case input without rejecting valid lowercase hex.
  return ethers.getAddress(s.toLowerCase());
}

/** EIP-55 address derived from a 32-byte secp256k1 private key (vault keys). */
export function ethAddressFromPrivateKey(privBytes: Uint8Array): string {
  if (privBytes.length !== 32) throw new Error("private key must be 32 bytes");
  const pubUncompressed = ethers.SigningKey.computePublicKey(new Uint8Array(privBytes), false);
  return toEvmAddress(ethers.computeAddress(pubUncompressed));
}

// ---------------------------------------------------------------------------
// Chain info (extended read model per M3 spec)
// ---------------------------------------------------------------------------

export interface EvmChainInfo {
  network: "ethereum";
  chainId: number;
  blockHeight: number;
  nativeToken: { symbol: string; decimals: number };
  /** wei decimal strings — null when the node did not answer. */
  gasPrice: string | null;
  maxPriorityFee: string | null;
  maxFee: string | null;
  baseFeePerGas: string | null;
  feesMeasuredAtBlock: number | null;
  /** Raw RPC url that served this read (evidence). */
  via: string;
}

export interface EvmAccountInfo {
  address: string;
  /** wei, decimal string. */
  balance: string;
  nonce: number;
  /** true when the address holds bytecode (contract OR EIP-7702 delegation). */
  isContract: boolean;
  codeSize: number;
  /** none = plain EOA · eip7702 = delegation designator (0xef01…) · contract = full bytecode. */
  codeKind: "none" | "eip7702" | "contract";
}

export interface Erc20BalanceInfo {
  token: string;
  symbol: string | null;
  decimals: number | null;
  /** Raw token units as decimal string (integer). */
  amount: string;
  /** Human format with token decimals — null when decimals() unavailable. */
  formatted: string | null;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface EthereumAdapterOptions {
  /** Candidate JSON-RPC endpoints, tried in order on every acquire. */
  rpcUrls: string[];
  /** EIP-155 chain id number. Default 1 (mainnet). */
  chainId?: number;
  /** Explicit broadcast opt-in — never enabled implicitly. */
  allowBroadcast?: boolean;
  requestTimeoutMs?: number;
  feeSpeed?: FeeSpeed;
}

export class EthereumAdapter implements ChainAdapter {
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
  private readonly feeSpeed: FeeSpeed;
  private readonly chainIdNumber: number;
  private readonly providers: ethers.JsonRpcProvider[] = [];
  private activeIndex = -1;

  constructor(private readonly opts: EthereumAdapterOptions) {
    if (!opts.rpcUrls.length) throw new Error("EthereumAdapter requires at least one rpcUrl");
    this.chainIdNumber = opts.chainId ?? 1;
    this.chainId = `eip155:${this.chainIdNumber}`;
    this.broadcastAllowed = opts.allowBroadcast === true;
    this.timeoutMs = opts.requestTimeoutMs ?? 10_000;
    this.feeSpeed = opts.feeSpeed ?? "standard";
    for (const url of opts.rpcUrls) {
      this.providers.push(
        new ethers.JsonRpcProvider(url, this.chainIdNumber, {
          staticNetwork: true,
          batchMaxCount: 1, // honest single calls; public RPCs throttle batches
        }),
      );
    }
  }

  // -- transport failover ---------------------------------------------------

  /** Returns a provider whose endpoint answered the latest health ping. */
  private async acquire(): Promise<{ provider: ethers.JsonRpcProvider; via: string }> {
    const order = [this.activeIndex, ...this.providers.map((_, i) => i).filter((i) => i !== this.activeIndex)]
      .filter((i) => i >= 0);
    for (const i of order) {
      try {
        const net = await this.providers[i].send("eth_chainId", []);
        if (typeof net !== "string") throw new Error("bad eth_chainId");
        this.activeIndex = i;
        return { provider: this.providers[i], via: this.opts.rpcUrls[i] };
      } catch {
        continue;
      }
    }
    throw new Error(`all ethereum RPC endpoints failed (${this.opts.rpcUrls.length} tried)`);
  }

  private async withTimeout<T>(p: (provider: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
    const { provider } = await this.acquire();
    return Promise.race([
      p(provider),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`RPC timeout after ${this.timeoutMs}ms`)), this.timeoutMs)),
    ]);
  }

  // -- ChainAdapter: read paths ---------------------------------------------

  async health(): Promise<ChainHealthReport> {
    const checkedAt = new Date().toISOString();
    try {
      const { provider } = await this.acquire();
      const block = await Promise.race([
        provider.getBlock("latest"),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("health timeout")), this.timeoutMs)),
      ]);
      if (!block) throw new Error("no latest block");
      const headMs = block.timestamp * 1000;
      return {
        reachable: true,
        chainId: this.chainId,
        headBlock: block.number,
        lagSeconds: Math.max(0, Math.round((Date.now() - headMs) / 1000)),
        namespaces: ["eip155", "eth"],
        checkedAt,
      };
    } catch {
      return { reachable: false, chainId: this.chainId, checkedAt };
    }
  }

  async getAccount(name: string): Promise<AccountSnapshot | null> {
    const balances = await this.getBalances(name);
    return { name: toEvmAddress(name), balances };
  }

  async getBalances(name: string): Promise<TokenBalances> {
    const address = toEvmAddress(name);
    const balance = await this.withTimeout((p) => p.getBalance(address));
    // Exact BigInt → string decimal math (no float drift on chain assets).
    const whole = balance / 10n ** 18n;
    const frac = (balance % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return { liquid: frac ? `${whole}.${frac} ETH` : `${whole}.000 ETH` };
  }

  async getRcManabar(_name: string): Promise<RcManabar | null> {
    void _name;
    // Honest: Ethereum has no RC manabar. Gas is the cost model here.
    return null;
  }

  // -- Extended read model ---------------------------------------------------

  async getChainInfo(): Promise<EvmChainInfo> {
    const { provider, via } = await this.acquire();
    const blockNumber = await provider.getBlockNumber();
    let fees: FeeSummary = { gasPrice: null, maxFeePerGas: null, maxPriorityFeePerGas: null, baseFeePerGas: null, speed: this.feeSpeed, measuredAtBlock: null };
    let gasPrice: bigint | null = null;
    try {
      gasPrice = await provider.getFeeData().then((f) => f.gasPrice ?? null);
    } catch {
      gasPrice = null;
    }
    try {
      const fees1559 = await estimateEip1559Fees(provider, this.feeSpeed);
      fees = toFeeSummary(fees1559, gasPrice);
    } catch {
      fees = toFeeSummary(null, gasPrice);
    }
    return {
      network: "ethereum",
      chainId: this.chainIdNumber,
      blockHeight: blockNumber,
      nativeToken: { symbol: "ETH", decimals: 18 },
      gasPrice: fees.gasPrice,
      maxPriorityFee: fees.maxPriorityFeePerGas,
      maxFee: fees.maxFeePerGas,
      baseFeePerGas: fees.baseFeePerGas,
      feesMeasuredAtBlock: fees.measuredAtBlock,
      via,
    };
  }

  async getAccountInfo(addressRaw: string): Promise<EvmAccountInfo> {
    const address = toEvmAddress(addressRaw);
    const [balance, nonce, code] = await this.withTimeout(async (p) => {
      const b = p.getBalance(address);
      const n = p.getTransactionCount(address, "latest");
      const c = p.getCode(address, "latest");
      return Promise.all([b, n, c]) as Promise<[bigint, number, string]>;
    });
    const codeHex = code === "0x" ? "" : code;
    const codeKind: EvmAccountInfo["codeKind"] =
      codeHex === "" ? "none" : codeHex.startsWith("0xef01") ? "eip7702" : "contract";
    return {
      address,
      balance: balance.toString(),
      nonce,
      isContract: codeHex !== "",
      codeSize: codeHex.length >= 2 ? (codeHex.length - 2) / 2 : 0,
      codeKind,
    };
  }

  async getTokenBalance(addressRaw: string, tokenAddressRaw: string): Promise<Erc20BalanceInfo> {
    const address = toEvmAddress(addressRaw);
    const token = toEvmAddress(tokenAddressRaw);
    const contract = new ethers.Contract(token, [...ERC20_READ_ABI], await this.acquire().then((a) => a.provider));
    const [amount, symbol, decimalsRaw] = await Promise.all([
      contract.balanceOf(address) as Promise<bigint>,
      contract.symbol().catch(() => null) as Promise<string | null>,
      contract.decimals().catch(() => null) as Promise<number | bigint | null>,
    ]);
    // Some nodes return uint8 as bigint — coerce to a real number.
    const decimals = typeof decimalsRaw === "bigint" ? Number(decimalsRaw) : decimalsRaw;
    let formatted: string | null = null;
    if (decimals !== null && Number.isInteger(decimals) && decimals >= 0) {
      const d = BigInt(decimals);
      const whole = amount / 10n ** d;
      const frac = (amount % 10n ** d).toString().padStart(decimals, "0").replace(/0+$/, "");
      formatted = frac ? `${whole}.${frac}` : `${whole}`;
    }
    return { token, symbol, decimals, amount: amount.toString(), formatted };
  }

  async getTransactionReceipt(hash: string): Promise<EvmTransactionReceiptSummary | null> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("invalid tx hash");
    const receipt = await this.withTimeout((p) => p.getTransactionReceipt(hash));
    if (!receipt) return null;
    const header = await this.withTimeout((p) => p.getBlock("latest"));
    return {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status === null ? null : receipt.status === 1 ? 1 : 0,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.gasPrice?.toString() ?? "0",
      logCount: receipt.logs.length,
      confirmations: header ? header.number - receipt.blockNumber : null,
    };
  }

  // -- ChainAdapter: write paths ---------------------------------------------

  /** Supported op types for this adapter. */
  static readonly OPERATION_TYPES: ReadonlySet<string> = new Set<EvmOperationType>([
    "transfer",
    "erc20_transfer",
    "erc20_approve",
  ]);

  /**
   * Builds an EIP-1559 unsigned envelope: fresh nonce + measured fees +
   * on-chain gas estimate. Payload validation is fail-closed.
   */
  async buildOperations(ops: Array<{ type: string; payload: Record<string, unknown> }>): Promise<UnsignedTx> {
    if (ops.length !== 1) {
      throw new Error(`ethereum buildOperations expects exactly one op (got ${ops.length}) — EVM txs are single-op`);
    }
    const op = ops[0];
    const { provider } = await this.acquire();

    let to: string | null = null;
    let value = 0n;
    let data = "0x";
    let gasFloor: bigint = DEFAULT_GAS_LIMITS.transfer;

    if (op.type === "transfer") {
      if (typeof op.payload.to !== "string") throw new Error("transfer requires string to");
      to = toEvmAddress(op.payload.to);
      const amountStr = op.payload.amount;
      if (typeof amountStr !== "string" || !/^\d+(\.\d{1,18})?$/.test(amountStr)) {
        throw new Error('transfer amount must be a decimal ETH string like "0.25"');
      }
      value = ethers.parseEther(amountStr);
      if (value <= 0n) throw new Error("transfer amount must be positive");
    } else if (op.type === "erc20_transfer" || op.type === "erc20_approve") {
      if (typeof op.payload.token !== "string") throw new Error(`${op.type} requires string token (contract address)`);
      const token = toEvmAddress(op.payload.token);
      const amountRaw = op.payload.amountRaw;
      if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) {
        throw new Error(`${op.type} amountRaw must be an integer token-units string`);
      }
      const amount = BigInt(amountRaw);
      if (amount < 0n) throw new Error("amountRaw must be non-negative");
      const iface = new ethers.Interface([...ERC20_READ_ABI, ...(op.type === "erc20_transfer"
        ? ["function transfer(address to, uint256 amount) returns (bool)"]
        : ["function approve(address spender, uint256 amount) returns (bool)"])]);
      if (op.type === "erc20_transfer") {
        if (typeof op.payload.to !== "string") throw new Error("erc20_transfer requires string to");
        to = token;
        data = iface.encodeFunctionData("transfer", [toEvmAddress(op.payload.to), amount]);
        gasFloor = DEFAULT_GAS_LIMITS.erc20Transfer;
      } else {
        if (typeof op.payload.spender !== "string") throw new Error("erc20_approve requires string spender");
        to = token;
        data = iface.encodeFunctionData("approve", [toEvmAddress(op.payload.spender), amount]);
        gasFloor = DEFAULT_GAS_LIMITS.erc20Approve;
      }
    } else {
      throw new Error(`operation "${op.type}" is not supported (transfer, erc20_transfer, erc20_approve)`);
    }

    const from = typeof op.payload.from === "string" ? toEvmAddress(op.payload.from) : null;
    const [nonce, fees] = await Promise.all([
      from ? provider.getTransactionCount(from, "pending") : provider.getTransactionCount(ethers.ZeroAddress, "latest"),
      estimateEip1559Fees(provider, this.feeSpeed),
    ]);

    let gasLimit = gasFloor;
    if (from && to) {
      try {
        const est = await provider.estimateGas({ from, to, value, data });
        // +20% headroom over the node's own estimate (stated policy).
        gasLimit = (est * 120n) / 100n;
      } catch {
        // estimate fails (e.g. unvalidated from) — keep the stated floor; the
        // chain will reject honestly at broadcast if it was too low.
      }
    }

    const metadata: EvmTxMetadata = {
      type: 2,
      chainId: this.chainIdNumber,
      nonce,
      to,
      value: value.toString(),
      data,
      gasLimit: gasLimit.toString(),
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    };
    return { chainId: this.chainId, operations: [{ type: op.type, payload: op.payload }], metadata };
  }

  /**
   * Signs the EIP-1559 envelope locally. Key material never leaves this call.
   * Role policy (fail closed): exactly ["active"] — the single-key EVM model.
   */
  async sign(tx: UnsignedTx, keys: SigningKeys, roles: KeyRole[]): Promise<SignedTx> {
    if (!Array.isArray(roles) || roles.length !== 1 || roles[0] !== "active") {
      throw new Error('ethereum signing requires exactly roles ["active"]');
    }
    const key = keys.byRole.active;
    if (key === undefined) throw new Error('no key provided for role "active"');
    const meta = tx.metadata;
    if (!isEip1559TxFields(meta)) {
      throw new Error("UnsignedTx.metadata must carry EIP-1559 fields (use buildOperations)");
    }
    if (meta.chainId !== this.chainIdNumber) {
      throw new Error(`tx chainId ${meta.chainId} != adapter chainId ${this.chainIdNumber}`);
    }

    const privHex =
      key instanceof ethers.Wallet
        ? key.privateKey
        : key instanceof Uint8Array
          ? ("0x" + Buffer.from(key).toString("hex"))
          : typeof key === "object" && key !== null && (key as { bytes?: unknown }).bytes instanceof Uint8Array
            // Vault PrivateKey handle (duck-typed .bytes) — secp256k1 is shared.
            ? ("0x" + Buffer.from((key as { bytes: Uint8Array }).bytes).toString("hex"))
            : typeof key === "string" && /^0x[0-9a-fA-F]{64}$/.test(key)
              ? key
              : null;
    if (!privHex) {
      throw new Error('keys.byRole.active must be a 0x-hex 32-byte private key, Uint8Array(32) or ethers.Wallet');
    }
    const wallet = new ethers.Wallet(privHex);

    const fields = metadataToTxFields(meta);
    const rawTransactionHex = await wallet.signTransaction({
      type: 2,
      chainId: fields.chainId,
      nonce: fields.nonce,
      to: fields.to,
      value: fields.value,
      data: fields.data,
      gasLimit: fields.gasLimit,
      maxFeePerGas: fields.maxFeePerGas,
      maxPriorityFeePerGas: fields.maxPriorityFeePerGas,
    });

    const parsed = ethers.Transaction.from(rawTransactionHex);
    const digestHex = ethers.keccak256(parsed.unsignedSerialized);
    if (!parsed.signature) throw new Error("internal: signed tx carries no signature");
    const recovered = ethers.recoverAddress(digestHex, parsed.signature);
    if (recovered.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error("internal: recovered signer mismatch");
    }

    const signedMeta: EvmTxMetadata = {
      ...meta,
      digestHex,
      rawTransactionHex,
      from: wallet.address,
      recoveredSigner: recovered,
    };
    return { ...tx, metadata: signedMeta, signatures: [rawTransactionHex], rolesUsed: ["active"] };
  }

  async broadcast(tx: SignedTx): Promise<BroadcastResult> {
    if (!this.broadcastAllowed) {
      throw new Error(
        "broadcast disabled: construct EthereumAdapter with allowBroadcast:true to enable (M0 gate)",
      );
    }
    const raw = (tx.metadata as EvmTxMetadata | undefined)?.rawTransactionHex;
    if (typeof raw !== "string") {
      throw new Error("broadcast requires sign() metadata (rawTransactionHex)");
    }
    const hash = await this.withTimeout((p) => p.broadcastTransaction(raw).then((r) => r.hash));
    return { txId: hash, raw: { rawTransactionHex: raw.slice(0, 18) + "…" } };
  }
}
