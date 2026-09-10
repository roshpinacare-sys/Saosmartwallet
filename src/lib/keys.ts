// Key material handling — Steem/Hive/Blurt WIF tools + SAOS-ROT1 deterministic derivation.
// Convention (learned the hard way 2026-09-08): NEVER verify a key by searching the
// WIF string in account history — WIFs are never broadcast. Derive the public key
// and compare against the on-chain authorities.
import steem from 'steem';
import crypto from 'crypto';

export type Chain = 'steem' | 'hive' | 'blurt';
export type Role = 'owner' | 'active' | 'posting' | 'memo';

// PROVEN LIVE (task 59, 2026-09-09, full-hex diff vs blurt-rpc): the base58 envelope
// body is IDENTICAL across Steem/Hive/Blurt — base58(pub33 + ripemd160(pub33)[0..4]);
// only the literal prefix differs (STM / Hive-STM / BLT). steem-js already emits
// exactly that body, so a literal prefix swap is the correct BLURT derivation.
// (An earlier "different envelope per fork" theory was disproven by hex comparison.)
// Blurt wallet UI additionally displays private keys with a leading "P" — normalized.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function wifLooksValid(wif: string): boolean {
  // Accepts 5J/5H/K/L WIFs and the Blurt-wallet P-prefixed display form (P5KQ…).
  return /^([5KL]|[5KL]P|P[5KL])[1-9A-HJ-NP-Za-km-z]{50,51}$/.test(wif.trim());
}

export function wifToPublic(wif: string, prefix: 'STM' | 'BLT' = 'STM'): string {
  // Normalize the Blurt display prefix before handing to steem-js (P5KQ… → 5KQ…).
  let w = wif.trim();
  if (w.length === 52 && w.startsWith('P') && /^[5KL]/.test(w[1])) w = w.slice(1);
  const pub = steem.auth.wifToPublic(w); // handles legacy 5J/5H + compressed K/L WIFs
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
  const ZERO = BigInt(0), B58N = BigInt(58); // FIX(Roast-63 · H8): literals-0n/58n-דרשו-target>=ES2020 (tsc-נכשל; SWC-סלחן)
  while (num > ZERO) { out = B58[Number(num % B58N)] + out; num /= B58N; }
  let pad = 0; while (buf[pad] === 0) { out = '1' + out; pad++; }
  return out;
}

export const ROT1_ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];
export const ROT1_CHAINS: Chain[] = ['steem', 'hive', 'blurt'];
export const ROT1_ROLES: Role[] = ['owner', 'active', 'posting', 'memo'];
