// Audit trail — "never again": every security-relevant action is recorded.
import { db } from '@/lib/db';
import { scrub } from '@/lib/secret-scrub';

export async function audit(action: string, detail = ''): Promise<void> {
  try {
    // FIX(Roast-65-b · M11): AuditLog.detail = שדה-טקסט-חופשי ביומן-תמידי —
    // סריקת-סודות לפני-הכתיבה (היומן הוא-המקום-האחרון-שרוצים-בו WIF/PAT שדלף מקריאה).
    await db.auditLog.create({ data: { action, detail: scrub(detail).slice(0, 2000) } });
  } catch (e) {
    console.error('[audit] failed', action, String(e).slice(0, 120));
  }
}

export async function relayBroadcast(event: string, payload: unknown): Promise<void> {
  // Fire-and-forget push to the relay mini-service (port 3004) for live UI updates.
  const token = process.env.SOVEREIGN_RELAY_TOKEN || '';
  try {
    await fetch('http://127.0.0.1:3004/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Token': token },
      body: JSON.stringify({ event, payload }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Relay down is non-fatal — UI falls back to polling.
  }
}
