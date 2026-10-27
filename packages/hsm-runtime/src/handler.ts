/**
 * packages/hsm-runtime — the deny-by-default request handler (the TESTED seam)
 * ==============================================================================
 * The production HSM law suite (test/hsm-runtime.test.ts) pins a pure
 * Request→Response handler contract — this module IS that contract:
 *
 *   createHsmHandler(deps)(Request) → Promise<Response>
 *
 *   GET  /health   200 {ok:true} — bare liveness, ZERO operational data
 *   GET  /status   Bearer-gated — {ok, service, version, keyCount, bootedAt}
 *   GET  /keys     Bearer-gated — fingerprints + public keys only
 *   POST /sign     Bearer-gated — {keyId, payload} → {signature, fingerprint,
 *                  algorithm}; exactly one hash-chained audit event per sign;
 *                  the payload is NEVER echoed, never audited in plaintext.
 *
 * Laws (mirroring the node server, single source of truth = the suite):
 *   • missing token ⇒ 503 {error:"HSM_E_AUTH_REQUIRED"} — an unauthenticated
 *     caller must never learn the service exists in an authenticated mode;
 *   • wrong token ⇒ 401 (constant-time compare — never leak "closeness");
 *   • bad shape ⇒ 400, unknown key ⇒ 404, wrong method ⇒ 405, unknown path
 *     ⇒ 404 deny;
 *   • every response sweeps clean of material-shaped fields ("material",
 *     "seed", "ciphertext", "authTag") — the canary in the suite enforces it.
 *
 * The node:http transport (createHsmServer) stays the deployable shell; this
 * handler is the pure core both the shell and the tests drive.
 */

import { createHash } from "node:crypto";

import { HsmError } from "./errors";
import { SERVICE_NAME } from "./config";
import { constantTimeEqual, extractBearerToken } from "./token";
import type { HsmKeyring, HsmSignature } from "./keyring";
import type { HashChainAudit } from "./audit";

/** The service identity constants of the production HSM runtime. */
export const HSM_SERVICE_NAME = SERVICE_NAME;
export const HSM_SERVICE_VERSION = "1.0.0";

/** Maximum accepted request body — 256KB, mirroring the node server law. */
const MAX_BODY_BYTES = 256 * 1024;

export interface HsmDeps {
  /** Opened, sealed keyring (sign/verify/listKeys — custody already proven). */
  ring: HsmKeyring;
  /** Hash-chained audit sink — every successful sign appends exactly one event. */
  audit: HashChainAudit;
  /** Bearer token — constant-time compared; empty/never-set ⇒ fail-closed 503. */
  token: string;
  /** Printable boot timestamp surfaced by /status. */
  bootedAt: string;
  /** Runtime version surfaced by /status. */
  version: string;
}

export type HsmHandler = (req: Request) => Promise<Response>;

interface FlatError {
  error: string;
  message?: string;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-saos-service": HSM_SERVICE_NAME,
      "cache-control": "no-store",
    },
  });
}

function fail(status: number, code: string, message?: string): Response {
  const body: FlatError = { error: code };
  if (message !== undefined) body.message = message;
  return json(status, body);
}

/** The auth gate: 503 (missing/unset) → 401 (wrong) → null (authorized). */
function authGate(req: Request, token: string): Response | null {
  if (token.length === 0) return fail(503, "HSM_E_TOKEN_UNSET");
  const presented = extractBearerToken(req.headers.get("authorization"));
  if (presented === null) return fail(503, "HSM_E_AUTH_REQUIRED");
  if (!constantTimeEqual(presented, token)) return fail(401, "HSM_E_AUTH_INVALID");
  return null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new HsmError("HSM_E_BODY_TOO_LARGE", "body exceeds 256KB");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function createHsmHandler(deps: HsmDeps): HsmHandler {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = (req.method ?? "GET").toUpperCase();

    // /health — bare liveness, no auth gate, zero operational data.
    if (path === "/health") {
      if (method !== "GET") return fail(405, "HSM_E_METHOD", "use GET /health");
      return json(200, { ok: true });
    }

    // /status — Bearer-gated measured verdict, counts and fingerprints only.
    if (path === "/status") {
      const denied = authGate(req, deps.token);
      if (denied !== null) return denied;
      if (method !== "GET") return fail(405, "HSM_E_METHOD", "use GET /status");
      return json(200, {
        ok: true,
        service: HSM_SERVICE_NAME,
        version: deps.version,
        keyCount: deps.ring.listKeys().length,
        bootedAt: deps.bootedAt,
      });
    }

    // /keys — Bearer-gated metadata listing (the ring itself enforces the
    // fingerprint/pubkey-only law; the canary sweeps the serialized body).
    if (path === "/keys") {
      const denied = authGate(req, deps.token);
      if (denied !== null) return denied;
      if (method !== "GET" && method !== "POST") return fail(405, "HSM_E_METHOD", "use GET /keys");
      return json(200, { ok: true, keys: deps.ring.listKeys() });
    }

    // /sign — Bearer-gated raw signing over the sealed keyring.
    if (path === "/sign") {
      const denied = authGate(req, deps.token);
      if (denied !== null) return denied;
      if (method !== "POST") return fail(405, "HSM_E_METHOD", "use POST /sign");

      let body: Record<string, unknown> | null;
      try {
        body = await readJson(req);
      } catch {
        return fail(413, "HSM_E_BODY_TOO_LARGE");
      }
      if (body === null) return fail(400, "HSM_E_BAD_INPUT", "expected a JSON object body");

      const keyId = body["keyId"];
      const payload = body["payload"];
      if (typeof keyId !== "string" || keyId.length === 0) {
        return fail(400, "HSM_E_BAD_INPUT", "keyId (string) is required");
      }
      if (typeof payload !== "string" || payload.length === 0) {
        return fail(400, "HSM_E_BAD_INPUT", "payload (non-empty string) is required");
      }

      const known = deps.ring.listKeys().find((k) => k.id === keyId);
      if (known === undefined) return fail(404, "HSM_E_UNKNOWN_KEY", keyId);

      let sig: HsmSignature;
      try {
        sig = await deps.ring.sign(keyId, Buffer.from(payload, "utf8"));
      } catch (e) {
        return fail(503, "HSM_E_VAULT_SEALED", (e as Error).message.slice(0, 120));
      }

      // Exactly one chained audit event per sign — hashes and fingerprints
      // only; the raw payload never enters the trail.
      deps.audit.append("hsm.sign", {
        keyId,
        fingerprint: sig.fingerprint,
        algorithm: sig.algorithm,
        payloadHash: createHash("sha256").update(payload, "utf8").digest("hex"),
      });

      return json(200, {
        ok: true,
        signature: sig.signature,
        fingerprint: sig.fingerprint,
        algorithm: sig.algorithm,
      });
    }

    // Unknown path — deny, always.
    return fail(404, "HSM_E_NOT_FOUND", path);
  };
}
