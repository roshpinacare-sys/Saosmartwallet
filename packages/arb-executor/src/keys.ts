/**
 * packages/arb-executor — army keyfile loading (programmatic, NEVER printed)
 * ===========================================================================
 * The custody file /home/z/coord-work/vaults/steem-secrets/army-keys.json
 * (measured shape 2026-10-27) is:
 *
 *   { extractedAt, generations: [{gen, outerSha, innerSha}], errors: [],
 *     accounts: [{ name, gens: [{gen, wif, pub, activeWif, activePub}] }] }
 *
 * gens[0] is the NEWEST generation on every measured account (GEN-2 before
 * GEN-1). LAWS:
 *
 *   • WIFs are loaded programmatically into vault envelopes and NEVER
 *     returned, printed, logged, or embedded in errors — the class exposes
 *     metadata (account, gen, pubkeys, fingerprints) only;
 *   • each account is sealed into the runtime vault with meta {role:"active",
 *     account, gen} so packages/hsm-runtime's role policy (funds ops require
 *     active/owner) enforces authority structurally at sign time;
 *   • the known custody wounds (CUSTODY-WOUNDS.jsonl: soldiers whose chain
 *     posting authority left the vault) are NOT hidden — the LIVE authority
 *     check (chain.ts) decides executability per account, fail-honest.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { PrivateKey } from "../../crypto/src/index";
import type { Vault } from "../../vault/src/index";

export interface ArmyKeyfileMeta {
  extractedAt: string;
  generations: Array<{ gen: string; outerSha: string; innerSha: string }>;
  errors: unknown[];
  accounts: Array<{ name: string; gens: Array<{ gen: string; wif?: string; pub?: string; activeWif?: string; activePub?: string }> }>;
}

/** Metadata-only view of one loaded account — no material, ever. */
export interface ArmyAccountMeta {
  account: string;
  gen: string;
  /** Public keys as stored in the custody file (STM… strings, public data). */
  postingPub: string | null;
  activePub: string | null;
  /** sha256(pub)[:12] printable identity — reveals nothing. */
  activeFingerprint: string;
}

export interface LoadedArmy {
  extractedAt: string;
  accounts: ArmyAccountMeta[];
  /** Seals the newest-gen ACTIVE WIF of each account into `vault`. */
  sealActiveKeys(vault: Vault): Promise<string[]>;
}

function fingerprintOfPub(pub: string): string {
  return `sha256:${createHash("sha256").update(pub, "utf8").digest("hex").slice(0, 12)}…`;
}

/** Parses the custody file; validates WIFs by DERIVATION (math proves shape)
 *  — the derived keys are discarded immediately; only metadata survives. */
export function loadArmyKeys(path: string): LoadedArmy {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`ARMY_KEYS_E_CUSTODY — cannot read ${path}: ${(e as Error).message}`);
  }
  let doc: ArmyKeyfileMeta;
  try {
    doc = JSON.parse(raw) as ArmyKeyfileMeta;
  } catch {
    throw new Error(`ARMY_KEYS_E_MALFORMED — ${path} is not valid JSON`);
  }
  if (!Array.isArray(doc.accounts) || doc.accounts.length === 0) {
    throw new Error("ARMY_KEYS_E_EMPTY — no accounts in the custody file (rail refuses an empty roster)");
  }

  const accounts: ArmyAccountMeta[] = [];
  const newestWifs = new Map<string, { wif: string; gen: string }>();

  for (const acc of doc.accounts) {
    if (typeof acc.name !== "string" || acc.name.length === 0) {
      throw new Error("ARMY_KEYS_E_MALFORMED — account entry without a name");
    }
    if (!Array.isArray(acc.gens) || acc.gens.length === 0) {
      throw new Error(`ARMY_KEYS_E_MALFORMED — account ${acc.name} carries no generations`);
    }
    const newest = acc.gens[0]; // measured: gens[0] is the newest generation
    const meta: ArmyAccountMeta = {
      account: acc.name,
      gen: typeof newest.gen === "string" ? newest.gen : "unknown",
      postingPub: typeof newest.pub === "string" ? newest.pub : null,
      activePub: typeof newest.activePub === "string" ? newest.activePub : null,
      activeFingerprint: typeof newest.activePub === "string" ? fingerprintOfPub(newest.activePub) : "absent",
    };
    if (typeof newest.activeWif === "string" && newest.activeWif.length > 0) {
      // shape proof by derivation — throws on a corrupt WIF (fail-honest);
      // the PrivateKey instance is dropped immediately, never stored.
      const probe = PrivateKey.fromWif(newest.activeWif);
      const derived = probe.publicKey.toString();
      if (meta.activePub !== null && derived !== meta.activePub) {
        throw new Error(`ARMY_KEYS_E_PUB_MISMATCH — ${acc.name}: custody activePub ≠ derived pubkey (fail-honest, refusing)`);
      }
      newestWifs.set(acc.name, { wif: newest.activeWif, gen: meta.gen });
    }
    accounts.push(meta);
  }

  return {
    extractedAt: typeof doc.extractedAt === "string" ? doc.extractedAt : "",
    accounts,
    async sealActiveKeys(vault: Vault): Promise<string[]> {
      const sealed: string[] = [];
      for (const meta of accounts) {
        const entry = newestWifs.get(meta.account);
        if (!entry) continue; // account without a usable active WIF — recorded, skipped
        const keyId = `army/${meta.account}/active`;
        // The vault's secp256k1-wif path checksum-verifies the WIF and
        // zero-fills material after every use (withKey). The WIF string
        // itself never leaves this closure — only the sealed envelope and
        // the metadata above are ever visible to callers.
        await vault.sealKey({
          id: keyId,
          type: "secp256k1-wif",
          material: entry.wif,
          meta: { role: "active", account: meta.account, gen: entry.gen, fingerprint: meta.activeFingerprint },
        });
        sealed.push(keyId);
      }
      return sealed;
    },
  };
}
