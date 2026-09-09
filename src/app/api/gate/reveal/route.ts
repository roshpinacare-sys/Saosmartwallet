import { db } from "@/lib/db";
import { getMaster, openSecretWith, GateError } from "@/lib/gate/crypto";
import { openSessionMaster, requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/reveal — operator views ONE private key ("לראות את המפתחות
 * דרך המערכת אם צריך"). Master comes from memory, or is re-opened from the
 * session's own sealed copy (cookie-only token) — works right after a server
 * restart, with zero passphrase and zero key re-entry. Every reveal is audited.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`gate-reveal:${clientIpOf(req)}`, 60, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, code: "rate", error: "יותר מדי בקשות — נסה בעוד דקה" }, { status: 429 });
  }
  try {
    await requireOperator();
    const { id } = await req.json().catch(() => ({}));
    if (typeof id !== "string" || !id.trim()) throw new GateError("bad-input", "דרוש id של רשומה");

    const entry = await db.vaultEntry.findUnique({ where: { id } });
    if (!entry) throw new GateError("not-found", "הרשומה לא נמצאה");

    // master: memory first, then the session's sealed copy (survives restarts)
    let master = getMaster();
    let source = "memory";
    if (!master) {
      master = await openSessionMaster();
      source = "session";
    }
    if (!master) {
      throw new GateError("vault-locked", "הכספת נעולה — התחבר מחדש עם מפתח");
    }

    let priv: string;
    try {
      priv = openSecretWith(master, entry);
    } catch {
      throw new GateError("gcm-reject", "פענוח נכשל (GCM) — הרשומה נחתמה תחת מפתח-אב אחר");
    }

    await db.gateMessage.create({
      data: {
        channel: "audit", fromKind: "system", fromName: "gate",
        body: `צפייה במפתח: ${entry.chain || entry.kind} · ${entry.account || "?"}${entry.role ? "@" + entry.role : ""} (master מ-${source})`,
      },
    }).catch(() => {});

    return ok({
      id: entry.id,
      kind: entry.kind, chain: entry.chain, account: entry.account, role: entry.role,
      pub: entry.pub, priv,
    });
  } catch (e) {
    return fail(e);
  }
}
