/**
 * Saosmartwallet packages/fixedfloat — the exchange-rail client
 * =============================================================
 * Production connector over the MEASURED FixedFloat API v2 contract
 * (ff.io/api/v2/, JSON body, X-Api-Key + X-Signature = HMAC-SHA1 of the
 * sorted-canonical body — measured live 2026-10-26, trace
 * 1a178850450f2e55) for the wallet's cross-chain matrix (directive §4:
 * ETH/SOL legs ride this rail; HIVE/STEEM legs ride the internal-market
 * rail).
 *
 * Laws:
 *   • Transport is INJECTED. The only default transport is a thin `fetch`
 *     wrapper for runtime use; tests never touch it (zero-network law).
 *   • Every request: POST JSON (deep-sorted, deterministic bytes),
 *     X-Api-Key + X-Signature = ffSign(body, secret). The measured v2 set
 *     is {price, ccies, create, order, emergency, qr} — anything else
 *     refuses locally at zero wire cost.
 *   • Envelope: `data` present and no refusing `code` → data; a `code`
 *     outside {0, 200} → API error (measured live: 501 "Not have
 *     permission" = key pending account-side API enablement); non-JSON →
 *     PARSE; non-2xx → NETWORK. All messages redacted against custody.
 *   • Fail-closed local validation BEFORE any wire call — a refused input
 *     costs zero transport invocations.
 *   • Field shapes are the DOCUMENTED contract with optional fields;
 *     callRaw() exposes the raw envelope for live inspection on the
 *     daemon host before any typed field is promoted to required.
 */

import {
  FixedFloatConfig,
  FixedFloatError,
  loadFixedFloatConfig,
  type FixedFloatConfigEnv,
  type FixedFloatConfigObject,
} from "./config";
import {
  FF_API_BASE,
  FF_HEADER_KEY,
  FF_HEADER_SIGN,
  FF_METHODS,
  deepSort,
  ffSign,
  type FfMethod,
} from "./sign";
import { validateEmergencyAction, type EmergencyAction } from "./orders";

export { FF_API_BASE, FF_METHODS };
export type { FfMethod };

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

// ── documented v2 shapes (optional fields — honest typing, see header note) ─

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

export interface FfPrice {
  rate?: number | string;
  price?: number | string;
  min?: number | string;
  max?: number | string;
  [k: string]: unknown;
}

export interface FfEnvelope<T> {
  code?: number;
  msg?: string;
  data: T;
}

export type FfOrderType = "fixed" | "float";

export interface CreateOrderRequest {
  from: string;
  to: string;
  amount: string;
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
  /** Endpoint override (tests / gateway mirrors). Default: measured v2 base. */
  baseUrl?: string;
}

export class FixedFloatClient {
  private readonly cfg: FixedFloatConfigObject;
  private readonly transport: FixedFloatTransport;
  private readonly baseUrl: string;

  constructor(envOrConfig: FixedFloatConfigEnv | FixedFloatConfigObject, opts: FixedFloatClientOptions) {
    this.cfg =
      envOrConfig instanceof FixedFloatConfig
        ? envOrConfig
        : loadFixedFloatConfig(envOrConfig as FixedFloatConfigEnv);
    this.transport = opts.transport;
    this.baseUrl = (opts.baseUrl ?? FF_API_BASE).replace(/([^/])\/?$/, "$1/");
  }

  /**
   * The raw envelope escape hatch — every method below is a typed view over
   * this call; live inspection on the daemon host uses this directly.
   * `method` must be in the measured v2 set; params are the JSON body.
   */
  async callRaw<T>(method: FfMethod, params: Record<string, unknown> = {}): Promise<FfEnvelope<T>> {
    if (!(FF_METHODS as readonly string[]).includes(method)) {
      FixedFloatClient.refuse(`unknown FixedFloat v2 method "${method}" (measured set: ${FF_METHODS.join(", ")})`);
    }
    const wireBody = deepSort(params) as Record<string, unknown>;
    const signature = ffSign(wireBody, this.cfg.apiSecret);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [FF_HEADER_KEY]: this.cfg.apiKey,
      [FF_HEADER_SIGN]: signature,
    };
    const url = `${this.baseUrl}${method}`;
    let resp: TransportResponse;
    try {
      resp = await this.transport({ url, method: "POST", headers, body: JSON.stringify(wireBody) });
    } catch (e) {
      throw new FixedFloatError(
        "NETWORK",
        `fixedfloat: transport failure on ${method}: ${e instanceof Error ? e.message : String(e)}`,
        { secrets: this.cfg.secrets() },
      );
    }
    if (resp.status < 200 || resp.status >= 300) {
      // MEASURED (live 2026-10-26, trace 1a1788373a64c3ed): permission
      // refusals arrive as HTTP 403 WITH a valid v2 envelope body
      // ({"code":"501","msg":"Not have permission"}). If the body parses to
      // an envelope with a code, surface kind=API (the true refusal) while
      // preserving the http status; only non-envelope bodies stay NETWORK.
      let bodyCode: number | undefined;
      let bodyMsg: string | undefined;
      try {
        const probe = JSON.parse(resp.text) as Record<string, unknown>;
        if (probe !== null && typeof probe === "object" && !Array.isArray(probe)) {
          if (typeof probe["code"] !== "undefined") bodyCode = Number(probe["code"]);
          if (typeof probe["msg"] === "string") bodyMsg = probe["msg"];
        }
      } catch {
        // non-JSON body — stays NETWORK
      }
      if (bodyCode !== undefined && Number.isFinite(bodyCode) && bodyCode !== 0 && bodyCode !== 200) {
        throw new FixedFloatError(
          "API",
          `fixedfloat: ${method} refused (code ${bodyCode}, HTTP ${resp.status}): ${String(bodyMsg ?? "")}`,
          { apiCode: bodyCode, httpStatus: resp.status, secrets: this.cfg.secrets() },
        );
      }
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
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new FixedFloatError("PARSE", `fixedfloat: response from ${method} is not the v2 object envelope`, {
        secrets: this.cfg.secrets(),
      });
    }
    const envObj = parsed as Record<string, unknown>;
    const code = typeof envObj["code"] === "number" ? (envObj["code"] as number) : undefined;
    const msg = typeof envObj["msg"] === "string" ? (envObj["msg"] as string) : undefined;
    // Measured v2 envelope: success carries `data` (code may be absent or 0/200);
    // any other code is an API refusal (measured live: 501 "Not have permission").
    if (!("data" in envObj)) {
      if (code !== undefined) {
        throw new FixedFloatError("API", `fixedfloat: ${method} refused (code ${code}): ${String(msg ?? "")}`, {
          apiCode: code,
          secrets: this.cfg.secrets(),
        });
      }
      throw new FixedFloatError("PARSE", `fixedfloat: ${method} envelope carries no data field`, {
        secrets: this.cfg.secrets(),
      });
    }
    if (code !== undefined && code !== 0 && code !== 200) {
      throw new FixedFloatError(
        "API",
        `fixedfloat: ${method} refused (code ${code}): ${String(msg ?? "")}`,
        { apiCode: code, secrets: this.cfg.secrets() },
      );
    }
    return { code, msg, data: envObj["data"] as T };
  }

  private static refuse(msg: string): never {
    throw new FixedFloatError("VALIDATE", msg);
  }

  private static requireAsset(v: string, field: string): string {
    if (typeof v !== "string" || v.trim().length === 0) {
      FixedFloatClient.refuse(`${field} is empty`);
    }
    return v.trim().toLowerCase();
  }

  private static requireAmount(v: string): string {
    const n = Number(v);
    if (v.trim().length === 0 || !Number.isFinite(n) || n <= 0) {
      FixedFloatClient.refuse(`amount must be a positive finite number, got "${v}"`);
    }
    return v.trim();
  }

  // ── typed views over the measured v2 methods ─────────────────────────────

  async getCurrencies(): Promise<FfCurrency[]> {
    return (await this.callRaw<FfCurrency[]>("ccies")).data;
  }

  async getPrice(from: string, to: string, amount: string, type: FfOrderType = "float"): Promise<FfPrice> {
    const f = FixedFloatClient.requireAsset(from, "from");
    const t = FixedFloatClient.requireAsset(to, "to");
    const a = FixedFloatClient.requireAmount(amount);
    if (type !== "fixed" && type !== "float") {
      FixedFloatClient.refuse(`type must be "fixed" or "float", got "${String(type)}"`);
    }
    return (await this.callRaw<FfPrice>("price", { type, from: f, to: t, amount: a })).data;
  }

  async createOrder(req: CreateOrderRequest): Promise<FfOrder> {
    const from = FixedFloatClient.requireAsset(req.from, "from");
    const to = FixedFloatClient.requireAsset(req.to, "to");
    const amount = FixedFloatClient.requireAmount(req.amount);
    if (req.type !== undefined && req.type !== "fixed" && req.type !== "float") {
      FixedFloatClient.refuse(`type must be "fixed" or "float", got "${String(req.type)}"`);
    }
    const params: Record<string, unknown> = { from, to, amount };
    if (req.type !== undefined) params.type = req.type;
    if (req.addrTo !== undefined && req.addrTo.trim().length > 0) params.addrTo = req.addrTo.trim();
    if (req.addrRefund !== undefined && req.addrRefund.trim().length > 0) {
      params.addrRefund = req.addrRefund.trim();
    }
    if (req.extraTo !== undefined && req.extraTo.trim().length > 0) params.extraTo = req.extraTo.trim();
    return (await this.callRaw<FfOrder>("create", params)).data;
  }

  async getOrder(id: string): Promise<FfOrder> {
    if (typeof id !== "string" || id.trim().length === 0) {
      FixedFloatClient.refuse("order id is empty");
    }
    return (await this.callRaw<FfOrder>("order", { id: id.trim() })).data;
  }

  /** Emergency READ — the order's current emergency state. */
  async getEmergencyAction(id: string): Promise<Record<string, unknown>> {
    if (typeof id !== "string" || id.trim().length === 0) {
      FixedFloatClient.refuse("order id is empty");
    }
    return (await this.callRaw<Record<string, unknown>>("emergency", { id: id.trim() })).data;
  }

  /** Emergency WRITE — REFUND (needs address) / EXCHANGE (address forbidden). */
  async setEmergencyAction(action: EmergencyAction): Promise<Record<string, unknown>> {
    const verdict = validateEmergencyAction(action);
    if (!verdict.ok) {
      FixedFloatClient.refuse(`emergency action refused: ${verdict.reason}`);
    }
    const params: Record<string, unknown> = { id: action.id.trim(), choice: action.choice };
    if (action.choice === "REFUND") params.address = action.address!.trim();
    return (await this.callRaw<Record<string, unknown>>("emergency", params)).data;
  }
}
