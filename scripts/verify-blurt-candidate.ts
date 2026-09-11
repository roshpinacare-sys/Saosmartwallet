/**
 * verify-blurt-candidate.ts — roast-84 · אימות-אופליין-מלא של מועמד-ה-WIF
 * גזירה ידנית: base58 → version+scalar+checksum → secp256k1 → השוואת-33-בייט-דחוס
 * מול תווית-BLT-ידועה ומול כל-תוויות-הכספת. אפס-הדפסת-סודות.
 */
import fs from "node:fs";
import bs58 from "bs58";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

const KNOWN_BLURT_PUB = "BLT5HhJD5WUXu8vPhDmLaC2fTuuJYkwxF62Rt17HZ5G2PbnBvuHXF";

function grapheneChecksum(payload: Buffer): Buffer {
  return crypto.createHash("ripemd160").update(crypto.createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
}

/** מפענח תווית-ציבורית (STM/BLT/…) ל-33-בייט-דחוס — מאמת checksum גרפני */
function pubLabelToCompressed(label: string): Buffer | null {
  try {
    const body = label.replace(/^(STM|BLT|BTM|TST)/, "");
    const raw = bs58.decode(body);
    const data = raw.subarray(0, raw.length - 4);
    const cs = raw.subarray(raw.length - 4);
    if (!grapheneChecksum(data).equals(cs)) return null;
    return data.subarray(data.length - 33);
  } catch {
    return null;
  }
}

/** WIF-גולמי (כל-version) → סקלר-32-בייט (מאמת checksum ביטקויני) */
function wifToScalar(wif: string): Buffer | null {
  try {
    const raw = bs58.decode(wif.trim());
    const data = raw.subarray(0, raw.length - 4);
    const cs = raw.subarray(raw.length - 4);
    const sha = crypto.createHash("sha256").update(data).digest();
    if (!sha.subarray(0, 4).equals(cs)) return null;
    return data.subarray(1, 33); // אחרי-version
  } catch {
    return null;
  }
}

function scalarToCompressed(scalar: Buffer): Buffer {
  return Buffer.from(secp256k1.getPublicKey(new Uint8Array(scalar), true));
}

async function main(): Promise<void> {
  const candidate = fs.readFileSync("upload/בלורט.evm", "utf8").trim();
  const scalar = wifToScalar(candidate);
  if (!scalar) { console.log("candidate: INVALID-WIF-checksum"); return; }
  const derived = scalarToCompressed(scalar);
  console.log(`candidate: valid-WIF, derived-pub=${derived.toString("hex").slice(0, 8)}…`);

  const known = pubLabelToCompressed(KNOWN_BLURT_PUB);
  console.log(`match-known-BLURT: ${!!known && known.equals(derived)}`);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const rows = await db.vaultKey.findMany({
      where: { pubKey: { not: null } },
      select: { chain: true, account: true, role: true, pubKey: true, address: true },
    });
    console.log(`vault-rows-checked: ${rows.length}`);
    const matches: string[] = [];
    for (const r of rows) {
      if (r.pubKey) {
        const comp = pubLabelToCompressed(r.pubKey);
        if (comp && comp.equals(derived)) matches.push(`${r.chain}/${r.account}/${r.role}(pub)`);
      }
      if (r.address && r.chain === "evm") {
        // EVM: כתובת = keccak(pub)[12:] — בודקים-רק-אם-יש-keccak256
        try {
          const { keccak256 } = await import("@noble/hashes/legacy");
          const uncompressed = scalarToCompressed(scalar); // דחוס — צריך-פריקה-מלאה
          const full = Buffer.from(secp256k1.getPublicKey(new Uint8Array(scalar), false));
          const addr = "0x" + Buffer.from(keccak256(full.subarray(1)).subarray(12)).toString("hex");
          if (addr.toLowerCase() === r.address.toLowerCase()) matches.push(`${r.chain}/${r.account}/${r.role}(addr)`);
        } catch { /* אין-keccak — מדלג */ }
      }
    }
    console.log(`MATCHES: ${matches.length ? matches.join(" · ") : "NONE"}`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`FAILED: ${String((e as Error).message).slice(0, 200)}`); process.exit(1); });
