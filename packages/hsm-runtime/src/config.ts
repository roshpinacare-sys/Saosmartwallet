/**
 * packages/hsm-runtime — configuration
 * =====================================
 * Everything arrives from the environment; the runtime holds PATHS and
 * VERDICTS, never key material. The vault master key stays inside
 * packages/vault (SAOS_VAULT_MASTER_KEY, read there, never copied here).
 *
 *   HSM_VAULT_DIR        — vault store directory (path only; REQUIRED for
 *                          any signing capability; unset ⇒ SEALED honestly)
 *   HSM_SIGNING_TOKEN    — Bearer token for the gated API; unset ⇒ the API
 *                          never arms (deny-by-default, fail-closed)
 *   HSM_PORT             — listen port (default 3155)
 *   HSM_BLURT_CHAIN_ID   — 64-hex blurt mainnet chain id; REQUIRED for blurt
 *                          signing; blurt's public RPC exposes no get_chain_id
 *                          so the runtime refuses to guess (same doctrine as
 *                          packages/chains/blurt)
 */

import { HsmError } from "./errors";

export const DEFAULT_HSM_PORT = 3155;
export const SERVICE_NAME = "saos-hsm-runtime/1";
export const MODE = "SIGN-ONLY" as const;
export const BROADCAST = "DISABLED" as const;

export interface HsmConfig {
  /** Vault store directory — path only. null ⇒ vault SEALED by construction. */
  vaultDir: string | null;
  /** Gated-API token. null ⇒ deny-by-default (HSM_E_TOKEN_UNSET everywhere). */
  token: string | null;
  /** Listen port. */
  port: number;
  /** Validated 64-hex blurt chain id, or null (blurt signing refused). */
  blurtChainIdHex: string | null;
}

function readStr(env: Record<string, string | undefined>, name: string): string | null {
  const v = env[name];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** Loads + validates the runtime configuration from an env map (pure). */
export function loadHsmConfig(env: Record<string, string | undefined> = process.env): HsmConfig {
  const vaultDir = readStr(env, "HSM_VAULT_DIR");

  const portRaw = readStr(env, "HSM_PORT") ?? String(DEFAULT_HSM_PORT);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HsmError("HSM_E_BAD_INPUT", `HSM_PORT must be an integer 1..65535, got "${portRaw.slice(0, 16)}"`);
  }

  let blurtChainIdHex: string | null = null;
  const blurtRaw = readStr(env, "HSM_BLURT_CHAIN_ID");
  if (blurtRaw !== null) {
    if (!/^[0-9a-fA-F]{64}$/.test(blurtRaw)) {
      throw new HsmError("HSM_E_CHAIN_ID", "HSM_BLURT_CHAIN_ID must be exactly 64 hex chars (32 bytes)");
    }
    blurtChainIdHex = blurtRaw.toLowerCase();
  }

  return {
    vaultDir,
    token: readStr(env, "HSM_SIGNING_TOKEN"),
    port,
    blurtChainIdHex,
  };
}
