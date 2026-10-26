/**
 * Saosmartwallet packages/hsm-runtime — the deny-by-default HTTP handler
 * =======================================================================
 * The production signing surface. FOUR routes exist; everything else is a
 * bare 404. The auth plane (constant-time bearer law) gates /status, /sign
 * and /keys:
 *
 *   • NO token  → 503 HSM_E_AUTH_REQUIRED (fail-closed: an unauthenticated
 *     caller must not be able to distinguish "authenticated service" from
 *     "unavailable" — 503 says the service is not answerable, full stop).
 *   • WRONG token → 401 HSM_E_AUTH_INVALID (constant-time comparison).
 *   • BAD SHAPE  → 400 HSM_E_BAD_REQUEST (no keyId / no payload / bad JSON).
 *   • UNKNOWN KEY → 404 HSM_E_UNKNOWN_KEY (no existence oracle for keys).
 *
 * /health is bare liveness: {"ok":true} — zero operational data, zero keys,
 * zero counts, zero version strings. A port scanner learns nothing.
 *
 * Every successful /sign appends exactly one hash-chained audit event with
 * fingerprints + payload DIGEST only. Auth denials are counted in memory
 * (exposed via /status as denyCount) — deliberately NOT written to disk, so
 * an unauthenticated flood cannot fill the audit store (a documented,
 * honest trade-off: the count is visible, the flood is inert).
 */

import { createHash } from "node:crypto";

import { constantTimeEqual, extractBearerToken } from "./token";
import type { HashChainAudit } from "./audit";
import type { HsmKeyring, HsmKeyringError } from "./keyring";

export const HSM_SERVICE_NAME = "saosmartwallet-hsm-runtime";
export const HSM_SERVICE_VERSION = "1.0.0";

export interface HsmDeps {
  ring: HsmKeyring;
  audit: HashChainAudit;
  /** The bearer token (from HSM_RUNTIME_TOKEN — 0600 runtime.env, outside git). */
  token: string;
  bootedAt: string;
  version?: string;
  /** Injectable clock (tests); defaults to wall time. */
  now?: () => Date;
}

const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MiB — a signing oracle is not a data pipe
const MAX_KEYID_CHARS = 512;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The auth gate: 503 (absent) / 401 (wrong) / null (authenticated). */
function authGate(deps: HsmDeps, req: Request, denyCount: { n: number }): Response | null {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (token === null) {
    denyCount.n += 1;
    return json(503, { error: "HSM_E_AUTH_REQUIRED" });
  }
  if (!constantTimeEqual(token, deps.token)) {
    denyCount.n += 1;
    return json(401, { error: "HSM_E_AUTH_INVALID" });
  }
  return null;
}

export type HsmHandler = (req: Request) => Promise<Response>;

export function createHsmHandler(deps: HsmDeps): HsmHandler {
  const denyCount = { n: 0 };
  const now = deps.now ?? (() => new Date());

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // --- /health: bare liveness, UNAUTHENTICATED, zero operational data ----
    if (path === "/health") {
      if (req.method !== "GET") return json(405, { error: "HSM_E_METHOD" });
      return json(200, { ok: true });
    }

    // --- /status ------------------------------------------------------------
    if (path === "/status") {
      if (req.method !== "GET") return json(405, { error: "HSM_E_METHOD" });
      const denied = authGate(deps, req, denyCount);
      if (denied) return denied;
      return json(200, {
        ok: true,
        service: HSM_SERVICE_NAME,
        version: deps.version ?? HSM_SERVICE_VERSION,
        bootedAt: deps.bootedAt,
        keyCount: deps.ring.listKeys().length,
        denyCount: denyCount.n,
        audit: deps.audit.verify(),
      });
    }

    // --- /sign --------------------------------------------------------------
    if (path === "/sign") {
      if (req.method !== "POST") return json(405, { error: "HSM_E_METHOD" });
      const denied = authGate(deps, req, denyCount);
      if (denied) return denied;

      let parsed: unknown;
      try {
        const raw = await req.text();
        if (raw.length === 0 || raw.length > MAX_PAYLOAD_BYTES * 2) {
          return json(400, { error: "HSM_E_BAD_REQUEST" });
        }
        parsed = JSON.parse(raw);
      } catch {
        return json(400, { error: "HSM_E_BAD_REQUEST" });
      }
      const body = (parsed ?? {}) as { keyId?: unknown; payload?: unknown };
      if (typeof body.keyId !== "string" || body.keyId.length === 0 || body.keyId.length > MAX_KEYID_CHARS) {
        return json(400, { error: "HSM_E_BAD_REQUEST", detail: "keyId" });
      }
      if (typeof body.payload !== "string" || body.payload.length === 0) {
        return json(400, { error: "HSM_E_BAD_REQUEST", detail: "payload" });
      }
      const payload = Buffer.from(body.payload, "utf8");
      if (payload.length === 0 || payload.length > MAX_PAYLOAD_BYTES) {
        return json(400, { error: "HSM_E_BAD_REQUEST", detail: "payload-size" });
      }

      try {
        const sig = await deps.ring.sign(body.keyId, payload);
        const payloadSha256 = sha256Hex(payload);
        deps.audit.append("sign", {
          keyId: sig.keyId,
          algorithm: sig.algorithm,
          fingerprint: sig.fingerprint,
          payloadSha256,
        }, now);
        return json(200, {
          ok: true,
          keyId: sig.keyId,
          algorithm: sig.algorithm,
          signature: sig.signature,
          fingerprint: sig.fingerprint,
          payloadSha256,
          signedAt: sig.signedAt,
        });
      } catch (err) {
        if ((err as HsmKeyringError)?.name === "HsmKeyringError") {
          const msg = (err as Error).message;
          if (msg.startsWith("HSM_E_UNKNOWN_KEY") || msg.startsWith("HSM_E_WRONG_CURVE")) {
            return json(404, { error: "HSM_E_UNKNOWN_KEY" });
          }
          return json(400, { error: "HSM_E_BAD_REQUEST" });
        }
        return json(500, { error: "HSM_E_INTERNAL" });
      }
    }

    // --- /keys --------------------------------------------------------------
    if (path === "/keys") {
      if (req.method !== "GET") return json(405, { error: "HSM_E_METHOD" });
      const denied = authGate(deps, req, denyCount);
      if (denied) return denied;
      return json(200, {
        ok: true,
        keys: deps.ring.listKeys().map((k) => ({
          id: k.id,
          curve: k.curve,
          publicKey: k.publicKey,
          fingerprint: k.fingerprint,
          createdAt: k.createdAt,
        })),
      });
    }

    // --- everything else: bare deny -----------------------------------------
    return json(404, { error: "HSM_E_NOT_FOUND" });
  };
}
