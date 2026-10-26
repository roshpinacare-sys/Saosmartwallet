/**
 * packages/hsm-runtime — CLI (bun packages/hsm-runtime/src/cli.ts)
 * =================================================================
 *   hsm-runtime --once              CI provability: measure health, produce a
 *                                   SIGN-ONLY proof receipt when READY, exit
 *                                   with the honest code (0/2/3/4/5).
 *   hsm-runtime --serve [--port N]  run the token-gated signing API (default
 *                                   port HSM_PORT or 3155). Prints one JSON
 *                                   listening line, then serves.
 *   hsm-runtime --help              usage.
 *
 * Exit codes for --once (all honest, all machine-checkable):
 *   0 READY — proof receipt produced      3 NO-KEYS — vault open, zero keys
 *   2 SEALED — vault unavailable          4 BLOCKED-AUTH — token unset
 *   5 PROOF-BLOCKED — keys exist but none can prove   1 unexpected/config
 *
 * Every printed line is JSON. No key material, no token value — sentinel laws
 * enforced by test.
 */

import { createHsmServer, listen } from "./server";
import { loadHsmConfig, DEFAULT_HSM_PORT, MODE, BROADCAST } from "./config";
import { HsmError, isHsmError } from "./errors";
import { measureHealth, type KeyMetaLike } from "./health";
import { HsmSigner, roleOf } from "./sign";
import type { SteemTransaction } from "../../chains/steem/src/transaction";
import type { CustomJsonOperation } from "../../chains/steem/src/operations";

export const PROOF_MESSAGE = "saos-hsm-ci-proof/v1";
export const PROOF_TX_TTL_SECONDS = 300;

export interface RunOnceOptions {
  env?: Record<string, string | undefined>;
  out: (line: string) => void;
  now?: number;
}

function pickProofKey(metadata: KeyMetaLike[]): KeyMetaLike | null {
  const ed = metadata.find((k) => k.type === "ed25519");
  if (ed) return ed;
  return (
    metadata.find((k) => k.type === "secp256k1-wif" && roleOf(k.meta as Record<string, unknown> | null) !== null) ??
    null
  );
}

function proofTransaction(now: number, account: string | undefined): SteemTransaction {
  const body: CustomJsonOperation = {
    required_auths: [],
    required_posting_auths: [account ?? "saos.hsm.runtime"],
    id: "saos-hsm-ci-proof",
    json: JSON.stringify({ v: 1, proof: PROOF_MESSAGE, mode: MODE }),
  };
  return {
    refBlockNum: 0,
    refBlockPrefix: 0,
    expiration: Math.floor(now / 1000) + PROOF_TX_TTL_SECONDS,
    operations: [{ name: "custom_json", body }],
  };
}

/** The CI proof path: measure, prove, exit honestly. */
export async function runOnce(options: RunOnceOptions): Promise<number> {
  const out = options.out;
  const now = options.now ?? Date.now();
  let config;
  try {
    config = loadHsmConfig(options.env ?? process.env);
  } catch (e) {
    out(JSON.stringify({ verdict: "CONFIG-ERROR", code: isHsmError(e) ? e.code : "HSM_E_BAD_INPUT", reason: (e as Error).message }));
    return 1;
  }

  let signer: HsmSigner | null = null;
  let vaultReason: string | null = null;
  let metadata: KeyMetaLike[] | null = null;
  try {
    signer = await HsmSigner.open({ vaultDir: config.vaultDir });
    metadata = signer.metadata();
  } catch (e) {
    const m = /code ([A-Z_0-9]+)\)/.exec((e as Error).message);
    vaultReason = m ? m[1] : isHsmError(e) ? e.code : "VAULT_E_STORE_CORRUPT";
  }

  const health = measureHealth({
    vaultOpen: signer !== null,
    vaultReason,
    tokenSet: config.token !== null,
    keyMetadata: metadata,
    startedAt: now,
    now,
  });
  out(JSON.stringify(health));

  if (health.signing === "BLOCKED-VAULT" || health.vault === "SEALED") return 2;
  if (health.signing === "BLOCKED-AUTH") return 4;
  if (health.signing === "NO-KEYS") return 3;

  // signing === READY → produce the deterministic SIGN-ONLY proof receipt.
  const key = pickProofKey(metadata!);
  if (key === null) {
    out(JSON.stringify({ proof: "BLOCKED", reason: "HSM_E_ROLE_POLICY", note: "keys exist but none carries role metadata" }));
    return 5;
  }
  try {
    let receipt;
    if (key.type === "ed25519") {
      receipt = await signer!.signBytes({
        keyId: key.id,
        message: Buffer.from(PROOF_MESSAGE, "utf8"),
        now,
      });
    } else {
      const account = typeof (key.meta as Record<string, unknown> | null)?.account === "string"
        ? ((key.meta as Record<string, unknown>).account as string)
        : undefined;
      receipt = await signer!.signSteemFamily({
        chain: "steem",
        tx: proofTransaction(now, account),
        keyId: key.id,
        blurtChainIdHex: config.blurtChainIdHex,
        now,
      });
    }
    out(JSON.stringify(receipt));
    return 0;
  } catch (e) {
    out(
      JSON.stringify({
        proof: "BLOCKED",
        reason: isHsmError(e) ? e.code : "HSM_E_BAD_INPUT",
        detail: (e as Error).message.slice(0, 200),
      }),
    );
    return 5;
  }
}

const USAGE = `saos-hsm-runtime — production signing runtime (SIGN-ONLY)

usage:
  bun packages/hsm-runtime/src/cli.ts --once            measure + proof receipt (CI)
  bun packages/hsm-runtime/src/cli.ts --serve           run the token-gated signing API
  bun packages/hsm-runtime/src/cli.ts --help            this text

env: HSM_VAULT_DIR  HSM_SIGNING_TOKEN  HSM_PORT  HSM_BLURT_CHAIN_ID
     (vault master key stays inside packages/vault: SAOS_VAULT_MASTER_KEY)`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.includes("--once")) {
    const code = await runOnce({ out: (l) => console.log(l) });
    return code;
  }
  if (argv.includes("--serve")) {
    const config = loadHsmConfig(process.env);
    const portFlag = argv.indexOf("--port");
    const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : config.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new HsmError("HSM_E_BAD_INPUT", `--port must be an integer 1..65535 (default ${DEFAULT_HSM_PORT})`);
    }
    const startedAt = Date.now();
    const server = createHsmServer({ config, startedAt, now: () => Date.now() });
    const bound = await listen(server, port);
    console.log(
      JSON.stringify({
        event: "listening",
        service: "saos-hsm-runtime/1",
        mode: MODE,
        broadcast: BROADCAST,
        port: bound,
        armed: config.token !== null,
        vaultDir: config.vaultDir,
      }),
    );
    // Serve until terminated; the honest verdicts live behind GET /status.
    await new Promise<void>(() => undefined);
    return 0; // unreachable — kept for the type checker
  }
  console.log(USAGE);
  return 2;
}

if (import.meta.main) {
  main().then((code) => {
    process.exitCode = code;
  });
}
