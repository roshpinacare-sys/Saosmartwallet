/** independent double-proof from a DIFFERENT node (api.justyy.com) — D1 roots live in all 4 authorities */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const { openSecret } = await import("@/lib/gate/crypto");
  const { setMaster } = await import("@/lib/gate/crypto");
  const { createHash, scryptSync, createDecipheriv } = await import("crypto");
  const { readFileSync } = await import("fs");
  const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
  const token = readFileSync("/tmp/gate_token", "utf8").trim() || "";
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || !row.encMaster || !row.sealSalt) throw new Error("no session / seal for the lifeline token");
  const s = JSON.parse(row.encMaster) as any;
  const kek = scryptSync(token, Buffer.from(row.sealSalt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", kek, Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  setMaster(Buffer.from(Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8"), "hex"));
  const { deriveRolePrivHex, privHexToWif } = await import("@/lib/gate/rotation");
  const { wifToChainPub } = await import("@/lib/gate/key-id");
  const ACCOUNTS = ["headcorner","cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq"];
  const r = await fetch("https://api.justyy.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [ACCOUNTS] }) });
  const rows = (await r.json()).result as any[];
  let allOk = 0;
  for (const acct of rows) {
    const p5row = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account: acct.name } });
    const p5 = openSecret(p5row as { encPriv: string; privIv: string; privTag: string });
    const target = (role: string) => wifToChainPub(privHexToWif(deriveRolePrivHex(acct.name, role, p5)));
    const roles = ["owner","active","posting","memo"] as const;
    const ok = roles.map((role) => role === "memo"
      ? acct.memo_key === target(role)
      : (acct[role].key_auths as string[][]).some((k) => String(k[0]) === target(role)));
    const gates = (acct.posting.account_auths as string[][]).map((x) => x[0]);
    if (ok.every(Boolean)) allOk++;
    console.log(`${acct.name.padEnd(12)} D1=${ok.filter(Boolean).length}/4 doors=${gates.join(",") || "-"}`);
  }
  console.log(`DOUBLE-PROOF: ${allOk}/11 accounts fully unified on D1 roots (via api.justyy.com)`);
}
main().finally(() => db.$disconnect());
