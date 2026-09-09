// Key material handling — Steem/Hive WIF tools + SAOS-ROT1 deterministic derivation.
// Convention (learned the hard way 2026-09-08): NEVER verify a key by searching the
// WIF string in account history — WIFs are never broadcast. Derive the public key
// and compare against the on-chain authorities.
import steem from 'steem';
import crypto from 'crypto';

export type Chain = 'steem' | 'hive' | 'blurt';
export type Role = 'owner' | 'active' | 'posting' | 'memo';

// Public-key prefix per chain — the Base58 body is IDENTICAL across all three
// forks (same secp256k1); only the literal prefix differs (STM/BLT/Hive STM).

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function wifLooksValid(wif: string): boolean {
  return /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(wif.trim());
}

export function wifToPublic(wif: string, prefix: 'STM' | 'BLT' = 'STM'): string {
  // steem-js handles both legacy 5J/5H (uncompressed flag) and K/L (compressed) WIFs.
  // The steem lib always emits STM-prefixed pubs; for BLURT we swap the literal
  // prefix — the checksum covers only the key bytes, so the body is valid as-is.
  const pub = steem.auth.wifToPublic(wif.trim());
  return prefix === 'STM' ? pub : prefix + pub.replace(/^STM/, '');
}

// SAOS-ROT1 derivation — reproduces every rotated key from the master seed.
export function wifFromRot1Seed(masterHex: string, account: string, chain: string, role: string): string {
  const h = crypto.createHmac('sha256', Buffer.from(masterHex, 'hex')).update(`SAOS-ROT1/${account}/${chain}/${role}`).digest();
  const payload = Buffer.concat([Buffer.from([0x80]), h, Buffer.from([0x01])]);
  const check = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  const buf = Buffer.concat([payload, check]);
  let num = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (num > 0n) { out = B58[Number(num % 58n)] + out; num /= 58n; }
  let pad = 0; while (buf[pad] === 0) { out = '1' + out; pad++; }
  return out;
}

export const ROT1_ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];
export const ROT1_CHAINS: Chain[] = ['steem', 'hive', 'blurt'];
export const ROT1_ROLES: Role[] = ['owner', 'active', 'posting', 'memo'];
