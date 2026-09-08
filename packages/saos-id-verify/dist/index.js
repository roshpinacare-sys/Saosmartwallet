/* saos-id-verify — official TypeScript client for the SAOS metered
 * Identity Verification API (Model 1, shipped 2026-09-08).
 *
 * What the endpoint proves (same math as the public PROOFS demo):
 *   one secp256k1 scalar → Steem + Hive (+Blurt per the on-chain claim) + EVM,
 *   with on-chain anchor evidence (custom_json saos.id.v1, EIP-191 recovery).
 *
 * What this client adds:
 *   Bearer key auth, UTC-day quota visibility (X-RateLimit-* headers +
 *   meta.quota), typed PROVEN / FAILED outcomes, and fail-closed error
 *   classes. Zero dependencies — plain fetch (Node ≥18, Bun, Deno, browsers,
 *   edge runtimes).
 *
 * Honesty notes (kept from the shipped API):
 *   - A 200 + ok:false is a REAL measurement that failed — it is metered
 *     (quota consumed) because the service did real on-chain work.
 *   - The 429 branch is coded per spec (quota gate + X-RateLimit-Reset) but
 *     was not live-burned with 1,000 calls; see docs/what-we-can-do-now.md.
 *   - `baseUrl` is REQUIRED — no fictional default endpoint is assumed.
 */
/* ───────────────────────────── Errors ───────────────────────────── */
export class SaosError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "SaosError";
        if (status !== undefined)
            this.status = status;
    }
}
/** 401 — API key missing, malformed, or revoked. The API is fail-closed. */
export class SaosAuthError extends SaosError {
    constructor(message) {
        super(message, 401);
        this.name = "SaosAuthError";
    }
}
/** 429 — UTC-day quota exhausted. `retryAt` = epoch seconds when quota resets. */
export class SaosQuotaError extends SaosError {
    constructor(message, retryAt) {
        super(message, 429);
        this.name = "SaosQuotaError";
        this.retryAt = retryAt;
    }
}
/** Any other non-OK HTTP status. `body` holds the parsed response if any. */
export class SaosApiError extends SaosError {
    constructor(message, status, body) {
        super(message, status);
        this.name = "SaosApiError";
        this.body = body;
    }
}
/** The request never completed (network failure, timeout, abort). */
export class SaosNetworkError extends SaosError {
    constructor(message, underlying) {
        super(message);
        this.name = "SaosNetworkError";
        this.underlying = underlying;
    }
}
export class SaosIdentity {
    constructor(opts) {
        if (typeof opts.apiKey !== "string" || opts.apiKey.length === 0) {
            throw new SaosError("apiKey is required (format saos_live_…)");
        }
        if (typeof opts.baseUrl !== "string" || opts.baseUrl.length === 0) {
            throw new SaosError("baseUrl is required — no default endpoint is assumed");
        }
        this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
        this.apiKey = opts.apiKey;
        this.timeoutMs = opts.timeoutMs ?? 30000;
        this.fetchImpl = opts.fetch ?? globalThis.fetch?.bind(globalThis);
        if (typeof this.fetchImpl !== "function") {
            throw new SaosError("no fetch implementation available (Node <18?) — pass opts.fetch");
        }
    }
    /**
     * Verify a Graphene identity against its on-chain SAOS anchor.
     * Throws SaosAuthError (401), SaosQuotaError (429), SaosApiError (other
     * non-OK), SaosNetworkError (transport). PROVEN / FAILED come back as a
     * typed 200 union — a FAILED verdict is a real, metered measurement.
     */
    async verify(username) {
        if (typeof username !== "string" || username.length === 0) {
            throw new SaosError("username is required");
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await this.fetchImpl(`${this.baseUrl}/api/v1/identity/verify`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ username }),
                signal: controller.signal,
                cache: "no-store",
            });
            const rateLimit = parseRateLimit(res.headers);
            if (res.status === 401) {
                const body = await safeJson(res);
                throw new SaosAuthError(readErrorMessage(body, "unauthorized: check your API key"));
            }
            if (res.status === 429) {
                const body = await safeJson(res);
                throw new SaosQuotaError(readErrorMessage(body, "daily quota exhausted"), rateLimit.resetAt);
            }
            if (!res.ok) {
                const body = await safeJson(res);
                throw new SaosApiError(`API returned ${res.status}`, res.status, body);
            }
            const body = await safeJson(res);
            if (isRecord(body) && body.ok === true) {
                return { ...body, rateLimit };
            }
            if (isRecord(body) && body.ok === false) {
                return { ...body, rateLimit };
            }
            throw new SaosApiError("unexpected response body shape", res.status, body);
        }
        catch (err) {
            if (err instanceof SaosError)
                throw err;
            const msg = err instanceof Error ? err.message : String(err);
            throw new SaosNetworkError(`request failed: ${msg}`, err);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
/** One-shot helper — the 3-line integration path. */
export async function verifyIdentity(opts) {
    const { username, ...rest } = opts;
    return new SaosIdentity(rest).verify(username);
}
/* ───────────────────────────── Internals ───────────────────────────── */
function parseRateLimit(h) {
    const num = (v) => {
        if (v === null)
            return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    return {
        limit: num(h.get("x-ratelimit-limit")),
        remaining: num(h.get("x-ratelimit-remaining")),
        resetAt: num(h.get("x-ratelimit-reset")),
    };
}
async function safeJson(res) {
    try {
        return await res.json();
    }
    catch {
        return undefined;
    }
}
function isRecord(v) {
    return typeof v === "object" && v !== null;
}
function readErrorMessage(body, fallback) {
    return isRecord(body) && typeof body.error === "string" ? body.error : fallback;
}
