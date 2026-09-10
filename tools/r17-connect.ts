/**
 * r17 — CONNECT THE WORKING PLANE: active-signed account_update per soldier,
 * setting active/posting/memo to the D1 roots (owner untouched, account_auths
 * preserved). Pilot: one account, chain-verified, before the rest.
 *
 * Usage: bun run tools/r17-connect.ts cashmachine   (pilot / single)
 *        bun run tools/r17-connect.ts all           (every ready account)
 */
import { createHash, scryptSync, createDecipheriv } from "crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function lightVault(): Promise<boolean> {
  const { setMaster } = await import("@/lib/gate/crypto");
  const { existsSync, readFileSync } = await import("fs");
  const token = existsSync("/tmp/gate_token") ? readFileSync("/tmp/gate_token", "utf8").trim() : "";
  if (!token) return false;
  const row = await db.gateSession.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now() || !row.encMaster || !row.sealSalt) return false;
  const s = JSON.parse(row.encMaster) as any;
  const kek = scryptSync(token, Buffer.from(row.sealSalt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", kek, Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  setMaster(Buffer.from(Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8"), "hex"));
  return true;
}

async function main() {
  const arg = (process.argv[2] || "").trim();
  if (!arg) { console.log("usage: r17-connect.ts <account|all>"); process.exit(1); }
  if (!(await lightVault())) { console.log("FATAL: vault could not be lit via the operator token"); process.exit(1); }
  const { rotationStatus, executeActivePlaneRotation } = await import("@/lib/gate/rotation");

  const status = await rotationStatus();
  const ready = status.targets.filter((t) => t.activePlane === "ready").map((t) => t.account);
  const done = status.targets.filter((t) => t.activePlane === "done").map((t) => t.account);
  const none = status.targets.filter((t) => t.activePlane === "none").map((t) => t.account);
  console.log(`status: ready=${ready.length} [${ready.join(",")}] · done=${done.length} [${done.join(",")}] · none=${none.length} [${none.join(",")}]`);
  console.log(`owner-plane (external keys — not connectable today): readyCount=${status.readyCount}`);

  const list = arg === "all" ? ready : [arg];
  if (arg !== "all" && !ready.includes(arg)) {
    console.log(`FATAL: ${arg} is not activePlane-ready (its live active key is not the vault's sealed, consistent key) — refusing`);
    process.exit(1);
  }

  let okCount = 0;
  for (const account of list) {
    try {
      const r = await executeActivePlaneRotation(account, "operator-delegated:r17");
      console.log(`${account}: tx=${r.txId || "(none)"} verified=${r.verified} — ${r.detail}`);
      if (r.verified) okCount++;
      await new Promise((res) => setTimeout(res, 2500)); // one beat between broadcasts
    } catch (e) {
      console.log(`${account}: REFUSED — ${(e as Error).message}`);
    }
  }
  console.log(`\nconnected: ${okCount}/${list.length}`);

  const after = await rotationStatus();
  console.log(`post-status: activePlane ready=${after.activePlaneReady} done=${after.activePlaneDone} · owner-ready=${after.readyCount}`);
  await db.$disconnect();
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
