/**
 * packages/hsm-runtime — the HTTP service (node:http, zero new deps)
 * ===================================================================
 * Surface (deny-by-default):
 *
 *   GET  /health      liveness ONLY — bare shape, zero operational data
 *   GET  /status      Bearer-gated — full measured verdicts per capability
 *   POST /keys        Bearer-gated — metadata-only vault listing
 *   POST /sign/steem  Bearer-gated — steem-family signing → receipt
 *   POST /sign/bytes  Bearer-gated — ed25519 signing → receipt
 *
 * There is NO broadcast route. POST /broadcast is a 404 — the side-effect law
 * is structural, not a flag. Auth failures never leak whether a token is
 * "close" (constant-time compare). Bodies are bounded (256KB → 413). Every
 * error answers a stable JSON {error:{code,message}} — never a 500.
 */

import http from "node:http";

import { authorizeToken } from "./auth";
import { BROADCAST, MODE, SERVICE_NAME, type HsmConfig } from "./config";
import { HsmError, isHsmError, type HsmErrorCode } from "./errors";
import { bareHealth, measureHealth, type HealthState } from "./health";
import { HsmSigner } from "./sign";
import type { KeyMetaLike } from "./health";

const MAX_BODY_BYTES = 256 * 1024;

export interface HsmServerDeps {
  config: HsmConfig;
  startedAt: number;
  now(): number;
}

interface RuntimeState {
  signer: HsmSigner | null;
  vaultOpen: boolean;
  vaultReason: string | null;
  keyMetadata: KeyMetaLike[] | null;
}

function statusFor(code: HsmErrorCode): number {
  switch (code) {
    case "HSM_E_AUTH_MISSING":
      return 401;
    case "HSM_E_AUTH_INVALID":
      return 403;
    case "HSM_E_TOKEN_UNSET":
    case "HSM_E_VAULT_SEALED":
      return 503;
    case "HSM_E_BODY_TOO_LARGE":
      return 413;
    case "HSM_E_NOT_FOUND":
      return 404;
    case "HSM_E_METHOD":
      return 405;
    case "HSM_E_BAD_INPUT":
      return 400;
    default:
      return 422; // unknown key / key type / role policy / chain id
  }
}

function errorBody(e: unknown): { error: { code: string; message: string } } {
  if (isHsmError(e)) {
    return { error: { code: e.code, message: e.message } };
  }
  return { error: { code: "HSM_E_BAD_INPUT", message: e instanceof Error ? e.message : "refused" } };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering but DRAIN the socket so the 413 response can still
        // be delivered (destroying mid-upload resets the connection instead).
        chunks.length = 0;
        req.removeAllListeners("data");
        req.resume();
        reject(new HsmError("HSM_E_BODY_TOO_LARGE", `body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (err) => reject(err));
  });
}

/**
 * Boots the runtime state (lazily opens the vault on first gated use) and
 * returns the server. The vault path comes from config.vaultDir — never a
 * key, never an inline secret.
 */
export function createHsmServer(deps: HsmServerDeps): http.Server {
  const state: RuntimeState = { signer: null, vaultOpen: false, vaultReason: null, keyMetadata: null };

  async function ensureVault(): Promise<void> {
    if (state.signer !== null || state.vaultReason !== null) return;
    try {
      const signer = await HsmSigner.open({ vaultDir: deps.config.vaultDir });
      state.signer = signer;
      state.vaultOpen = true;
      state.vaultReason = null;
      state.keyMetadata = signer.metadata();
    } catch (e) {
      const code = isHsmError(e) ? e.code : "HSM_E_VAULT_SEALED";
      const m = /code ([A-Z_0-9]+)\)/.exec((e as Error).message);
      state.vaultReason = m ? m[1] : code === "HSM_E_VAULT_SEALED" ? "HSM_VAULT_DIR-unset" : code;
      throw e;
    }
  }

  function healthNow(): HealthState {
    return measureHealth({
      vaultOpen: state.vaultOpen,
      vaultReason: state.vaultReason,
      tokenSet: deps.config.token !== null,
      keyMetadata: state.keyMetadata,
      startedAt: deps.startedAt,
      now: deps.now(),
    });
  }

  function send(res: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "x-saos-service": SERVICE_NAME,
      "cache-control": "no-store",
    });
    res.end(body);
  }

  async function gated(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    handler: () => Promise<unknown>,
  ): Promise<void> {
    try {
      authorizeToken(req.headers.authorization ?? null, deps.config.token);
      await handler().then((payload) => send(res, 200, payload));
    } catch (e) {
      send(res, statusFor(isHsmError(e) ? e.code : "HSM_E_BAD_INPUT"), errorBody(e));
    }
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = (req.method ?? "GET").toUpperCase();

    if (path === "/health" && method === "GET") {
      send(res, 200, bareHealth(healthNow()));
      return;
    }

    if (path === "/status") {
      if (method !== "GET") {
        send(res, 405, errorBody(new HsmError("HSM_E_METHOD", "use GET /status")));
        return;
      }
      void gated(req, res, async () => {
        await ensureVault();
        return healthNow();
      });
      return;
    }

    if (path === "/keys") {
      if (method !== "POST") {
        send(res, 405, errorBody(new HsmError("HSM_E_METHOD", "use POST /keys")));
        return;
      }
      void gated(req, res, async () => {
        await ensureVault();
        return { keys: state.signer?.metadata() ?? [] };
      });
      return;
    }

    if (path === "/sign/steem") {
      if (method !== "POST") {
        send(res, 405, errorBody(new HsmError("HSM_E_METHOD", "use POST /sign/steem")));
        return;
      }
      void gated(req, res, async () => {
        await ensureVault();
        const raw = await readBody(req);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new HsmError("HSM_E_BAD_INPUT", "body is not valid JSON");
        }
        const b = (parsed ?? {}) as Record<string, unknown>;
        const chain = b.chain === "blurt" ? "blurt" : b.chain === "steem" ? "steem" : null;
        if (chain === null) {
          throw new HsmError("HSM_E_BAD_INPUT", 'body.chain must be "steem" or "blurt"');
        }
        if (typeof b.keyId !== "string" || b.keyId.length === 0) {
          throw new HsmError("HSM_E_BAD_INPUT", "body.keyId must be a non-empty string");
        }
        if (typeof b.tx !== "object" || b.tx === null) {
          throw new HsmError("HSM_E_BAD_INPUT", "body.tx must be the unsigned transaction object");
        }
        return state.signer!.signSteemFamily({
          chain,
          tx: b.tx as Parameters<HsmSigner["signSteemFamily"]>[0]["tx"],
          keyId: b.keyId,
          blurtChainIdHex: deps.config.blurtChainIdHex,
          now: deps.now(),
        });
      });
      return;
    }

    if (path === "/sign/bytes") {
      if (method !== "POST") {
        send(res, 405, errorBody(new HsmError("HSM_E_METHOD", "use POST /sign/bytes")));
        return;
      }
      void gated(req, res, async () => {
        await ensureVault();
        const raw = await readBody(req);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new HsmError("HSM_E_BAD_INPUT", "body is not valid JSON");
        }
        const b = (parsed ?? {}) as Record<string, unknown>;
        if (typeof b.keyId !== "string" || b.keyId.length === 0) {
          throw new HsmError("HSM_E_BAD_INPUT", "body.keyId must be a non-empty string");
        }
        if (typeof b.messageHex !== "string" || b.messageHex.length === 0 || b.messageHex.length % 2 !== 0) {
          throw new HsmError("HSM_E_BAD_INPUT", "body.messageHex must be a non-empty even-length hex string");
        }
        if (!/^[0-9a-fA-F]*$/.test(b.messageHex)) {
          throw new HsmError("HSM_E_BAD_INPUT", "body.messageHex must be hex");
        }
        return state.signer!.signBytes({
          keyId: b.keyId,
          message: Buffer.from(b.messageHex, "hex"),
          now: deps.now(),
        });
      });
      return;
    }

    // /broadcast deliberately does NOT exist — a 404 is the honest answer.
    send(res, 404, {
      error: {
        code: "HSM_E_NOT_FOUND",
        message: `no route ${method} ${path} — this runtime signs only (mode ${MODE}, broadcast ${BROADCAST}) and never broadcasts`,
      },
    });
  });
}

/** Binds a declared port; rejects honestly (no retry storm) on failure. */
export function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.close();
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, () => {
      server.removeListener("error", onError);
      const addr = server.address();
      const bound = typeof addr === "object" && addr !== null ? addr.port : port;
      resolve(bound);
    });
  });
}

/** Test helper — binds an ephemeral port and resolves the base URL. */
export async function listenOnEphemeralPort(server: http.Server): Promise<string> {
  const port = await listen(server, 0);
  return `http://127.0.0.1:${port}`;
}

// The tested pure-handler seam (test/hsm-runtime.test.ts drives this contract
// directly; createHsmServer above is the node:http shell over the same laws).
export {
  createHsmHandler,
  HSM_SERVICE_NAME,
  HSM_SERVICE_VERSION,
  type HsmDeps,
  type HsmHandler,
} from "./handler";
