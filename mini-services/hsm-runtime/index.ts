/**
 * mini-services/hsm-runtime — the DEPLOYED production HSM signing runtime
 * ========================================================================
 * Owner directive §3 (UNBLOCK Saosmartwallet PRODUCTION): this entry turns
 * packages/hsm-runtime into a running, measured, deny-by-default mini-service.
 *
 * Mini-service law (this sandbox, honored):
 *   • independent package.json (this directory), entry index.ts (this file);
 *   • run with `bun --hot index.ts`;
 *   • declared fixed port: 3057 (3056 is occupied by the estate's
 *     local-gates-host — measured 2026-10-26T15:24Z, untouched per scope law);
 *   • logs to a file: state/runtime.log (structured, fingerprints only) —
 *     the boot wrapper additionally tees stdout to /home/z/audit/hsm-runtime.log;
 *   • state in state/ (gitignored): keys.enc (sealed envelopes) + audit.jsonl.
 *
 * Custody (all outside the tree, all 0600, all fail-closed):
 *   • /home/z/coord-work/vaults/saosmartwallet/master.key  → scrypt → vault master
 *   • /home/z/coord-work/vaults/saosmartwallet/runtime.env → HSM_RUNTIME_TOKEN
 *
 * The process NEVER prints, logs, or returns key material — signing keys are
 * unsealed only inside the sign call and zero-filled after (packages/vault law).
 */

import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  createHsmHandler,
  fingerprintOfKeyFile,
  loadMasterKeyFromKeyFile,
  HashChainAudit,
  HsmKeyring,
  HSM_SERVICE_NAME,
  HSM_SERVICE_VERSION,
} from "../../packages/hsm-runtime/src/index";

const CUSTODY_DIR = "/home/z/coord-work/vaults/saosmartwallet";
const MASTER_KEY_PATH = `${CUSTODY_DIR}/master.key`;
const RUNTIME_ENV_PATH = `${CUSTODY_DIR}/runtime.env`;
const DECLARED_PORT = 3057; // fixed port law — 3056 measured occupied (gates), untouched

const HERE = import.meta.dir;
const STATE_DIR = join(HERE, "state");

function readTokenFromRuntimeEnv(path: string): string {
  const st = statSync(path); // throws → fail-closed boot
  if ((st.mode & 0o777) !== 0o600) {
    throw new Error(`HSM_E_RUNTIME_ENV_PERMS — runtime.env perms are ${st.mode & 0o777}, must be exactly 600`);
  }
  const raw = readFileSync(path, "utf8");
  const line = raw.split("\n").find((l) => l.startsWith("HSM_RUNTIME_TOKEN="));
  if (!line) throw new Error("HSM_E_RUNTIME_ENV_MISSING — HSM_RUNTIME_TOKEN not present in runtime.env");
  const token = line.slice("HSM_RUNTIME_TOKEN=".length).trim();
  if (token.length < 32) throw new Error("HSM_E_RUNTIME_ENV_WEAK — HSM_RUNTIME_TOKEN must be ≥32 chars");
  return token;
}

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  try {
    appendFileSync(join(STATE_DIR, "runtime.log"), stamped + "\n", { mode: 0o600 });
  } catch {
    // state dir always exists by boot order; a log write failure must not
    // kill the signing loop — console (→ /home/z/audit/hsm-runtime.log) still has it.
  }
}

// --- boot ----------------------------------------------------------------
mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

const token = readTokenFromRuntimeEnv(RUNTIME_ENV_PATH);
const masterHex = loadMasterKeyFromKeyFile(MASTER_KEY_PATH);
process.env.SAOS_VAULT_MASTER_KEY = masterHex;
const custodyFingerprint = fingerprintOfKeyFile(MASTER_KEY_PATH);

const bootAt = new Date().toISOString();
const storeDir = STATE_DIR;
const ring = await HsmKeyring.open({ storeDir });
const audit = new HashChainAudit(join(storeDir, "audit.jsonl"));
const chainOk = audit.verify();

audit.append("boot", {
  service: HSM_SERVICE_NAME,
  version: HSM_SERVICE_VERSION,
  port: DECLARED_PORT,
  custodyFingerprint,
  keyCount: ring.listKeys().length,
  auditChainOkBeforeBoot: chainOk.ok,
});

const deps = {
  ring,
  audit,
  token,
  bootedAt: bootAt,
  version: HSM_SERVICE_VERSION,
};

const handler = createHsmHandler(deps);

const server = Bun.serve({
  port: DECLARED_PORT,
  hostname: "127.0.0.1", // sovereign device-local; exposure is the deployer's explicit decision
  fetch: handler,
});

log(
  `boot service=${HSM_SERVICE_NAME} v${HSM_SERVICE_VERSION} port=${server.port} ` +
    `keys=${ring.listKeys().length} custody=${custodyFingerprint} auditChain=${chainOk.ok}`,
);
for (const k of ring.listKeys()) {
  log(`key id=${k.id} curve=${k.curve} fingerprint=${k.fingerprint}`); // fingerprints only — NEVER material
}

process.on("SIGTERM", () => {
  audit.append("shutdown", { reason: "SIGTERM" });
  log("shutdown reason=SIGTERM");
  server.stop(true);
  process.exit(0);
});
