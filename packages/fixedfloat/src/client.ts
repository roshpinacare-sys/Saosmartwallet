/**
 * Saosmartwallet packages/fixedfloat — the exchange-rail client
 * =============================================================
 * Production connector over FixedFloat API v1 for the wallet's cross-chain
 * matrix (directive §4: ETH/SOL legs ride this rail; HIVE/STEEM legs ride
 * the internal-market WebSocket rail).
 *
 * Laws:
 *   • Transport is INJECTED. The only default transport is a thin `fetch`
 *     wrapper for runtime use; tests never touch it (zero-network law).
 *   • Every request: POST form-encoded, params in insertion order,
 *     X-API-KEY / X-API-SIGN (HMAC of concatenated values) / X-API-NONCE
 *     (strictly increasing, injected clock).
 *   • Envelope: {code:0} → data; {code≠0} → API error; non-JSON → PARSE;
 *     non-2xx → NETWORK. All messages redacted against the custody pair.
 *   • Fail-closed local validation BEFORE any wire call — a refused input
 *     costs zero transport invocations.
 *   • Response field shapes are the DOCUMENTED v1 contract; because this
 *     sandbox's egress to ff.io is Cloudflare-blocked (measured 403), every
 *     documented field is typed optional and callRaw() exposes the raw
 *     envelope for live inspection on the daemon host.
 */

import {
  FixedFloatConfig,
  FixedFloatError,
  loadFixedFloatConfig,
  type FixedFloatConfigEnv,
  type FixedFloatConfigObject,
} from "./config";
import { FF_API_BASE, FF_HEADER_KEY, FF_HEADER_NONCE, FF_HEADER_SIGN, ffSign, nextNonce } from "./sign";
import { validateEmergencyAction, type EmergencyAction } from "./orders";

export { FF_API_BASE };

// ── transport seam ──────────────────────────────────────────────────────────

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

export type FixedFloatTransport = (req: TransportRequest) => Promise<TransportResponse>;

/** Runtime transport (fetch). NEVER used in tests — injected transports only. */
export function makeDefaultTransport(): FixedFloatTransport {
  return async (req) => {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return { status: res.status, text: await res.text() };
  };
}

// ── documented v1 shapes (optional fields — honest typing, see header note) ─

export interface FfCurrency {
  code?: string;
  coin?: string;
  name?: string;
  network?: string;
  token?: boolean;
  maxAmount?: number;
  minAmount?: number;
  decimals?: number;
  [k: string]: unknown;
}

export interface FfOrder {
  id?: string;
  from?: string;
  to?: string;
  amount?: string;
  status?: number;
  date?: number;
  addressTo?: string;
  transaction?: string;
  [k: string]: unknown;
}

export interface FfPair {
  rate?: number;
  min?: number;
  max?: number;
  [k: string]: unknown;
}

export interface FfEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

export type FfDirection = "from" | "to";
export type FfOrderType = "fixed" | "float";

export interface CreateOrderRequest {
  from: string;
  to: string;
  amount: string;
  direction: FfDirection;
  /** "fixed" | "float" — omitted means the exchange's default (float). */
  type?: FfOrderType;
  /** Destination address on the `to` chain. */
  addrTo?: string;
  /** Refund address on the `from` chain (recommended custody hygiene). */
  addrRefund?: string;
  /** Extra destination payload (e.g. memo/tag) when the `to` asset needs one. */
  extraTo?: string;
}

export interface FixedFloatClientOptions {
  transport: FixedFloatTransport;
  /** Injected clock (ms). Required — zero wall-clock inside the module. */
  now: () => number;
  /** Endpoint override (tests / gateway mirrors). Default: documented ff.io v1. */
  baseUrl?: string;
}

export class FixedFloatClient {
  private readonly cfg: FixedFloatConfigObject;
  private readonly transport: FixedFloatTransport;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private nonceIssued = 0n;

  constructor(envOrConfig: FixedFloatConfigEnv | FixedFloatConfigObject, opts: FixedFloatClientOptions) {
    this.cfg =
      envOrConfig instanceof FixedFloatConfig
        ? envOrConfig
        : loadFixedFloatConfig(envOrConfig as FixedFloatConfigEnv);
    this.transport = opts.transport;
    this.now = opts.now;
    this.baseUrl = (opts.baseUrl ?? FF_API_BASE).replace(/\/+$/, "");
  }

  /** Count of nonces issued on this client (wire-observability for tests). */
  get nonceCount(): bigint {
    return this.nonceIssued;
  }

  /**
   * The raw envelope escape hatch — every method below is a typed view over
   * this call; live inspection on the daemon host uses this directly.
   */
  async callRaw<T>(method: string, params: Record<string, string> = {}): Promise<FfEnvelope<T>> {
    const values = Object.values(params);
    const search = new URLSearchParams(params);
    const body = search.toString(); // preserves insertion order; "" when empty
    const nonce = nextNonce(this.now);
    this.nonceIssued += 1n;
    const signature = ffSign(new TextEncoder().encode(this.cfg.apiSecret), values);
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      [FF_HEADER_KEY]: this.cfg.apiKey,
      [FF_HEADER_SIGN]: signature,
      [FF_HEADER_NONCE]: nonce,
    };
    const url = `${this.baseUrl}/${method}`;
    let resp: TransportResponse;
    try {
      resp = await this.transport({ url, method: "POST", headers, body });
    } catch (e) {
      throw new FixedFloatError(
        "NETWORK",
        `fixedfloat: transport failure on ${method}: ${e instanceof Error ? e.message : String(e)}`,
        { secrets: this.cfg.secrets() },
      );
    }
    if (resp.status < 200 || resp.status >= 300) {
      const tail = resp.text.length > 200 ? `${resp.text.slice(0, 200)}…` : resp.text;
      throw new FixedFloatError(
        "NETWORK",
        `fixedfloat: HTTP ${resp.status} from ${method} (endpoint unreachable from this egress — ` +
          `Cloudflare IP class measured 403 from the sandbox; run live from the daemon host) body=${tail}`,
        { httpStatus: resp.status, secrets: this.cfg.secrets() },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(resp.text);
    } catch {
      const tail = resp.text.length > 120 ? `${resp.text.slice(0, 120)}…` : resp.text;
      throw new FixedFloatError("PARSE", `fixedfloat: non-JSON response from ${method}: ${tail}`, {
        secrets: this.cfg.secrets(),
      });
    }
    const envelope = parsed as FfEnvelope<T>;
    if (typeof envelope.code !== "number" || typeof envelope.msg !== "string") {
      throw new FixedFloatError("PARSE", `fixedfloat: response from ${method} is not the v1 envelope`, {
        secrets: this.cfg.secrets(),
      });
    }
    if (envelope.code !== 0) {
      throw new FixedFloatError("API", `fixedfloat: ${method} refused (code ${envelope.code}): ${envelope.msg}`, {
        apiCode: envelope.code,
        secrets: this.cfg.secrets(),
      });
    }
    return envelope;
  }

  private static refuse(msg: string): never {
    throw new FixedFloatError("VALIDATE", msg);
  }

  private static requireAsset(v: string, field: string): string {
    if (typeof v !== "string" || v.trim().length === 0) {
      FixedFloatClient.refuse(`${field} is empty`);
    }
    return v.trim().toUpperCase();
  }

  private static requireAmount(v: string): string {
    const n = Number(v);
    if (v.trim().length === 0 || !Number.isFinite(n) || n <= 0) {
      FixedFloatClient.refuse(`amount must be a positive finite number, got "${v}"`);
    }
    return v.trim();
  }

  // ── documented v1 methods ────────────────────────────────────────────────

  async getCurrencies(): Promise<FfCurrency[]> {
    return (await this.callRaw<FfCurrency[]>("getCurrencies")).data;
  }

  async getPair(from: string, to: string): Promise<FfPair> {
    const f = FixedFloatClient.requireAsset(from, "from");
    const t = FixedFloatClient.requireAsset(to, "to");
    return (await this.callRaw<FfPair>("getPair", { from: f, to: t })).data;
  }

  async getPrice(from: string, to: string, amount: string, direction: FfDirection = "from"): Promise<FfPair> {
    const f = FixedFloatClient.requireAsset(from, "from");
    const t = FixedFloatClient.requireAsset(to, "to");
    const a = FixedFloatClient.requireAmount(amount);
    if (direction !== "from" && direction !== "to") {
      FixedFloatClient.refuse(`direction must be "from" or "to", got "${direction}"`);
    }
    return (await this.callRaw<FfPair>("getPrice", { from: f, to: t, amount: a, direction })).data;
  }

  async createOrder(req: CreateOrderRequest): Promise<FfOrder> {
    const from = FixedFloatClient.requireAsset(req.from, "from");
    const to = FixedFloatClient.requireAsset(req.to, "to");
    const amount = FixedFloatClient.requireAmount(req.amount);
    if (req.direction !== "from" && req.direction !== "to") {
      FixedFloatClient.refuse(`direction must be "from" or "to", got "${String(req.direction)}"`);
    }
    if (req.type !== undefined && req.type !== "fixed" && req.type !== "float") {
      FixedFloatClient.refuse(`type must be "fixed" or "float", got "${String(req.type)}"`);
    }
    const params: Record<string, string> = { from, to, amount, direction: req.direction };
    if (req.type !== undefined) params.type = req.type;
    if (req.addrTo !== undefined && req.addrTo.trim().length > 0) params.addrTo = req.addrTo.trim();
    if (req.addrRefund !== undefined && req.addrRefund.trim().length > 0) {
      params.addrRefund = req.addrRefund.trim();
    }
    if (req.extraTo !== undefined && req.extraTo.trim().length > 0) params.extra = req.extraTo.trim();
    return (await this.callRaw<FfOrder>("createOrder", params)).data;
  }

  async getOrder(id: string): Promise<FfOrder> {
    if (typeof id !== "string" || id.trim().length === 0) {
      FixedFloatClient.refuse("order id is empty");
    }
    return (await this.callRaw<FfOrder>("getOrder", { id: id.trim() })).data;
  }

  async getEmergencyAction(id: string): Promise<Record<string, unknown>> {
    if (typeof id !== "string" || id.trim().length === 0) {
      FixedFloatClient.refuse("order id is empty");
    }
    return (await this.callRaw<Record<string, unknown>>("getEmergency", { id: id.trim() })).data;
  }

  async setEmergencyAction(action: EmergencyAction): Promise<Record<string, unknown>> {
    const verdict = validateEmergencyAction(action);
    if (!verdict.ok) {
      FixedFloatClient.refuse(`emergency action refused: ${verdict.reason}`);
    }
    const params: Record<string, string> = { id: action.id.trim(), choice: action.choice };
    if (action.choice === "REFUND") params.address = action.address!.trim();
    return (await this.callRaw<Record<string, unknown>>("setEmergency", params)).data;
  }

  async xffRates(): Promise<Record<string, unknown>> {
    return (await this.callRaw<Record<string, unknown>>("xffRates")).data;
  }
}
