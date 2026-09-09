/**
 * SOVEREIGN GATE — crypto core.
 *
 * Iron rules (born from the 2026-09-08 headcorner owner-rotation incident):
 *  · Private material is NEVER written to disk in plaintext — only AES-256-GCM
 *    ciphertext inside SQLite, sealed under a random 256-bit master key.
 *  · The master key itself is sealed under scrypt(operator passphrase) and only
 *    ever lives in process memory while the gate is unlocked. Server restart
 *    locks the vault; the operator passphrase re-opens it (one line, 5 seconds).
 *  · API responses expose public keys/addresses and statuses only — never priv.
 *  · "It won't happen again": there is no plaintext key file to read. An agent
 *    with file access finds ciphertext, and without the operator passphrase the
 *    GCM tag check makes decryption impossible (not hard — impossible).
 */
import crypto from "crypto";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

export interface Seal {
  ct: string; // hex ciphertext
  iv: string; // hex 12B
  tag: string; // hex 16B
}

/** AES-256-GCM seal with an explicit 32B key. */
export function sealWith(key: Buffer, plaintext: string): Seal {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return { ct: ct.toString("hex"), iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex") };
}

/** AES-256-GCM open (throws on tamper — GCM tag mismatch). */
export function openWith(key: Buffer, s: Seal): string {
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8");
}

/** Derive 32B KEK from operator passphrase + salt (hex). */
export function deriveKek(passphrase: string, saltHex: string): Buffer {
  return crypto.scryptSync(passphrase, Buffer.from(saltHex, "hex"), 32, SCRYPT);
}

/* ── in-memory master key (module-global, survives across requests in one process) ── */
const g = globalThis as unknown as { __gateMaster?: Buffer };

export function setMaster(key: Buffer | null) {
  if (key) g.__gateMaster = key;
  else delete g.__gateMaster;
}
export function masterReady(): boolean {
  return g.__gateMaster instanceof Buffer && g.__gateMaster.length === 32;
}
/** Returns the in-memory master or null (never throws) — used for session-sealed fallback. */
export function getMaster(): Buffer | null {
  return masterReady() ? (g.__gateMaster as Buffer) : null;
}
export function requireMaster(): Buffer {
  if (!masterReady()) throw new GateError("vault-locked", "הכספת נעולה — התחבר מחדש עם מפתח");
  return g.__gateMaster as Buffer;
}
export function sealSecret(plaintext: string): { encPriv: string; privIv: string; privTag: string } {
  const s = sealWith(requireMaster(), plaintext);
  return { encPriv: s.ct, privIv: s.iv, privTag: s.tag };
}
export function openSecret(e: { encPriv: string; privIv: string; privTag: string }): string {
  return openWith(requireMaster(), { ct: e.encPriv, iv: e.privIv, tag: e.privTag });
}
/** Open a secret with an explicit master (session-sealed path) instead of the in-memory one. */
export function openSecretWith(master: Buffer, e: { encPriv: string; privIv: string; privTag: string }): string {
  return openWith(master, { ct: e.encPriv, iv: e.privIv, tag: e.privTag });
}

/** sha256 hex — used for hashing session/agent tokens at rest. */
export function sha256hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Typed API error with Hebrew message. */
export class GateError extends Error {
  code: string;
  constructor(code: string, hebrew: string) {
    super(hebrew);
    this.code = code;
  }
}
