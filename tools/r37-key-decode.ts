/**
 * r37 — decode the uploaded headcorner.txt primary key.
 * Answers mechanically: what is this string, is it base58check-valid,
 * what version byte, what payload shape, and what pubkey it derives.
 */
import bs58 from "bs58";
import crypto from "crypto";
import { ethers } from "ethers";
import fs from "fs";

const raw = fs.readFileSync("/home/z/my-project/upload/headcorner.txt", "utf8");
const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const account = lines[0] || "";
const key = lines[1] || "";

console.log("account line:", account);
console.log("key length:", key.length, "first4:", key.slice(0, 4), "last4:", key.slice(-4));

// 1. raw base58 decode (no checksum assumption)
let decoded: Buffer | null = null;
try {
  decoded = Buffer.from(bs58.decode(key));
  console.log("base58 decode OK · bytes:", decoded.length, "hex:", decoded.toString("hex"));
} catch (e) {
  console.log("base58 decode FAILED:", (e as Error).message);
}

if (decoded) {
  // 2. try base58check with the WHOLE buffer (version 0x80 style check)
  const calcFull = crypto.createHash("sha256").update(crypto.createHash("sha256").update(decoded.subarray(0, decoded.length - 4)).digest()).digest().subarray(0, 4);
  const chkFull = decoded.subarray(decoded.length - 4);
  console.log("checksum match (whole buffer as WIF):", chkFull.equals(calcFull));
  if (chkFull.equals(calcFull)) {
    console.log("version byte: 0x" + decoded[0].toString(16));
    const body = decoded.subarray(1, decoded.length - 4);
    console.log("payload bytes:", body.length, "hex:", body.toString("hex"));
    // is it a compressed WIF (33B with 0x01 flag) or a plain 32B key?
    if (body.length === 33 && body[32] === 0x01) {
      const d = body.subarray(0, 32);
      console.log("→ COMPRESSED WIF body (33B, flag 0x01)");
      derivePub(d.toString("hex"));
    } else if (body.length === 32) {
      console.log("→ UNCOMPRESSED WIF body (32B)");
      derivePub(body.toString("hex"));
    } else {
      // non-standard version+payload — try interpreting payload[0..32] as key
      console.log("→ NON-STANDARD body; trying first 32B as key scalar");
      derivePub(body.subarray(0, 32).toString("hex"));
    }
  }
}

function derivePub(privHex: string) {
  try {
    const pk = Buffer.from(ethers.SigningKey.computePublicKey(("0x" + privHex) as `0x${string}`, true).slice(2), "hex");
    const ck = crypto.createHash("ripemd160").update(pk).digest().subarray(0, 4);
    const pub = "STM" + bs58.encode(Buffer.concat([pk, ck]));
    console.log("derived chain pubkey:", pub);
    fs.writeFileSync("/tmp/r37-derived-pub.txt", pub, "utf8");
    console.log("derived raw33:", pk.toString("hex"));
  } catch (e) {
    console.log("pubkey derive FAILED:", (e as Error).message);
  }
}
