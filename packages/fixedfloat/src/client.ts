/**
 * Saosmartwallet packages/fixedfloat — official v2 API client (wave G76-b)
 * ===========================================================================
 * Production rail client for the OFFICIAL FixedFloat API v2 (https://ff.io/api/v2/,
 * spec pinned from https://fixedfloat.com/api — archived by wave G76-b):
 *
 *   • POST {base}{method}; mandatory headers Content-Type "application/json;
 *     charset=UTF-8", X-API-KEY, X-API-SIGN = HMAC-SHA256(apiSecret, exactBody).
 *   • Response envelope {code, msg, data}; code === 0 ⇒ resolve `data`.
 *
 * Transport honesty:
 *   • The transport seam is injectable for deterministic tests; the default is a
 *     REAL fetch with an AbortController timeout — the live path exists and is
 *     exercised only by the env-gated probe (bin/probe-live.ts), never by tests.
 *   • RETRY CLASSIFICATION LAW: read-only methods (ccies, price, order, qr) may
 *     retry on transport errors / 429 / 5xx with exponential backoff + jitter
 *     (both injectable ⇒ deterministic). SIDE-EFFECTFUL methods (create,
 *     emergency, setEmail) are attempted EXACTLY ONCE — a blind retry could
 *     double-create an order or double-trigger a refund; they fail honest.
 *   • Business errors (code≠0) never retry. Malformed 2xx bodies never retry.
 *   • Timeout ⇒ FF_E_TIMEOUT (retryable only for read-only methods).
 *
 * Secret hygiene: credentials live in #private fields with no accessors;
 * JSON.stringify(client) carries no material; no error message embeds a key,
 * the signed body's credentials, or anything sensitive. Verdicts are honest:
 * failures surface as typed FF_E_* errors — the client never fabricates a
 * success, never returns a guessed default, never swallows.
 */

import { FixedFloatError } from "./errors";
import { buildApiHeaders, buildApiSignature, canonicalPayloadString, EMPTY_PAYLOAD } from "./sign";

export const FF_BASE_URL = "https://ff.io/api/v2/" as const;

/** Methods whose requests are safe to retry (idempotent reads). */
const SAFE_METHODS = new Set(["ccies", "price", "order", "qr"]);
/** The full documented method whitelist (path-traversal / injection guard). */
const FF_METHODS = new Set(["ccies", "price", "create", "order", "emergency", "qr", "setEmail"]);

export interface TransportRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface TransportResponse {
  status: number;
  text: string;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface FixedFloatClientOptions {
  apiKey: string;
  apiSecret: string;
  /** Defaults to the official endpoint. */
  baseUrl?: string;
  /** Injectable transport (deterministic tests). Default: real fetch + timeout. */
  transport?: Transport;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
  /** Extra attempts for READ-ONLY methods after the first (default 2). */
  maxRetries?: number;
  /** Backoff base in ms: delay = base * 2^attempt + rng()*jitter (default 100). */
  retryBaseDelayMs?: number;
  /** Max jitter in ms added to each backoff (default 50). */
  jitterMaxMs?: number;
  /** Injected rng in [0,1) for deterministic jitter (default Math.random). */
  rng?: () => number;
  /** Injected sleep for deterministic backoff (default real timer). */
  sleep?: (ms: number) => Promise<void>;
}

export interface CreateOrderRequest {
  type: "fixed" | "float";
  fromCcy: string;
  toCcy: string;
  direction: "from" | "to";
  amount: number;
  toAddress: string;
  tag?: string | false;
  refcode?: string;
  afftax?: number;
}

export interface EmergencyRequest {
  id: string;
  token: string;
  choice: "EXCHANGE" | "REFUND";
  address?: string;
  tag?: string;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || (err as NodeJS.ErrnoException).code === "ABORT_ERR");
}

export class FixedFloatClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** The injected-or-default sleep — the rail reuses it for deterministic polling. */
  readonly sleepFn: (ms: number) => Promise<void>;

  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #transport: Transport;
  readonly #maxRetries: number;
  readonly #retryBaseDelayMs: number;
  readonly #jitterMaxMs: number;
  readonly #rng: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: FixedFloatClientOptions) {
    if (typeof opts.apiKey !== "string" || opts.apiKey.length === 0) {
      throw new FixedFloatError("FF_E_STATE", "apiKey must be a non-empty string");
    }
    if (typeof opts.apiSecret !== "string" || opts.apiSecret.length === 0) {
      throw new FixedFloatError("FF_E_STATE", "apiSecret must be a non-empty string");
    }
    this.baseUrl = opts.baseUrl ?? FF_BASE_URL;
    if (!this.baseUrl.startsWith("https://")) {
      throw new FixedFloatError("FF_E_STATE", "baseUrl must be https — credentials never travel over plaintext");
    }
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.#apiKey = opts.apiKey;
    this.#apiSecret = opts.apiSecret;
    this.#maxRetries = opts.maxRetries ?? 2;
    this.#retryBaseDelayMs = opts.retryBaseDelayMs ?? 100;
    this.#jitterMaxMs = opts.jitterMaxMs ?? 50;
    this.#rng = opts.rng ?? Math.random;
    this.#sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.sleepFn = this.#sleep;
    this.#transport = opts.transport ?? defaultFetchTransport(this.timeoutMs);
  }

  /**
   * The single wire path: canonicalize → sign-the-exact-sent-string → POST →
   * envelope unwrap. Retry policy per the classification law; all failures are
   * honest typed errors.
   */
  async request<T = unknown>(method: string, payload?: Record<string, unknown>): Promise<T> {
    if (!FF_METHODS.has(method)) {
      throw new FixedFloatError("FF_E_STATE", `unknown FixedFloat method "${method}" — refusing to send`);
    }
    const body = payload === undefined ? EMPTY_PAYLOAD : canonicalPayloadString(payload);
    const sign = buildApiSignature(this.#apiSecret, body);
    const headers = buildApiHeaders(this.#apiKey, sign);
    const url = this.baseUrl + method;
    const safe = SAFE_METHODS.has(method);
    const maxAttempts = safe ? 1 + this.#maxRetries : 1;

    let lastErr: FixedFloatError | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = this.#retryBaseDelayMs * 2 ** (attempt - 1) + Math.floor(this.#rng() * this.#jitterMaxMs);
        await this.#sleep(delay);
      }
      try {
        const res = await this.#transport({ url, method: "POST", headers, body });
        return unwrapEnvelope<T>(method, res);
      } catch (err) {
        if (err instanceof FixedFloatError) {
          // API-level and malformed-envelope answers are definitive — never retried.
          if (err.code === "FF_E_API" || err.code === "FF_E_MALFORMED") throw err;
          lastErr = err;
        } else if (isAbortError(err)) {
          lastErr = new FixedFloatError("FF_E_TIMEOUT", `request timed out after ${this.timeoutMs}ms on ${method}`);
        } else {
          const cause = err instanceof Error ? err.message : String(err);
          lastErr = new FixedFloatError("FF_E_TRANSPORT", `transport failure on ${method}: ${cause}`);
        }
      }
    }
    throw lastErr ?? new FixedFloatError("FF_E_TRANSPORT", `transport failure on ${method}`);
  }

  /** List of supported currencies (read-only, no parameters — signs the empty string). */
  currencies(): Promise<unknown[]> {
    return this.request<unknown[]>("ccies");
  }

  /** Exchange rate for a pair (read-only). */
  price(req: { fromCcy: string; toCcy: string; amount: number; direction: "from" | "to"; type: "fixed" | "float"; ccies?: boolean }): Promise<Record<string, unknown>> {
    validatePriceRequest(req);
    return this.request("price", { ...req });
  }

  /** Creates an exchange order (SIDE-EFFECTFUL: exactly one attempt, ever). */
  createOrder(req: CreateOrderRequest): Promise<Record<string, unknown>> {
    validateCreateRequest(req);
    return this.request("create", { ...req });
  }

  /** Order details (read-only). */
  orderInfo(id: string, token: string): Promise<Record<string, unknown>> {
    if (typeof id !== "string" || id.length === 0 || typeof token !== "string" || token.length === 0) {
      throw new FixedFloatError("FF_E_STATE", "orderInfo requires non-empty id and token");
    }
    return this.request("order", { id, token });
  }

  /** Emergency action choice (SIDE-EFFECTFUL: exactly one attempt, ever). */
  emergencyAction(req: EmergencyRequest): Promise<Record<string, unknown>> {
    if (typeof req.id !== "string" || req.id.length === 0 || typeof req.token !== "string" || req.token.length === 0) {
      throw new FixedFloatError("FF_E_STATE", "emergencyAction requires non-empty id and token");
    }
    if (req.choice !== "EXCHANGE" && req.choice !== "REFUND") {
      throw new FixedFloatError("FF_E_STATE", 'emergency choice must be "EXCHANGE" or "REFUND"');
    }
    if (req.choice === "REFUND" && (typeof req.address !== "string" || req.address.length === 0)) {
      throw new FixedFloatError("FF_E_STATE", "emergency REFUND requires a refund address");
    }
    const payload: Record<string, unknown> = { id: req.id, token: req.token, choice: req.choice };
    if (req.address !== undefined) payload.address = req.address;
    if (req.tag !== undefined) payload.tag = req.tag;
    return this.request("emergency", payload);
  }
}

// ---------------------------------------------------------------------------
// Envelope unwrapping (honest, no fabrication)
// ---------------------------------------------------------------------------

interface FfEnvelope {
  code: number;
  msg: string;
  data: unknown;
}

function unwrapEnvelope<T>(method: string, res: TransportResponse): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    if (res.status < 200 || res.status >= 300) {
      throw new FixedFloatError("FF_E_TRANSPORT", `HTTP ${res.status} with a non-JSON body on ${method}`);
    }
    throw new FixedFloatError("FF_E_MALFORMED", `non-JSON response body on ${method} (HTTP ${res.status})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as FfEnvelope).code !== "number") {
    throw new FixedFloatError("FF_E_MALFORMED", `response is not the documented {code,msg,data} envelope on ${method}`);
  }
  const env = parsed as FfEnvelope;
  if (env.code !== 0) {
    throw new FixedFloatError("FF_E_API", `FF API error ${env.code} on ${method}: ${String(env.msg ?? "")}`);
  }
  if (!("data" in env) || env.data === undefined) {
    throw new FixedFloatError("FF_E_MALFORMED", `envelope code=0 without data on ${method}`);
  }
  return env.data as T;
}

// ---------------------------------------------------------------------------
// Default real transport (the honest live path — used by the env-gated probe)
// ---------------------------------------------------------------------------

function defaultFetchTransport(timeoutMs: number): Transport {
  return async (req: TransportRequest): Promise<TransportResponse> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: ctrl.signal,
        redirect: "follow",
      });
      const text = await res.text();
      return { status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------------------------------------------------------------------------
// Request schema validation (fail-closed BEFORE any transport call)
// ---------------------------------------------------------------------------

function validatePriceRequest(req: { fromCcy: string; toCcy: string; amount: number; direction: "from" | "to"; type: "fixed" | "float" }): void {
  if (typeof req.fromCcy !== "string" || req.fromCcy.length === 0 || typeof req.toCcy !== "string" || req.toCcy.length === 0) {
    throw new FixedFloatError("FF_E_STATE", "price requires non-empty fromCcy and toCcy");
  }
  if (typeof req.amount !== "number" || !Number.isFinite(req.amount) || req.amount <= 0) {
    throw new FixedFloatError("FF_E_STATE", "price amount must be a positive finite number");
  }
  if (req.direction !== "from" && req.direction !== "to") {
    throw new FixedFloatError("FF_E_STATE", 'price direction must be "from" or "to"');
  }
  if (req.type !== "fixed" && req.type !== "float") {
    throw new FixedFloatError("FF_E_STATE", 'price type must be "fixed" or "float"');
  }
}

function validateCreateRequest(req: CreateOrderRequest): void {
  validatePriceRequest(req);
  if (typeof req.toAddress !== "string" || req.toAddress.length === 0) {
    throw new FixedFloatError("FF_E_STATE", "createOrder requires a non-empty toAddress");
  }
}
