/**
 * r20 — THE MULTI-RAIL SEAL (live execution).
 *
 *  (1) sealBlurtD1Plane(): the vault gains its blurt plane — derive the D1
 *      roots per account/role, prove each against the blurt chain, seal only
 *      what the chain confirms (fail-closed per row).
 *  (2) sealAnchorRound("r20"): ONE digest (saos/v2) broadcast to steem+hive+
 *      blurt, signed per-rail by headcorner@posting, synchronous-first,
 *      chain-verified after. prior = the r19 steem anchor (block 109470596).
 *
 * Vault is lit from the operator session token (/tmp/gate_token) — the same
 * credential class the r17/r19 seals used. Nothing private is printed.
 */
export {};

async function lightVault(): Promise<boolean> {
  const { setMaster } = await import("@/lib/gate/crypto");
  const { existsSync, readFileSync } = await import("fs");
  const { createHash, scryptSync, createDecipheriv } = await import("crypto");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const token = existsSync("/tmp/gate_token") ? readFileSync("/tmp/gate_token", "utf8").trim() : "";
    if (!token) return false;
    const row = await db.gateSession.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    if (!row || row.revoked || row.expiresAt.getTime() < Date.now() || !row.encMaster || !row.sealSalt) return false;
    const s = JSON.parse(row.encMaster) as { iv: string; tag: string; ct: string };
    const kek = scryptSync(token, Buffer.from(row.sealSalt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
    const d = createDecipheriv("aes-256-gcm", kek, Buffer.from(s.iv, "hex"));
    d.setAuthTag(Buffer.from(s.tag, "hex"));
    setMaster(Buffer.from(Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8"), "hex"));
    return true;
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const { masterReady } = await import("@/lib/gate/crypto");
  const anchor = await import("@/lib/gate/anchor");
  if (!(await lightVault()) || !masterReady()) {
    console.log("FATAL: vault not lit — the operator session token is missing/expired");
    process.exit(1);
  }
  console.log("vault lit");

  // (1) the blurt plane enters the vault
  const plane = await anchor.sealBlurtD1Plane();
  console.log(`BLURT PLANE: sealed ${plane.sealed} · already ${plane.already} · refused ${plane.refused}`);
  for (const d of plane.details) console.log(`  · ${d}`);

  // (2) the multi-rail anchor round
  const round = await anchor.sealAnchorRound("r20", "operator-delegated:r20");
  console.log(`DIGEST r20: ${round.digest}`);
  for (const r of round.rails) {
    console.log(`  ${r.rail}: ok=${r.ok} txId=${r.txId ? `${String(r.txId).slice(0, 16)}…` : "—"} block=${r.blockNum ?? "—"} onChain=${r.onChain} digestMatch=${r.digestMatch}${r.error ? ` err="${r.error}"` : ""} (${r.mode ?? ""})`);
  }
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
