/**
 * SIGNING-KEY — the vault WIF → chain-signing PrivateKey boundary (r21).
 *
 * Extracted verbatim from gate/harness/orders.ts so the CONVERSION PLANE
 * (gate/dex-rail.ts) and the SOVEREIGN-HAND (gate/harness/orders.ts) share
 * ONE signing boundary — no duplicate key semantics anywhere.
 *
 * The vault's WIFs are stored in the 52-char bitcoin-flavored form
 * ([0x80 ‖ 32B ‖ 0x01 ‖ 4B chk]). steem-js — which REGISTERED the on-chain
 * authorities — treats that payload's 33-byte body (32B ‖ 0x01) as the WHOLE
 * scalar (its `fromBuffer` warns "Expecting 32 bytes, instead got 33" and
 * multiplies on anyway). The live authority is therefore derived from
 * (body33 mod n), NOT from the canonical 32-byte scalar. Verified live
 * 2026-09-09 against headcorner's posting authority; re-proven r19 three
 * ways (stored==live, standard≠live, canonical==live). Signing must
 * reproduce steem-js semantics or the chain answers "missing required
 * active authority".
 */
import { db } from "@/lib/db";
import { openSecret, GateError } from "@/lib/gate/crypto";
import { PrivateKey, base58Decode } from "../../../packages/crypto/src/index";
import { sha256 } from "@noble/hashes/sha2.js";

// secp256k1 group order — @noble/curves (audited); no hand-rolled crypto.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export function toSigningKey(wif: string): PrivateKey {
  const trimmed = wif.trim();
  const raw = base58Decode(trimmed);
  if (raw.length === 37 && raw[0] === 0x80) {
    return PrivateKey.fromWif(trimmed); // canonical steem WIF — package handles it
  }
  if (raw.length === 38 && raw[0] === 0x80 && raw[33] === 0x01) {
    // checksum over [0x80 ‖ 33B body] — fail closed on mismatch
    const payload = raw.subarray(0, 34);
    const chk = sha256(sha256(payload)).slice(0, 4);
    if (!Buffer.from(chk).equals(Buffer.from(raw.subarray(34, 38)))) {
      throw new GateError("bad-key", "בדיקת-סיכום של המפתח נכשלה — חומר-המפתח בכספת פגום");
    }
    const d = BigInt("0x" + Buffer.from(raw.subarray(1, 34)).toString("hex")) % SECP256K1_N;
    return PrivateKey.fromBytes(Buffer.from(d.toString(16).padStart(64, "0"), "hex"));
  }
  return PrivateKey.fromWif(trimmed); // otherwise let the package fail closed
}

/**
 * The account's ACTIVE key straight from the vault (r21 CONVERSION PLANE).
 * `requireMaster()` must already hold (an open operator session) — fail
 * closed on a locked vault, on a missing row, and on an unverified row.
 */
export async function vaultActiveKey(account: string, chain: string): Promise<PrivateKey> {
  const entry = await db.vaultEntry.findFirst({
    where: { chain, account, role: "active", status: "verified" },
    orderBy: { updatedAt: "desc" },
  });
  if (!entry) {
    throw new GateError("vault-missing-key", `אין מפתח-active מאומת של ${account}@${chain} בכספת — אי אפשר לחתום`);
  }
  const wif = openSecret({ encPriv: entry.encPriv, privIv: entry.privIv, privTag: entry.privTag });
  return toSigningKey(wif);
}
