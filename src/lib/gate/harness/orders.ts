/**
 * SOVEREIGN-HAND — controlled sovereign signing (audit step #4, the last one).
 *
 * The division of authority, enforced in code:
 *   · the AGENT builds — `steem.order.build` calls the key-free order builder
 *     (steem-order.ts) with a FIXED orderid + orderExpiration, so the exact
 *     order the operator reviews is the exact order that gets signed (the
 *     determinism contract). Building needs NO keys and touches NO funds.
 *   · the VAULT signs — only on an explicit operator decision (PATCH
 *     /api/gate/orders approve), only with the ACTIVE key of the commander
 *     account, only while the operator session has the vault open (master
 *     key in memory). A locked vault means no signature — fail closed.
 *   · the CHAIN answers — the signed tx is broadcast with the explicit
 *     broadcast-enabled adapter and the REAL txId is recorded in GateOrder +
 *     GateAction + the command bridge. Zero mock, end to end.
 *
 * Rails (bounded autonomy, never stampede): one pending order per agent,
 * fleet daily signed cap, notional cap, pending TTL — a stale proposal dies
 * honestly instead of lingering.
 */
import { db } from "@/lib/db";
import { requireMaster, openSecret, GateError } from "@/lib/gate/crypto";
import { steemBroadcastAdapter } from "@/lib/steem-server";
import { buildSteemOrderTx, buildSteemCancelTx } from "@/lib/steem-order";
import { PrivateKey, base58Decode } from "../../../../packages/crypto/src/index";
import { sha256 } from "@noble/hashes/sha2.js";

// secp256k1 group order — @noble/curves (audited); no hand-rolled crypto.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * The vault's headcorner WIFs are stored in the 52-char bitcoin-flavored
 * form ([0x80 ‖ 32B ‖ 0x01 ‖ 4B chk]). steem-js — which REGISTERED the
 * on-chain authorities — treats that payload's 33-byte body (32B ‖ 0x01)
 * as the WHOLE scalar (its `fromBuffer` warns "Expecting 32 bytes, instead
 * got 33" and multiplies on anyway). The live authority is therefore derived
 * from (body33 mod n), NOT from the canonical 32-byte scalar. Verified live
 * 2026-09-09 against headcorner's posting authority. Signing must reproduce
 * steem-js semantics or the chain answers "missing required active authority".
 * (This quirk is also the real story behind the AUTHORITY-DRIFT finding.)
 */
function toSigningKey(wif: string): PrivateKey {
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

/** The commander account whose ACTIVE key lives in the vault — never taken from agent input. */
export const COMMANDER_ACCOUNT = "headcorner";

export const ORDER_RAILS = {
  maxNotionalSteem: 100, // the STEEM leg cap per order (buy or sell)
  maxSignedPerDay: 6, // fleet-wide signed (broadcast) orders per UTC day
  pendingExpiryMs: 60 * 60_000, // a pending order expires after 60 minutes
  defaultTtlSeconds: 3600, // on-chain order TTL (clamped 120s..7d by the builder)
} as const;

export interface OrderPreview {
  orderId: string; // GateOrder id
  op: string;
  account: string;
  side?: string;
  amount?: string;
  price?: string;
  total?: string; // the counter-leg (SBD) — integer-exact from the builder
  notionalSteem: number;
  orderid?: number;
  expiresAt?: string;
  previewTxId?: string;
  note: string;
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function bridgeMsg(body: string, meta: Record<string, unknown>): Promise<void> {
  await db.gateMessage
    .create({ data: { channel: "command", fromKind: "system", fromName: "sovereign-hand", body: body.slice(0, 1000), meta: JSON.stringify(meta) } })
    .catch(() => {});
}

/* ══════════════════ build (agent side — key-free) ══════════════════ */

export interface BuildOrderInput {
  agentName: string;
  runId: string;
  op?: string; // "create" (default) | "cancel"
  side?: string; // buy | sell (create only)
  amount?: string; // STEEM leg, decimal string (create only)
  price?: string; // SBD per STEEM, decimal string (create only)
  ttlSeconds?: number;
  cancelOrderid?: number;
}

/**
 * The agent's one hand: prepare a REAL order. Every rail fails loudly with a
 * GateError so the maker learns the boundary instead of guessing it.
 */
export async function createOrderFromAgent(input: BuildOrderInput): Promise<OrderPreview> {
  const op = input.op === "cancel" ? "limit_order_cancel" : "limit_order_create";

  // rail — one pending proposal per agent: initiative, not spam
  const pending = await db.gateOrder.count({ where: { agentName: input.agentName, status: "pending" } });
  if (pending >= 1) throw new GateError("rate-limited", "יש לך כבר פקודה ממתינה להכרעת-מפעיל — חכה להחלטה לפני פקודה חדשה");
  // rail — fleet daily signed cap
  const dayStart = new Date(`${dayKey()}T00:00:00.000Z`);
  const signedToday = await db.gateOrder.count({ where: { status: "signed", decidedAt: { gte: dayStart } } });
  if (signedToday >= ORDER_RAILS.maxSignedPerDay) {
    throw new GateError("rate-limited", `תקרת-החתימות היומית של הצי מוצו (${signedToday}/${ORDER_RAILS.maxSignedPerDay}) — נסה מחר`);
  }

  const ttl = Math.min(Math.max(Number(input.ttlSeconds) || ORDER_RAILS.defaultTtlSeconds, 120), 7 * 86400);
  // unsigned uint32 — `& 0xffffffff` yields a SIGNED int32 (negative since
  // 2026-06, when Date.now() mod 2^32 crossed 2^31) and would fail the builder
  const orderid = Date.now() % 0x100000000; // fixed at BUILD time — the operator signs exactly this order
  const orderExpiration = Math.floor(Date.now() / 1000) + ttl;

  let specJson: string;
  let preview: Record<string, unknown>;
  let notionalSteem: number;
  let previewTxId: string | undefined;

  if (op === "limit_order_cancel") {
    const cancelOrderid = Number(input.cancelOrderid);
    if (!Number.isInteger(cancelOrderid) || cancelOrderid < 0 || cancelOrderid > 0xffffffff) {
      throw new GateError("bad-input", "דרוש params.cancelOrderid (uint32) — מזהה-ההזמנה שיש לבטל");
    }
    const b = await buildSteemCancelTx({ account: COMMANDER_ACCOUNT, orderid: cancelOrderid });
    specJson = JSON.stringify({ account: COMMANDER_ACCOUNT, orderid: cancelOrderid });
    preview = { op, account: COMMANDER_ACCOUNT, orderid: cancelOrderid, previewTxId: b.txId, note: "ביטול הזמנה — הכספת תחתום רק באישור-מפעיל" };
    notionalSteem = 0;
    previewTxId = b.txId;
  } else {
    const side = input.side === "buy" || input.side === "sell" ? input.side : null;
    if (!side) throw new GateError("bad-input", 'דרוש params.side ("buy"|"sell")');
    const amount = String(input.amount || "").trim();
    const price = String(input.price || "").trim();
    if (!/^\d+(\.\d{1,3})?$/.test(amount) || Number(amount) <= 0) throw new GateError("bad-input", 'דרוש params.amount תקין (ספרות-עשרון עד 3, למשל "0.100")');
    if (!/^\d+(\.\d{1,6})?$/.test(price) || Number(price) <= 0) throw new GateError("bad-input", 'דרוש params.price תקין (SBD ל-STEEM, עד 6 ספרות)');
    notionalSteem = Number(amount);
    if (notionalSteem > ORDER_RAILS.maxNotionalSteem) {
      throw new GateError("bad-input", `תקרת-הגודל: ${ORDER_RAILS.maxNotionalSteem} STEEM לפקודה (התקבל ${amount}) — חצייה ממתינה להחלטת-מפעיל מחוץ לגבולות-הצי`);
    }
    // the determinism contract: fixed orderid + orderExpiration ⇒ the signing
    // rebuild produces the SAME order the operator reviewed (only the ref-block
    // and tx-expiry are restamped fresh — that is what makes broadcast valid).
    const b = await buildSteemOrderTx({
      account: COMMANDER_ACCOUNT,
      side,
      amount,
      price,
      fillOrKill: false,
      ttlSeconds: ttl,
      orderid,
      orderExpiration,
    });
    specJson = JSON.stringify({ account: COMMANDER_ACCOUNT, side, amount, price, fillOrKill: false, ttlSeconds: ttl, orderid, orderExpiration });
    preview = {
      op,
      account: COMMANDER_ACCOUNT,
      side,
      amount: `${amount} STEEM`,
      price: `${price} SBD/STEEM`,
      total: `${Number(b.sellAsset.amount) / 1000} ${b.sellAsset.symbol}`, // the leg AT RISK, integer-exact
      notionalSteem,
      orderid,
      expiresAt: new Date(orderExpiration * 1000).toISOString(),
      previewTxId: b.txId,
      note: "בנוי ללא מפתחות — הכספת תחתום רק באישור-מפעיל מפורש",
    };
    previewTxId = b.txId;
  }

  const row = await db.gateOrder.create({
    data: {
      agentName: input.agentName,
      runId: input.runId,
      op,
      account: COMMANDER_ACCOUNT,
      spec: specJson,
      preview: JSON.stringify(preview),
      notionalSteem,
      status: "pending",
      previewTxId,
    },
  });
  const what = op === "limit_order_cancel"
    ? `ביטול הזמנה #${Number(input.cancelOrderid)}`
    : `${input.side === "buy" ? "קניית" : "מכירת"} ${input.amount} STEEM @ ${input.price} SBD`;
  await bridgeMsg(`✋ ${input.agentName} הכין פקודת-DEX (${what}) · orderid ${orderid} · ממתין לאישור-מפעיל — הכספת חותמת רק בהכרעה מפורשת`, { orderId: row.id, runId: input.runId });
  return { orderId: row.id, ...(preview as Omit<OrderPreview, "orderId" | "note">), note: String(preview.note) };
}

/* ══════════════════ decide (operator side — the vault signs) ══════════════════ */

async function commanderActiveKey(): Promise<PrivateKey> {
  // master must be in memory (operator session opened the vault) — fail closed
  requireMaster();
  const entry = await db.vaultEntry.findFirst({
    where: { chain: "steem", account: COMMANDER_ACCOUNT, role: "active" },
    orderBy: { updatedAt: "desc" },
  });
  if (!entry) throw new GateError("vault-missing-key", `אין מפתח-active של ${COMMANDER_ACCOUNT} בכספת — אי אפשר לחתום`);
  const wif = openSecret({ encPriv: entry.encPriv, privIv: entry.privIv, privTag: entry.privTag });
  return toSigningKey(wif);
}

/**
 * The operator's decision. Approval = rebuild (same spec) → sign with the
 * vault ACTIVE key → broadcast → real chain evidence recorded everywhere.
 * The vault must be open in THIS process — a locked vault refuses to sign.
 */
export async function approveOrder(id: string, operatorName: string): Promise<{ broadcastId: string; blockNum?: number }> {
  const o = await db.gateOrder.findUnique({ where: { id } });
  if (!o) throw new GateError("no-order", "אין פקודה כזו");
  if (o.status !== "pending") throw new GateError("already-decided", `הפקודה כבר הוכרעה (${o.status})`);

  const dayStart = new Date(`${dayKey()}T00:00:00.000Z`);
  const signedToday = await db.gateOrder.count({ where: { status: "signed", decidedAt: { gte: dayStart } } });
  if (signedToday >= ORDER_RAILS.maxSignedPerDay) {
    await db.gateOrder.update({ where: { id }, data: { status: "rejected", decidedBy: operatorName, decidedAt: new Date(), error: "תקרת-החתימות היומית מוצו" } });
    throw new GateError("rate-limited", `תקרת-החתימות היומית של הצי מוצו (${signedToday}/${ORDER_RAILS.maxSignedPerDay})`);
  }

  const priv = await commanderActiveKey();
  const adapter = steemBroadcastAdapter();
  try {
    const spec = JSON.parse(o.spec) as Record<string, unknown>;
    const unsigned =
      o.op === "limit_order_cancel"
        ? await buildSteemCancelTx({ account: String(spec.account), orderid: Number(spec.orderid) })
        : await buildSteemOrderTx({
            account: String(spec.account),
            side: spec.side === "buy" ? "buy" : "sell",
            amount: String(spec.amount),
            price: String(spec.price),
            fillOrKill: spec.fillOrKill === true,
            ttlSeconds: Number(spec.ttlSeconds) || ORDER_RAILS.defaultTtlSeconds,
            orderid: Number(spec.orderid), // EXACTLY the reviewed order (determinism contract)
            orderExpiration: Number(spec.orderExpiration),
          });
    const signed = await adapter.sign(unsigned.unsigned, { byRole: { active: priv } }, ["active"]);
    const res = await adapter.broadcast(signed);
    const broadcastId = res.txId || unsigned.txId;
    await db.gateOrder.update({
      where: { id },
      data: {
        status: "signed",
        decidedBy: operatorName,
        decidedAt: new Date(),
        previewTxId: unsigned.txId,
        broadcastId,
        blockNum: res.blockNum ?? null,
      },
    });
    await db.gateAction.create({
      data: {
        agentName: o.agentName,
        action: `sovereign-hand:${o.op}`,
        params: o.spec,
        ok: true,
        result: JSON.stringify({ broadcastId, blockNum: res.blockNum ?? null, orderId: id, signedBy: `${COMMANDER_ACCOUNT}@active` }),
      },
    });
    await bridgeMsg(
      `🖊️ הכספת חתמה ושידרה לשרשרת — פקודת ${o.op === "limit_order_cancel" ? "ביטול" : "DEX"} של ${o.agentName} על ${o.account} אושרה על-ידי המפעיל · txId: ${broadcastId}`,
      { orderId: id, broadcastId },
    );
    return { broadcastId, blockNum: res.blockNum };
  } catch (e) {
    // the chain said no (or the rebuild expired) — record the honest failure
    const msg = e instanceof Error ? e.message : String(e);
    await db.gateOrder.update({ where: { id }, data: { status: "failed", decidedBy: operatorName, decidedAt: new Date(), error: msg.slice(0, 400) } }).catch(() => {});
    await db.gateAction.create({
      data: { agentName: o.agentName, action: `sovereign-hand:${o.op}`, params: o.spec, ok: false, result: JSON.stringify({ error: msg.slice(0, 300), orderId: id }) },
    }).catch(() => {});
    await bridgeMsg(`❌ החתימה/השידור נכשלה עבור פקודת ${o.agentName}: ${msg.slice(0, 200)} — נרשם בכנות`, { orderId: id }).catch(() => {});
    throw new GateError("sign-failed", `החתימה/השידור נכשלה: ${msg.slice(0, 200)}`);
  }
}

export async function rejectOrder(id: string, operatorName: string): Promise<void> {
  const o = await db.gateOrder.findUnique({ where: { id } });
  if (!o) throw new GateError("no-order", "אין פקודה כזו");
  if (o.status !== "pending") throw new GateError("already-decided", `הפקודה כבר הוכרעה (${o.status})`);
  await db.gateOrder.update({ where: { id }, data: { status: "rejected", decidedBy: operatorName, decidedAt: new Date() } });
  await bridgeMsg(`❌ פקודת-ה-DEX של ${o.agentName} נדחתה על-ידי המפעיל — לא נחתמה ולא נשדרה`, { orderId: id });
}

/** Heart stage: a pending order nobody decided on dies honestly after its TTL. */
export async function expireStaleOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - ORDER_RAILS.pendingExpiryMs);
  const r = await db.gateOrder.updateMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    data: { status: "expired", decidedAt: new Date(), error: "לא הוכרעה בזמן — פגה בכנות (הלב)" },
  });
  if (r.count) await bridgeMsg(`⌛ ${r.count} פקודות-DEX ממתינות פגו ללא הכרעה — לא נחתמו`, {});
  return r.count;
}
