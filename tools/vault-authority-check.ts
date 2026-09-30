/**
 * vault-authority-check.ts — live vault-vs-chain authority reconciliation.
 *
 * Reads the fleet vault (keys/vault.json under .grid98-lab/agent by default,
 * override with VAULT_KEYS_PATH), derives the PUBLIC key of every stored WIF
 * and compares it against the CURRENT on-chain authority (condenser_api
 * get_accounts, live RPC). Never prints or stores secret material — only
 * account names, roles, verdicts and public keys.
 *
 * Exit 0 = every stored WIF matches the live authority for its role.
 * Exit 1 = at least one mismatch/missing (signing with it would fail).
 */
import { existsSync, readFileSync } from "node:fs";
import { PrivateKey } from "../packages/crypto/src/keys";

const RPC = process.env.STEEM_RPC ?? "https://api.steemit.com";
// Task 13-c: env override wins; then the lab default, then the canonical org
// vault (steem/agent/keys — the live fleet vault.json).
const vaultPath = process.env.VAULT_KEYS_PATH
  ?? [".grid98-lab/agent/keys/vault.json", "/home/z/git-audit/steem/agent/keys/vault.json"].find((p) => existsSync(p))
  ?? ".grid98-lab/agent/keys/vault.json";

interface VaultKey { wif?: string }
interface VaultAccount {
  username: string;
  keys?: Partial<Record<"owner" | "active" | "posting" | "memo", VaultKey>>;
}
interface ChainAccount {
  name: string;
  owner: { key_auths: [string, number][] };
  active: { key_auths: [string, number][] };
  posting: { key_auths: [string, number][] };
  memo_key: string;
}

async function fetchChainAccounts(names: string[]): Promise<ChainAccount[]> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "condenser_api.get_accounts",
      params: [names],
      id: 1,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { result?: ChainAccount[]; error?: unknown };
  if (!j.result) throw new Error(`RPC error: ${JSON.stringify(j.error).slice(0, 200)}`);
  return j.result;
}

async function main(): Promise<void> {
  const vault = JSON.parse(readFileSync(vaultPath, "utf8")) as { accounts: VaultAccount[] };
  const accounts = vault.accounts;
  const names = accounts.map((a) => a.username);
  const chain = await fetchChainAccounts(names);
  const byName = new Map(chain.map((c) => [c.name, c]));

  let match = 0, mismatch = 0, missing = 0;
  const rows: { account: string; role: string; verdict: string; onchain?: string }[] = [];

  for (const acc of accounts) {
    const live = byName.get(acc.username);
    if (!live) {
      missing += Object.keys(acc.keys ?? {}).length;
      rows.push({ account: acc.username, role: "*", verdict: "ACCOUNT-MISSING-ON-CHAIN" });
      continue;
    }
    const auths: Record<string, string[]> = {
      owner: live.owner.key_auths.map(([k]) => k),
      active: live.active.key_auths.map(([k]) => k),
      posting: live.posting.key_auths.map(([k]) => k),
      memo: [live.memo_key],
    };
    for (const [role, keyObj] of Object.entries(acc.keys ?? {})) {
      const wif = keyObj?.wif;
      if (!wif) { missing++; rows.push({ account: acc.username, role, verdict: "NO-WIF-STORED" }); continue; }
      let pub: string;
      try { pub = PrivateKey.fromWif(wif).publicKey.toString(); }
      catch { mismatch++; rows.push({ account: acc.username, role, verdict: "INVALID-WIF" }); continue; }
      const ok = (auths[role] ?? []).includes(pub);
      if (ok) match++; else mismatch++;
      rows.push({ account: acc.username, role, verdict: ok ? "MATCH" : "MISMATCH", onchain: (auths[role] ?? []).join(",") });
    }
  }

  for (const r of rows) {
    console.log(`${r.verdict.padEnd(24)} ${r.account.padEnd(16)} ${r.role.padEnd(8)}${r.verdict !== "MATCH" && r.onchain ? "  onchain=" + r.onchain : ""}`);
  }
  console.log(`\nSUMMARY: match=${match} mismatch=${mismatch} missing=${missing} accounts=${names.length}`);
  const syncOk = mismatch === 0 && missing === 0;
  console.log(syncOk ? "VAULT-CHAIN-SYNC: PROVEN (all stored keys == live authorities)" : "VAULT-CHAIN-SYNC: FAILED (do not sign with mismatched keys)");
  process.exit(syncOk ? 0 : 1);
}

main().catch((e) => { console.error("vault-authority-check FAILED:", e.message); process.exit(1); });
