/**
 * r37 — recovery drill for the uploaded headcorner.txt key.
 * The string is base58-decodable but fails the WIF checksum → some chars
 * differ from the true key ("קצת אחרת" per the operator). We attempt:
 *  1. alternate checksum definitions (single sha256, ripemd160 variants)
 *  2. single-character substitution sweep (58 alphabet chars × 52 positions)
 *  3. single-character deletion sweep (each position dropped)
 *  4. single-character insertion sweep (58 chars × 53 slots)
 * Any candidate whose double-sha256 checksum verifies is THE key.
 */
import bs58 from "bs58";
import crypto from "crypto";
import fs from "fs";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const raw = fs.readFileSync("/home/z/my-project/upload/headcorner.txt", "utf8");
const key = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[1];

const dsha = (b: Buffer) => crypto.createHash("sha256").update(crypto.createHash("sha256").update(b).digest()).digest();
const sha1 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();

function check(cand: string): { ok: boolean; variant: string } | null {
  let buf: Buffer;
  try { buf = Buffer.from(bs58.decode(cand)); } catch { return null; }
  if (buf.length < 5) return null;
  const body = buf.subarray(0, buf.length - 4);
  const chk = buf.subarray(buf.length - 4);
  if (dsha(body).subarray(0, 4).equals(chk)) return { ok: true, variant: "double-sha256 (WIF standard)" };
  if (sha1(body).subarray(0, 4).equals(chk)) return { ok: true, variant: "single-sha256" };
  return null;
}

// sanity: the original
const orig = check(key);
console.log("original:", orig ? `valid (${orig.variant})` : "INVALID checksum");

if (!orig) {
  // 2. single-char substitution
  for (let pos = 0; pos < key.length; pos++) {
    for (const c of ALPHABET) {
      if (c === key[pos]) continue;
      const cand = key.slice(0, pos) + c + key.slice(pos + 1);
      const r = check(cand);
      if (r) { console.log(`SUBSTITUTION HIT pos=${pos} '${key[pos]}'→'${c}'`, r.variant, "candidate:", cand); process.exit(0); }
    }
  }
  console.log("no substitution hit");

  // 3. single-char deletion
  for (let pos = 0; pos < key.length; pos++) {
    const cand = key.slice(0, pos) + key.slice(pos + 1);
    const r = check(cand);
    if (r) { console.log(`DELETION HIT pos=${pos} ('${key[pos]}' dropped)`, r.variant, "candidate:", cand); process.exit(0); }
  }
  console.log("no deletion hit");

  // 4. single-char insertion
  for (let pos = 0; pos <= key.length; pos++) {
    for (const c of ALPHABET) {
      const cand = key.slice(0, pos) + c + key.slice(pos);
      const r = check(cand);
      if (r) { console.log(`INSERTION HIT pos=${pos} ('${c}' inserted)`, r.variant, "candidate:", cand); process.exit(0); }
    }
  }
  console.log("no insertion hit");

  // 5. transposition (swap adjacent chars)
  for (let pos = 0; pos < key.length - 1; pos++) {
    const cand = key.slice(0, pos) + key[pos + 1] + key[pos] + key.slice(pos + 2);
    const r = check(cand);
    if (r) { console.log(`TRANSPOSITION HIT pos=${pos}`, r.variant, "candidate:", cand); process.exit(0); }
  }
  console.log("no transposition hit");
  console.log("CONCLUSION: >1 char differs from any standard-WIF candidate");
}
