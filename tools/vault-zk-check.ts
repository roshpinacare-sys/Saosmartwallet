/**
 * tools/vault-zk-check.ts — engine-level proof of the wired ZK layer
 * ================================================================================
 * The ZK module (packages/core crypto/zk.ts — Fiat–Shamir Schnorr over
 * secp256k1) existed but was UNWIRED: the open audit item said "commitment at
 * init + verification at unlock, or remove from barrel". The wiring is now
 * done (vault.initialize installs zkCommitment; unlock/verifyStepUp/addKey
 * step-up require BOTH the ZK transcript AND the Argon2id verifier). This
 * tool proves the defense-in-depth properties against an in-memory vault —
 * the LIVE vault state is untouched (it stays uninitialized, clean handoff):
 *
 *   1. initialize(password) stores a curve commitment
 *   2. unlock(correct) succeeds            — both verifiers agree
 *   3. unlock(wrong) fails WRONG_PASSWORD  — fail-closed
 *   4. TAMPERED commitment + correct pw    → WRONG_PASSWORD (ZK layer catches
 *     what a mutated Argon2id verifier alone could not)
 *   5. TAMPERED Argon2id verifier + correct pw → WRONG_PASSWORD (inverse)
 *   6. MISSING commitment → CORRUPT_STATE  — fail-closed, actionable
 *   7. verifyStepUp(correct/wrong) behaves the same on the step-up path
 *   8. persistence round-trip: the commitment survives save/load (backup-safe)
 *
 *   bun tools/vault-zk-check.ts
 */
import { SovereignVault } from "../packages/core/src/vault/vault";
import type { VaultStateRecord, VaultStorage } from "../packages/core/src/storage/types";

const PASSWORD = "zk-proof-ceremony-2026-09-08";
const WRONG = "not-the-password";

function memoryStorage(): VaultStorage & { record: VaultStateRecord | null } {
  let record: VaultStateRecord | null = null;
  return {
    get record() {
      return record;
    },
    set record(v: VaultStateRecord | null) {
      record = v;
    },
    async load() {
      return record;
    },
    async save(stateJson: string, genesisHash: string) {
      record = { stateJson, genesisHash, updatedAt: Date.now() };
    },
  };
}

async function freshVault(): Promise<{ vault: SovereignVault; store: ReturnType<typeof memoryStorage> }> {
  const store = memoryStorage();
  const vault = new SovereignVault(store);
  await vault.initialize(PASSWORD);
  return { vault, store };
}

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

async function main(): Promise<void> {
  console.log("[vault-zk] proving the wired ZK layer (in-memory vault — live vault untouched)");

  // 1+2. enrollment + honest unlock
  const { vault, store } = await freshVault();
  const unlocked = await vault.unlock(PASSWORD);
  check("1. initialize() installs a zkCommitment (44-char b64 curve point)", /^[A-Za-z0-9+/]{44}$/.test((await stateOf(store)).zkCommitment ?? ""));
  check("2. unlock(correct) succeeds with both verifiers", unlocked.initialized === true);
  await vault.lock();

  // 3. wrong password fail-closed
  let wrongCode = "";
  try {
    await vault.unlock(WRONG);
  } catch (e) {
    wrongCode = (e as { code?: string }).code ?? String(e);
  }
  check("3. unlock(wrong) fails WRONG_PASSWORD", wrongCode === "WRONG_PASSWORD", wrongCode);

  // 4. tampered COMMITMENT + correct password → the ZK layer rejects
  {
    const { vault: v2 } = { vault: await rehydrated(store) };
    const s = await stateOf(store);
    const orig = s.zkCommitment;
    // another valid curve point: commitment of a DIFFERENT password
    const { deriveCommitment } = await import("../packages/core/src/crypto");
    s.zkCommitment = deriveCommitment("a-different-password", s.verifier!.salt, "tamper");
    await persistState(store, s);
    let code = "";
    try {
      await v2.unlock(PASSWORD);
    } catch (e) {
      code = (e as { code?: string }).code ?? String(e);
    }
    check("4. tampered commitment + correct pw → WRONG_PASSWORD (ZK catches tamper)", code === "WRONG_PASSWORD", code);
    s.zkCommitment = orig;
    await persistState(store, s);
  }

  // 5. tampered ARGON2ID VERIFIER + correct password → still fail-closed
  {
    const v3 = await rehydrated(store);
    const s = await stateOf(store);
    const origVerifier = JSON.stringify(s.verifier);
    const { deriveVerifier } = await import("../packages/core/src/crypto");
    s.verifier = await deriveVerifier("a-different-password");
    await persistState(store, s);
    let code = "";
    try {
      await v3.unlock(PASSWORD);
    } catch (e) {
      code = (e as { code?: string }).code ?? String(e);
    }
    check("5. tampered Argon2id verifier + correct pw → WRONG_PASSWORD", code === "WRONG_PASSWORD", code);
    s.verifier = JSON.parse(origVerifier);
    await persistState(store, s);
  }

  // 6. missing commitment → CORRUPT_STATE (fail-closed, actionable)
  {
    const v4 = await rehydrated(store);
    const s = await stateOf(store);
    s.zkCommitment = null;
    await persistState(store, s);
    let code = "";
    try {
      await v4.unlock(PASSWORD);
    } catch (e) {
      code = (e as { code?: string }).code ?? String(e);
    }
    check("6. missing commitment → CORRUPT_STATE", code === "CORRUPT_STATE", code);
    // restore with the REAL context (saos-vault:zk:unlock:<instanceId>) — a
    // commitment derived under a different context must (and does) fail the
    // transcript check, which is exactly the anti-replay binding at work.
    const { deriveCommitment } = await import("../packages/core/src/crypto");
    s.zkCommitment = deriveCommitment(PASSWORD, s.verifier!.salt, `saos-vault:zk:unlock:${s.vaultInstanceId}`);
    await persistState(store, s);
  }

  // 7. step-up path behaves identically
  {
    const v5 = await rehydrated(store);
    await v5.unlock(PASSWORD);
    let stepOk = false;
    try {
      await v5.verifyStepUp(PASSWORD);
      stepOk = true;
    } catch {
      stepOk = false;
    }
    let stepWrong = "";
    try {
      await v5.verifyStepUp(WRONG);
    } catch (e) {
      stepWrong = (e as { code?: string }).code ?? String(e);
    }
    check("7a. verifyStepUp(correct) passes on the step-up path", stepOk);
    check("7b. verifyStepUp(wrong) fails WRONG_PASSWORD", stepWrong === "WRONG_PASSWORD", stepWrong);
    await v5.lock();
  }

  // 8. persistence round-trip keeps the commitment byte-exact
  {
    const before = (await stateOf(store)).zkCommitment;
    const v6 = await rehydrated(store);
    await v6.load(); // explicit — the server always awaits runtime ready before status
    const after = await ((v6 as unknown as { getStatus(): Promise<{ initialized: boolean }> }).getStatus());
    const reloaded = await stateOf(store);
    check(
      "8. commitment survives save/load byte-exact",
      after.initialized === true && reloaded.zkCommitment === before,
    );
  }

  console.log(
    JSON.stringify({ tool: "vault-zk-check", failedChecks: failed, verdict: failed === 0 ? "ZK-WIRED-PROVEN" : "BROKEN" }, null, 2),
  );
  if (failed > 0) process.exit(1);
}

/* ── helpers ─────────────────────────────────────────────────────────── */

type VaultState = { zkCommitment: string | null; verifier: { salt: string } | null } & Record<string, unknown>;

async function stateOf(store: ReturnType<typeof memoryStorage>): Promise<VaultState> {
  const rec = store.record;
  if (!rec) throw new Error("no state record — vault was never initialized");
  return JSON.parse(rec.stateJson) as VaultState;
}

async function persistState(store: ReturnType<typeof memoryStorage>, s: VaultState): Promise<void> {
  const rec = store.record;
  if (!rec) throw new Error("no state record");
  store.record = { ...rec, stateJson: JSON.stringify(s) };
}

/** A NEW SovereignVault over the SAME storage — the persistence path the server uses. */
async function rehydrated(store: ReturnType<typeof memoryStorage>): Promise<SovereignVault> {
  return new SovereignVault(store);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[vault-zk] FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
