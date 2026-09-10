/**
 * r10 — cross-chain authority truth: which vault pubs control what,
 * live, on steem + hive + blurt. Read-only. Byte-level comparison.
 */
import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";
import bs58 from "bs58";

const db = new PrismaClient();
const require_ = createRequire(import.meta.url);
const steem = require_("steem");

const NODES = {
  steem: "https://api.steemit.com",
  hive: "https://api.hive.blog",
  blurt: "https://blurt-rpc.saboin.com",
};
const PREFIXES: Record<string, string> = { steem: "STM", hive: "STM", blurt: "BLT" };

async function getAccounts(chain: string, names: string[]): Promise<any[]> {
  const r = await fetch(NODES[chain as keyof typeof NODES], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [names], id: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  return j.result || [];
}

function decodePub33(pub: string): Buffer | null {
  // strips STM/HIVE/BLT/TST prefix, base58-decodes, drops 4-byte checksum → 33 bytes
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try {
    const raw = Buffer.from(bs58.decode(m[2]));
    return raw.subarray(0, 33);
  } catch { return null; }
}

const vaultRows = await db.vaultEntry.findMany({ where: { kind: "steem-key" }, orderBy: [{ account: "asc" }, { role: "asc" }] });
const vaultPubs = vaultRows.filter((r) => r.pub).map((r) => ({ row: r, b33: decodePub33(r.pub!) })).filter((x) => x.b33);

const ACCOUNTS = [...new Set(vaultRows.map((r) => String(r.account || "").split("-")[0]).filter(Boolean))]; // headcorner-legacy → headcorner
console.log("vault steem-key rows:", vaultRows.length, "| unique accounts:", ACCOUNTS.join(","));

for (const chain of ["steem", "hive", "blurt"] as const) {
  const rows = await getAccounts(chain, ACCOUNTS);
  console.log(`\n=== ${chain.toUpperCase()} — ${rows.length}/${ACCOUNTS.length} accounts exist ===`);
  let matched = 0;
  for (const a of rows) {
    const auths: Array<{ role: string; pub: string }> = [];
    for (const role of ["owner", "active", "posting"] as const)
      for (const [pub] of a[role]?.key_auths || []) auths.push({ role, pub });
    auths.push({ role: "memo", pub: a.memo_key });
    for (const { row, b33 } of vaultPubs) {
      const acc = String(row.account || "");
      if (acc !== a.name && acc !== a.name + "-legacy") continue;
      for (const { role, pub } of auths) {
        const cb33 = decodePub33(pub);
        if (cb33 && b33 && cb33.equals(b33)) {
          console.log(`  MATCH ${chain} ${a.name}@${role} ← vault row ${row.account}@${row.role} (${PREFIXES[chain]}-family bytes identical)`);
          matched++;
        }
      }
    }
  }
  if (!matched) console.log("  (אף מפתח-כספת לא תואם את ה-authorities החיים כאן)");
}
await db.$disconnect();
