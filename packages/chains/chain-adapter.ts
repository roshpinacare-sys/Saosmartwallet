/**
 * Saosmartwallet — ChainAdapter seam
 * ==================================
 * STATUS: INTERFACE ONLY. Deliberately contains no implementation.
 *
 * The M0 gate (wallet-design/final-proposal.md, "Decision Points D1–D5") blocks
 * any signing/key-derivation/broadcast implementation until the project owner
 * confirms:
 *   D1 — the RPC endpoint(s) to develop and test against
 *   D2 — the exact target chain (network name, token symbol, chain id)
 *
 * WHY THIS FILE EXISTS NOW
 *   The adapter seam is the single point where network specifics enter the
 *   wallet. Freezing its shape early keeps the core (keystore, policy engine,
 *   UI state) network-agnostic, exactly as specified in
 *   wallet-design/wallet-architecture.md ("network-agnostic core + adapter").
 *   A confirmed D1/D2 plugs in here without touching packages/core.
 *
 * ASSUMPTION (explicitly marked)
 *   The type vocabulary below leans on Steem-family semantics (three-token
 *   model, four key roles, Resource Credits). Marked fields are optional so a
 *   D2 decision for a different flavor degrades gracefully instead of forcing
 *   a rewrite.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export type ChainFlavor = 'steem-family' | 'other';

/** The four Steem-family key roles. Optional fields allow other flavors. */
export type KeyRole = 'owner' | 'active' | 'posting' | 'memo';

/** Capability flags an adapter advertises; the core must fail closed on missing ones. */
export type AdapterCapability =
  | 'query-balances'
  | 'query-rc'
  | 'query-history'
  | 'sign-posting'
  | 'sign-active'
  | 'broadcast'
  | 'memo-encrypt';

// ---------------------------------------------------------------------------
// Read models (what the wallet UI consumes)
// ---------------------------------------------------------------------------

export interface ChainHealthReport {
  reachable: boolean;
  chainId?: string;
  headBlock?: number;
  /** Seconds between head block time and local clock. Clock-skew sensitive. */
  lagSeconds?: number;
  namespaces?: string[];
  checkedAt: string; // ISO-8601
}

export interface AccountSnapshot {
  name: string;
  created?: string;
  /** Steem-family three-token model. `debt` = SBD/SBD-like; optional for other flavors. */
  balances: TokenBalances;
}

export interface TokenBalances {
  /** Liquid token (STEEM / HIVE / fork symbol — exact string decided by D2). */
  liquid: string;
  /** Vesting shares / stake-backed representation (SP / HP). */
  vestingShares?: string;
  /** Debt-bearing stable token (SBD / HBD). */
  debt?: string;
}

export interface RcManabar {
  currentMana: string; // large integers travel as strings
  maxRc: string;
  /** 0..100, one decimal. */
  percent: number;
}

// ---------------------------------------------------------------------------
// Write models (what signing produces)
// ---------------------------------------------------------------------------

export interface ChainOperation {
  /** Network operation name, e.g. "transfer". Validated against D2 at M0. */
  type: string;
  payload: Record<string, unknown>;
}

export interface UnsignedTx {
  chainId: string;
  operations: ChainOperation[];
  /** Expiration + ref-block fields are chain-specific; adapter owns their shape. */
  metadata?: Record<string, unknown>;
}

export interface SignedTx extends UnsignedTx {
  signatures: string[];
  /** Which roles were used — the Policy Engine audits this (Aurora Modes). */
  rolesUsed: KeyRole[];
}

export interface BroadcastResult {
  txId: string;
  blockNum?: number;
  /** Raw node response kept for audit; never logged by the core. */
  raw?: unknown;
}

/** Key material handle. The concrete representation (WIF / derived bytes / HW handle) is decided at M0, not before. */
export interface SigningKeys {
  byRole: Partial<Record<KeyRole, unknown>>;
}

// ---------------------------------------------------------------------------
// The seam itself
// ---------------------------------------------------------------------------

export interface ChainAdapter {
  readonly chainId: string;
  readonly flavor: ChainFlavor;
  readonly capabilities: ReadonlySet<AdapterCapability>;

  /** Mirrors tools/chain-health-check.ts logic; the tool remains the human-facing runner. */
  health(): Promise<ChainHealthReport>;

  getAccount(name: string): Promise<AccountSnapshot | null>;
  getBalances(name: string): Promise<TokenBalances>;
  getRcManabar(name: string): Promise<RcManabar | null>;

  buildOperations(ops: ChainOperation[]): Promise<UnsignedTx>;
  sign(tx: UnsignedTx, keys: SigningKeys, roles: KeyRole[]): Promise<SignedTx>;
  broadcast(tx: SignedTx): Promise<BroadcastResult>;
}
