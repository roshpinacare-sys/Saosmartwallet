import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const rows = await db.vaultEntry.findMany({ orderBy: [{ chain: "asc" }, { account: "asc" }, { role: "asc" }] });
const byKind: Record<string, number> = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
console.log("TOTAL", rows.length, "BY KIND:", JSON.stringify(byKind));
const byChainStatus: Record<string, number> = {};
for (const r of rows) { const k = `${r.chain ?? "null"} | ${r.status}`; byChainStatus[k] = (byChainStatus[k] || 0) + 1; }
console.log("BY CHAIN|STATUS:", JSON.stringify(byChainStatus));
console.log("STEEM-KEYS:");
for (const r of rows.filter((r) => r.kind === "steem-key")) {
  console.log(`  ${r.chain} ${r.account}@${r.role} status=${r.status} verifiedAt=${r.verifiedAt?.toISOString() ?? "never"}`);
}
console.log("OTHER KINDS:");
for (const r of rows.filter((r) => r.kind !== "steem-key")) {
  console.log(`  kind=${r.kind} chain=${r.chain} account=${r.account} status=${r.status} verifiedAt=${r.verifiedAt?.toISOString() ?? "never"}`);
}
await db.$disconnect();
