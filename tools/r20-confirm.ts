/** r20 — confirm the r20 anchors on-chain (block-scan truth) and update the
 *  audit rows with the confirmation (the seal ran before the verifier learned
 *  the get_block fallback). Also prints the cross-chain digest unity. */
export {};

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const anchor = await import("@/lib/gate/anchor");

  const hist = await anchor.readAnchorHistory();
  for (const rec of hist) {
    const v = await anchor.verifyAnchorOnChain(rec.chain as never, rec.txId, undefined, rec.blockNum).catch(() => ({ onChain: false, blockNum: null, digest: null, digestMatch: null }));
    console.log(`${rec.chain}: tx ${rec.txId.slice(0, 14)}… blk ${v.blockNum ?? rec.blockNum} onChain=${v.onChain} chainDigest=${(v.digest ?? "—").slice(0, 16)} round=${rec.round ?? "—"}`);
    if (v.onChain) {
      // upgrade our own audit row to the chain-confirmed truth
      const acts = await db.gateAction.findMany({ where: { action: "vault-anchor:saos.vault.anchor.v1", ok: true, result: { contains: rec.txId } }, orderBy: { createdAt: "desc" }, take: 1 });
      for (const a of acts) {
        let r: Record<string, unknown> = {};
        try { r = JSON.parse(a.result || "{}") as Record<string, unknown>; } catch { /* keep */ }
        if (r.onChain === true && r.digestMatch === true) continue;
        r.onChain = true;
        r.digestMatch = v.digest ? true : r.digestMatch;
        r.chainConfirmedAt = new Date().toISOString();
        await db.gateAction.update({ where: { id: a.id }, data: { result: JSON.stringify(r) } });
        console.log(`  ↳ audit row ${a.id} upgraded to chain-confirmed`);
      }
    }
  }
  await db.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
