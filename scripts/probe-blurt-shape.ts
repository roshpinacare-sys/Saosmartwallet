/**
 * probe-blurt-shape.ts — roast-84 · ניתוח-צורה של מועמד-ה-WIF (אפס-סודות-בפלט)
 * האם 37/38 בייט? איזה version? checksum תקין? ונגזרת-pub-בכל-זאת (השוואה-מול-תוויות)
 */
import fs from "node:fs";
import bs58 from "bs58";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

const KNOWN_BLURT_PUB = "BLT5HhJD5WUXu8vPhDmLaC2fTuuJYkwxF62Rt17HZ5G2PbnBvuHXF";

function grapheneChecksum(p: Buffer): Buffer {
  return crypto.createHash("ripemd160").update(crypto.createHash("sha256").update(p).digest()).digest().subarray(0, 4);
}
function btcChecksum(p: Buffer): Buffer {
  return crypto.createHash("sha256").update(crypto.createHash("sha256").update(p).digest()).digest().subarray(0, 4);
}
function pubLabelToCompressed(label: string): Buffer | null {
  try {
    const body = label.replace(/^(STM|BLT|BTM|TST)/, "");
    const raw = bs58.decode(body);
    const data = raw.subarray(0, raw.length - 4);
    if (!grapheneChecksum(data).equals(raw.subarray(raw.length - 4))) return null;
    return data.subarray(data.length - 33);
  } catch { return null; }
}

async function main(): Promise<void> {
  const candidate = fs.readFileSync("upload/בלורט.evm", "utf8").trim();
  const raw = bs58.decode(candidate);
  console.log(`decoded-bytes=${raw.length} version=${raw[0]} lastByte=${raw[raw.length - 1]}`);
  const data = raw.subarray(0, raw.length - 4);
  console.log(`checksum-btc=${btcChecksum(data).equals(raw.subarray(raw.length - 4))} checksum-graphene=${grapheneChecksum(data).equals(raw.subarray(raw.length - 4))}`);

  // גזירה-בכל-זאת מהצורות-הסבירות (בלי-אימות-checksum)
  const tries: [string, Buffer][] = [
    ["v1+key32+cs4", raw.subarray(1, 33)],
    ["v1+key32+flag+cs4", raw.subarray(1, 33)],
  ];
  const derived = Buffer.from(secp256k1.getPublicKey(new Uint8Array(raw.subarray(1, 33)), true));
  console.log(`derived-pub-head=${derived.toString("hex").slice(0, 10)}…`);

  const known = pubLabelToCompressed(KNOWN_BLURT_PUB);
  console.log(`match-known-BLURT: ${!!known && known.equals(derived)}`);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const rows = await db.vaultKey.findMany({
      where: { pubKey: { not: null } },
      select: { chain: true, account: true, role: true, pubKey: true },
    });
    const matches: string[] = [];
    for (const r of rows) {
      const comp = r.pubKey ? pubLabelToCompressed(r.pubKey) : null;
      if (comp && comp.equals(derived)) matches.push(`${r.chain}/${r.account}/${r.role}`);
    }
    console.log(`vault-matches: ${matches.length ? matches.join(" · ") : "NONE"}`);
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error(`FAILED: ${String((e as Error).message).slice(0, 200)}`); process.exit(1); });
