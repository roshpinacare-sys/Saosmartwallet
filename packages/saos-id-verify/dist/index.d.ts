/** On-chain anchor evidence (custom_json saos.id.v1 on Steem). */
export interface AnchorEvidence {
    trxId: string;
    block: number;
    timestamp: string;
    explorer: string;
    protocol: string;
    action: string;
    anchoredAt: string;
    claimedEvm: string;
    chainsClaimed: string[];
    msg: string;
    sig: string;
}
/** Cryptographic verification evidence computed server-side at call time. */
export interface VerifyEvidence {
    eip191DigestHex: string;
    recoveredEvm: string;
    claimedMatchesRecovered: boolean;
    activeKeyPub: string;
    activeKeyEvmAddress: string;
    activeKeyEqualsRecovered: boolean;
    sameScalarProof: boolean;
    scanned: number;
}
/** Per-chain active-authority check (live at call time). */
export interface ChainEvidence {
    chain: string;
    activePub: string | null;
    sameKeyAsSteem: boolean | null;
    note?: string;
}
/** Quota snapshot from the metering ledger (UTC-day window). */
export interface QuotaSnapshot {
    used: number;
    limit: number;
    remaining: number;
    /** Epoch seconds of the next UTC midnight. */
    resetAt: number;
}
export interface PlanInfo {
    tier: string;
    dailyCalls: number;
}
export interface CallMeta {
    endpoint: string;
    keyPrefix: string;
    outcome: "PROVEN" | "FAILED" | "ERROR";
    latencyMs: number;
    quota: QuotaSnapshot;
    plan: PlanInfo;
}
/** X-RateLimit-* response headers (null where the gateway omitted them). */
export interface RateLimit {
    limit: number | null;
    remaining: number | null;
    /** Epoch seconds of the next UTC midnight. */
    resetAt: number | null;
}
/**
 * The endpoint returns 200 + ok:true ONLY when the identity is PROVEN:
 * the Steem active authority's secp256k1 point derives the claimed EVM
 * address, the on-chain EIP-191 signature recovers the same address, and
 * the same key bytes are the live active authority on the measured chains.
 */
export interface VerifyProven {
    ok: true;
    username: string;
    measuredAt: string;
    anchor: AnchorEvidence;
    verify: VerifyEvidence;
    chains: ChainEvidence[];
    summary: string;
    meta: CallMeta;
    rateLimit: RateLimit;
}
/**
 * A 200 + ok:false means real work happened and honestly FAILED (e.g. the
 * account has no anchor, or no active key). It is metered — quota consumed.
 */
export interface VerifyNotProven {
    ok: false;
    username: string;
    measuredAt: string;
    error: string;
    meta?: CallMeta;
    rateLimit?: RateLimit;
}
export type VerifyResult = VerifyProven | VerifyNotProven;
export declare class SaosError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number);
}
/** 401 — API key missing, malformed, or revoked. The API is fail-closed. */
export declare class SaosAuthError extends SaosError {
    constructor(message: string);
}
/** 429 — UTC-day quota exhausted. `retryAt` = epoch seconds when quota resets. */
export declare class SaosQuotaError extends SaosError {
    readonly retryAt: number | null;
    constructor(message: string, retryAt: number | null);
}
/** Any other non-OK HTTP status. `body` holds the parsed response if any. */
export declare class SaosApiError extends SaosError {
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
/** The request never completed (network failure, timeout, abort). */
export declare class SaosNetworkError extends SaosError {
    readonly underlying: unknown;
    constructor(message: string, underlying?: unknown);
}
export interface SaosIdentityOptions {
    /**
     * Base URL of the SAOS gateway that serves /api/v1/identity/verify.
     * REQUIRED — the client refuses to invent an endpoint for you.
     * Trailing slashes are trimmed.
     */
    baseUrl: string;
    /** API key, format `saos_live_…` (created in the DEVELOPER console). */
    apiKey: string;
    /** Per-request timeout in ms. Default 30_000. */
    timeoutMs?: number;
    /** Injectable fetch (custom agents, edge runtimes). Default: globalThis.fetch. */
    fetch?: typeof fetch;
}
export declare class SaosIdentity {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly timeoutMs;
    private readonly fetchImpl;
    constructor(opts: SaosIdentityOptions);
    /**
     * Verify a Graphene identity against its on-chain SAOS anchor.
     * Throws SaosAuthError (401), SaosQuotaError (429), SaosApiError (other
     * non-OK), SaosNetworkError (transport). PROVEN / FAILED come back as a
     * typed 200 union — a FAILED verdict is a real, metered measurement.
     */
    verify(username: string): Promise<VerifyResult>;
}
/** One-shot helper — the 3-line integration path. */
export declare function verifyIdentity(opts: SaosIdentityOptions & {
    username: string;
}): Promise<VerifyResult>;
