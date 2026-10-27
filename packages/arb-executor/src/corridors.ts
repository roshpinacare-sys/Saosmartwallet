/**
 * packages/arb-executor — ETH/SOL corridor readiness (deliverable 3)
 * ====================================================================
 * The ETH/SOL execution lane is HONEST-GATED: it builds (types, signing
 * surface, quote rail) but refuses to run without vaulted keys — and in this
 * runtime NO ETH/SOL custody exists (no keys vaulted → KEYS-ABSENT-honest;
 * never faked, never a placeholder signer).
 *
 * Custody contract (documented, checked read-only):
 *   ETH  — /home/z/coord-work/vaults/eth-secrets/keys.enc (packages/vault store)
 *   SOL  — /home/z/coord-work/vaults/sol-secrets/keys.enc (packages/vault store)
 * Neither directory exists in this runtime (measured 2026-10-27). When the
 * owner vaults them, this module returns READY and the rail proceeds.
 */

import { existsSync, statSync } from "node:fs";

export const ETH_CUSTODY_DIR = "/home/z/coord-work/vaults/eth-secrets";
export const SOL_CUSTODY_DIR = "/home/z/coord-work/vaults/sol-secrets";

export interface CorridorReadiness {
  corridor: "ETH" | "SOL";
  status: "READY" | "KEYS-ABSENT-honest";
  detail: string;
  custodyDir: string;
  custodyPresent: boolean;
}

function inspect(corridor: "ETH" | "SOL", dir: string): CorridorReadiness {
  let present = false;
  let detail = "";
  try {
    if (existsSync(dir)) {
      const st = statSync(dir);
      if (!st.isDirectory()) {
        detail = "custody path exists but is not a directory — refusing (fail-honest)";
      } else if (!existsSync(`${dir}/keys.enc`)) {
        detail = "custody dir exists but holds no keys.enc vault store";
      } else {
        const mode = st.mode & 0o777;
        if (mode !== 0o700) {
          detail = `custody dir perms ${mode.toString(8)} ≠ 700 — refusing (fail-honest)`;
        } else {
          present = true;
          detail = "custody store present — rail may proceed (owner lever still required for any real-funds order)";
        }
      }
    } else {
      detail = "no custody directory exists in this runtime — no ETH/SOL keys are vaulted";
    }
  } catch (e) {
    detail = `custody unreadable: ${(e as Error).message.slice(0, 120)}`;
  }
  return {
    corridor,
    status: present ? "READY" : "KEYS-ABSENT-honest",
    detail,
    custodyDir: dir,
    custodyPresent: present,
  };
}

export function ethSolReadiness(): { eth: CorridorReadiness; sol: CorridorReadiness; executable: boolean } {
  const eth = inspect("ETH", ETH_CUSTODY_DIR);
  const sol = inspect("SOL", SOL_CUSTODY_DIR);
  return { eth, sol, executable: eth.status === "READY" && sol.status === "READY" };
}
