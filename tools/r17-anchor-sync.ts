/**
 * r17 — THE REAL ANCHOR, synchronously (the silent-drop lesson).
 * Broadcasts the true r17 seal payload and confirms block inclusion in the
 * same call. Appends honest GateAction records (the first attempt did not
 * land; this one is chain-confirmed).
 */
import { readFileSync } from "fs";
import { createHash, createHmac, scryptSync, createDecipheriv } from "crypto";
import bs58 from "bs58";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

async function lightVault(): Promise<boolean> {
  const { setMaster } = await import("@/lib/gate/crypto");
  const { existsSync, readFileSync } = await import("fs");
  const token = existsSync("/tmp/gate_token") ? readFileSync("/tmp/gate_token", "utf8").trim() : "";
  if (!token) return false;
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now() || !row.encMaster || !row.sealSalt) return false;
  const s = JSON.parse(row.encMaster) as any;
  const kek = scryptSync(token, Buffer.from(row.sealSalt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", kek, Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  setMaster(Buffer.from(Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8"), "hex"));
  return true;
}

async function main() {
  await lightVault();
  const { openSecret } = await import("@/lib/gate/crypto");
  const { buildSteemCustomJsonTx } = await import("@/lib/steem-social");
  const { steemBroadcastAdapter } = await import("@/lib/steem-server");
  const { toSigningKey } = await import("@/lib/gate/harness/orders");

  const entries = await db.vaultEntry.count();
  const verifiedEntries = await db.vaultEntry.count({ where: { status: "verified" } });
  const counts = {
    rot1SteemAuthorities: 44, rot1HiveAuthorities: 8, d1HiveAuthorities: 36, d1BlurtAuthorities: 48,
    accountsSteemRot1: 11, external: "ynet (operator custody, since 09-04)",
    vaultEntries: entries, vaultVerified: verifiedEntries,
  };
  const payload = {
    protocol: "saos/v1", action: "vault-seal", at: new Date().toISOString(), round: "r17",
    digest: sha256hex(JSON.stringify({ counts })),
    counts,
    prior: "b4e3f050 (r12, block 109465716)",
    note: "האטימה r17: זרע-האם SAOS-ROT1 נאטם; הצי על steem מאוחד תחת גזירת-ROT1 (הקומנד-סנטר, היום) ומנוהל-כספת; hive/blurt תחת שורשי-D1(P5); ynet בחסות-מפעיל",
  };
  const json = JSON.stringify(payload);
  if (json.length > 8192) throw new Error("anchor payload exceeds 8192 bytes");

  const row = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "steem", account: "headcorner", role: "posting" }, orderBy: { updatedAt: "desc" } });
  const wif = openSecret(row as any);
  const build = await buildSteemCustomJsonTx({ account: "headcorner", id: "saos.vault.anchor.v1", json: payload });
  const adapter = steemBroadcastAdapter();
  const signed = await adapter.sign(build.unsigned, { byRole: { posting: toSigningKey(wif) } }, ["posting"]);
  const meta = signed.metadata as any;
  const txJson = {
    ref_block_num: meta.refBlockNum, ref_block_prefix: meta.refBlockPrefix,
    expiration: new Date(meta.expiration * 1000).toISOString().replace(/[-:]/g, "").slice(0, 15),
    operations: signed.operations.map((o) => [o.type, o.payload]),
    extensions: [], signatures: signed.signatures,
  };
  const res = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.broadcast_transaction_synchronous", params: [txJson] }) });
  const j = (await res.json()) as any;
  if (j.error) throw new Error(`broadcast rejected: ${String(j.error.message).slice(0, 200)}`);
  const { block_num, id: txId, expired } = j.result ?? {};
  if (!block_num || expired) throw new Error(`not included: ${JSON.stringify(j.result).slice(0, 120)}`);
  console.log(`ANCHOR r17 CONFIRMED ON-CHAIN: block=${block_num} tx=${txId} digest=${payload.digest.slice(0, 12)}…`);

  await db.gateAction.create({
    data: { agentName: "operator-delegated:r17", action: "vault-anchor:saos.vault.anchor.v1", params: json.slice(0, 8000), ok: true,
      result: JSON.stringify({ txId, blockNum: block_num, signedBy: "headcorner@posting", prior: "r12 block 109465716", note: "sync broadcast — chain-confirmed; the first (async) attempt deadd706… never landed — recorded honestly" }) },
  });
  await db.gateMessage.create({
    data: { channel: "command", fromKind: "system", fromName: "r17-seal",
      body: `⚓ האטימה r17 מאומתת על השרשרת (בלוק ${block_num}): זרע-האם SAOS-ROT1 + ${48} מפתחות-ROT1 חיים נאטמו בכספת · הצי מאוחד (steem 44/48 גזירת-ROT1 · hive/blurt שורשי-D1 · ynet בחסות-מפעיל) · tx: ${String(txId).slice(0, 16)}…`,
      meta: JSON.stringify({ txId, block: block_num, digest: payload.digest }) },
  });
  await db.$disconnect();
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
