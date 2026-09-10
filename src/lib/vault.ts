// Sovereign Vault crypto — AES-256-GCM at rest, plaintext NEVER persisted or logged.
// Secret lives only in .env (gitignored). Every decrypt is auditable by callers.
import crypto from 'crypto';

const SECRET = process.env.SOVEREIGN_VAULT_SECRET || '';

if (!SECRET || SECRET.length < 32) {
  // FIX(Roast-63 · H5): fail-closed אמת — ההערה-הקודמת ("fail loud") שקרה:
  // היא-הזהירה-והמשיכה → scryptSync('') מצפין-הכל-תחת-מפתח-מרוקן. עכשיו: כל
  // ניסיון-הצפנה/פענוח-זורק. האפליקציה-עולה, אך-הכספת-סגורה-בקול — לא-שקט-חלש.
  console.warn('[vault] SOVEREIGN_VAULT_SECRET missing/short — vault operations will THROW (fail-closed)');
}

function derivedKey(): Buffer {
  if (!SECRET || SECRET.length < 32) {
    throw new Error('SOVEREIGN_VAULT_SECRET missing/short (32+ chars required) — vault crypto fail-closed');
  }
  return crypto.scryptSync(SECRET, 'sovereign-vault-v1', 32);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptSecret(cipherText: string): string {
  const [ivHex, tagHex, ctHex] = cipherText.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

// Non-reversible fingerprint so we can identify a key without exposing it.
export function fingerprint(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex').slice(0, 16);
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

// Mask a secret for display: first 4 + last 4 only.
export function mask(s: string): string {
  if (!s) return '';
  if (s.length <= 10) return s.slice(0, 2) + '…' + s.slice(-2);
  return s.slice(0, 4) + '…' + s.slice(-4);
}
