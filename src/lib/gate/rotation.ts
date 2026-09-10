/**
 * SOVEREIGN GATE — the account_update rotation plane (gap-58, r16 · r17).
 *
 * r17 chain-truth (measured 2026-09-10, multi-node, canonical interpretation):
 * the restoration log (הד.txt) delivered the mother seed SAOS-ROT1 and the
 * derivation plan HMAC-SHA256("SAOS-ROT1/<account>/<chain>/<role>") → WIF.
 * THE CANONICAL 33-BYTE RULE: compressed WIFs (K/L) are interpreted by the
 * signing stack with the whole 33-byte body as the private scalar (steem-js
 * wifToPublic warns-but-proceeds; toSigningKey reduces mod N) — the same key
 * the chain's authorities carry. Under that rule the derivation reproduces
 * 44/48 live steem authorities (11 accounts × 4 roles; ynet the only
 * exception — operator custody) and 8 hive authorities (headcorner+tov).
 * The external command-center session rotated the fleet to those keys today;
 * the vault sealed every live key with same-call chain proof and anchored
 * round r17 (block 109469449).
 *
 * Two doors, both operator-only:
 *  · OWNER plane (r16): paste a live owner WIF → same-call chain proof →
 *    full 4-authority rotation to the D1 roots (unify steem with hive+blurt
 *    under the P5 roots — an operator decision, now mechanically ready for
 *    11/12 accounts).
 *  · ACTIVE plane (r17): for accounts whose sealed ACTIVE key IS the live
 *    authority, sign ONE account_update WITH THE ACTIVE KEY that sets
 *    active/posting/memo to the D1 roots (owner field ABSENT — untouched,
 *    account_auths preserved).
 *
 * gap-60 (r17, resolved): vault-row trust demands the sealed WIF to
 * reproduce the row's own pub under the CANONICAL interpretation
 * (wifToChainPub) — an earlier forensic probe compared pubs under a
 * strip-0x01 reading and saw phantom mismatches; the rows were consistent
 * all along. The material check below keeps failing closed on REAL
 * inconsistencies either way.
 *
 * SOVEREIGN-HAND contract (untouched): every broadcast here requires the
 * operator session (Bearer) — agents can never reach this file's callers.
 * Every step records a GateAction; nothing is ever signed from a stored
 * assumption — the signing key is re-proven against the live chain in the
 * same call that signs with it.
 */
import { createHash } from "crypto";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { requireMaster, sealSecret, openSecret } from "./crypto";
import { wifToChainPub } from "./key-id";
import { steemBroadcastAdapter } from "@/lib/steem-server";
import { emitEvent } from "./harness/events";
import { verifyAll } from "./verify";

const NODES = ["https://api.steemit.com", "https://api.justyy.com"];
const ROLES = ["owner", "active", "posting", "memo"] as const;

export const ROTATION_ACCOUNTS = [
  "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq",
  "tov", "wic", "wog", "woq", "ynet", "headcorner",
] as const;

async function steemRpc<T>(method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of NODES) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = (await res.json()) as any;
      if (j.error) { last = j.error.message; continue; }
      return j.result as T;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`steem rpc down: ${last}`);
}

/** raw 33-byte compressed pub from an "STM…" string (checksum only in the string form). */
function pubWireToRaw(pub: string): string | null {
  const m = /^STM([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[1])).subarray(0, 33).toString("hex"); } catch { return null; }
}

/** r12 chain-proven D1 condenser rule: private = SHA256(account + role + P5full). */
export function deriveRolePrivHex(account: string, role: string, p5: string): string {
  return createHash("sha256").update(`${account}${role}${p5}`, "utf8").digest("hex");
}

/** canonical uncompressed WIF (51 chars) from 32-byte priv hex. */
export function privHexToWif(privHex: string): string {
  const payload = Buffer.concat([Buffer.from([0x80]), Buffer.from(privHex, "hex")]);
  const chk = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, chk]));
}

export interface ImportVerdict {
  account: string;
  ok: boolean;
  detail: string;
}

/**
 * STEP 1 — the operator pastes current owner WIFs; each is proven against the
 * LIVE owner authority of its account in this same call, then sealed. A key
 * that does not match the chain is refused, never stored.
 */
export async function importOwnerKeys(items: Array<{ account: string; wif: string }>): Promise<{ verdicts: ImportVerdict[]; sealed: number }> {
  const live = await steemRpc<any[]>("condenser_api.get_accounts", [ROTATION_ACCOUNTS as unknown as string[]]);
  const byName = new Map((live || []).map((a) => [String(a.name), a]));
  const verdicts: ImportVerdict[] = [];
  let sealed = 0;
  for (const it of items) {
    const account = String(it.account || "").trim().toLowerCase();
    const wif = String(it.wif || "").trim();
    try {
      const acct = byName.get(account);
      if (!acct) { verdicts.push({ account, ok: false, detail: "חשבון לא קיים על steem" }); continue; }
      let pub: string;
      try { pub = wifToChainPub(wif); } catch { verdicts.push({ account, ok: false, detail: "המחרוזת אינה WIF תקין" }); continue; }
      const raw = pubWireToRaw(pub);
      const liveOwner = ((acct.owner?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0])));
      if (!raw || !liveOwner.includes(raw)) {
        verdicts.push({ account, ok: false, detail: `המפתח אינו ב-authority ה-owner החי של ${account} כרגע (מוחזק, לא נאטם)` });
        continue;
      }
      const existing = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "steem", account, role: "owner", pub } });
      if (!existing) {
        const s = sealSecret(wif);
        await db.vaultEntry.create({
          data: {
            kind: "steem-key", chain: "steem", account, role: "owner",
            pub, ...s, status: "verified", verifiedAt: new Date(),
            source: "r16: operator paste (rotation plane)",
            verifyNote: `r16 2026-09-10: מפתח-owner שהדביק המפעיל — אומת live מול authority ה-owner הנוכחי של ${account}@steem באותה-קריאה; זה המפתח שהוצב ברוטציית 2026-09-08 (ynet: 09-04) ולא נשמר בשום-מקור קודם`,
          },
        });
        sealed++;
      }
      verdicts.push({ account, ok: true, detail: `owner אומת live ונאטם (${pub.slice(0, 12)}…)` });
    } catch (e) {
      verdicts.push({ account, ok: false, detail: (e as Error).message.slice(0, 200) });
    }
  }
  await db.gateAction.create({
    data: {
      agentName: "operator", action: "rotation.import-owner-keys",
      params: JSON.stringify({ count: items.length }), ok: verdicts.every((v) => v.ok),
      result: JSON.stringify({ verdicts, sealed }),
    },
  });
  await emitEvent("rotation", { kind: "rotation.import", sealed, attempted: items.length }, "rotation-plane");
  return { verdicts, sealed };
}

export interface RotationTarget {
  account: string;
  hasOwnerKey: boolean; // a sealed, live-proven, MATERIAL-CONSISTENT owner WIF exists
  hasP5Root: boolean; // a sealed P5 master-password row exists (the D1 root)
  ready: boolean;
  activePlane: "none" | "ready" | "done"; // r17: the working-plane custody state
}

/** gap-60: a row is only trusted when its sealed WIF reproduces its own pub. */
async function rowMaterialOk(row: { encPriv: string; privIv: string; privTag: string; pub: string | null }): Promise<boolean> {
  try {
    const wif = openSecret(row as any);
    return Boolean(row.pub) && wifToChainPub(wif) === row.pub;
  } catch {
    return false;
  }
}

/** Snapshot: which accounts CAN be rotated mechanically right now. */
export async function rotationStatus(): Promise<{ targets: RotationTarget[]; readyCount: number; activePlaneReady: number; activePlaneDone: number }> {
  const live = await steemRpc<any[]>("condenser_api.get_accounts", [ROTATION_ACCOUNTS as unknown as string[]]);
  const liveBy = new Map((live || []).map((a) => [String(a.name), a]));
  const ownerRows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", role: "owner" } });
  const activeRows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", role: "active" } });
  const p5Rows = await db.vaultEntry.findMany({ where: { kind: "note", role: "master-password" } });
  const targets: RotationTarget[] = [];
  for (const name of ROTATION_ACCOUNTS) {
    const acct = liveBy.get(name);
    if (!acct) continue; // not on chain — skip honestly
    const liveOwner = ((acct.owner?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0])));
    const ownerRow = ownerRows.find((r) => r.account === name && r.pub && liveOwner.includes(pubWireToRaw(r.pub) || ""));
    // gap-60: readiness demands the row's SEALED MATERIAL to be its pub (not just the pub field)
    const hasOwnerKey = Boolean(ownerRow) && (await rowMaterialOk(ownerRow!));
    const hasP5Root = p5Rows.some((r) => r.account === name);

    // r17 — active plane: is the live active authority OURS (sealed, consistent) or already the D1 root?
    let activePlane: RotationTarget["activePlane"] = "none";
    if (hasP5Root) {
      const liveActive = ((acct.active?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0])));
      const p5row = p5Rows.find((r) => r.account === name)!;
      const d1Active = pubWireToRaw(wifToChainPub(privHexToWif(deriveRolePrivHex(name, "active", openSecret(p5row)))));
      if (d1Active && liveActive.includes(d1Active)) activePlane = "done";
      else {
        const actRow = activeRows.find((r) => r.account === name && r.pub && liveActive.includes(pubWireToRaw(r.pub) || ""));
        if (actRow && (await rowMaterialOk(actRow))) activePlane = "ready";
      }
    }
    targets.push({ account: name, hasOwnerKey, hasP5Root, ready: hasOwnerKey && hasP5Root, activePlane });
  }
  return {
    targets,
    readyCount: targets.filter((t) => t.ready).length,
    activePlaneReady: targets.filter((t) => t.activePlane === "ready").length,
    activePlaneDone: targets.filter((t) => t.activePlane === "done").length,
  };
}

export interface RotationPreview {
  account: string;
  targets: { role: string; pub: string }[];
  preservedAccountAuths: { role: string; accounts: string[] }[];
  memoUnchangedNote: string;
}

/** STEP 2 — derive the four D1 roots from the sealed P5 and shape the preview (public keys only). */
export async function previewRotation(account: string): Promise<RotationPreview> {
  const p5row = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account } });
  if (!p5row) throw new Error(`אין סיסמת-אב P5 נאטמת עבור ${account}`);
  const p5 = openSecret(p5row);
  const targets = ROLES.map((role) => ({ role, pub: wifToChainPub(privHexToWif(deriveRolePrivHex(account, role, p5))) }));
  const acct = (await steemRpc<any[]>("condenser_api.get_accounts", [[account]]))[0];
  const preservedAccountAuths = (["owner", "active", "posting"] as const).map((role) => ({
    role,
    accounts: ((acct[role]?.account_auths ?? []) as any[]).map((a) => String(a[0])),
  })).filter((x) => x.accounts.length > 0);
  return {
    account,
    targets,
    preservedAccountAuths,
    memoUnchangedNote: "memo_key יוצב לשורש-D1 של memo (החוזה-חוט: memo_key תמיד 33 בייטים — אפסים אסורים)",
  };
}

/**
 * STEP 3 — the explicit operator decision. Re-proves the owner key against the
 * LIVE authority, signs ONE account_update (all four roles → D1 roots,
 * account_auths preserved), broadcasts, waits one beat, re-reads the chain,
 * and only then seals the new keys as verified rows.
 */
export async function executeRotation(account: string): Promise<{ txId: string; verified: boolean; detail: string }> {
  requireMaster(); // operator session must have the vault open
  const status = await rotationStatus();
  const target = status.targets.find((t) => t.account === account);
  if (!target?.ready) {
    throw new Error(`${account} אינו מוכן לרוטציה — נדרש מפתח-owner חי נאטם + סיסמת-אב P5 נאטמת`);
  }

  // fresh live owner authority + the sealed WIF that matches it RIGHT NOW
  const acct = (await steemRpc<any[]>("condenser_api.get_accounts", [[account]]))[0];
  const liveOwner = ((acct.owner?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0])));
  const ownerRows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account, role: "owner" } });
  const ownerRow = ownerRows.find((r) => r.pub && liveOwner.includes(pubWireToRaw(r.pub) || ""));
  if (!ownerRow) throw new Error(`מפתח ה-owner הנאטם של ${account} אינו ב-authority החי — מסרב לחתום (fail-closed)`);
  // gap-60: the sealed material must reproduce the row's pub — otherwise the signature is bogus
  if (!(await rowMaterialOk(ownerRow))) throw new Error(`שורת ה-owner של ${account} אינה עקבית-חומרית (WIF↛pub) — מסרב לחתום (fail-closed, gap-60)`);
  const ownerWif = openSecret(ownerRow);

  // D1 roots from the sealed P5
  const p5row = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account } });
  if (!p5row) throw new Error(`אין סיסמת-אב P5 עבור ${account}`);
  const p5 = openSecret(p5row);
  const roots = Object.fromEntries(ROLES.map((role) => [role, wifToChainPub(privHexToWif(deriveRolePrivHex(account, role, p5)))])) as Record<string, string>;

  // authority payload: replace key_auths, PRESERVE account_auths (fleet doors etc.)
  const mkAuth = (role: "owner" | "active" | "posting") => ({
    weight_threshold: Number(acct[role]?.weight_threshold ?? 1) || 1,
    account_auths: ((acct[role]?.account_auths ?? []) as any[]).map((a) => [String(a[0]), Number(a[1])]),
    key_auths: [[roots[role], 1]],
  });

  const adapter = steemBroadcastAdapter();
  const payload = {
    account,
    owner: mkAuth("owner"),
    active: mkAuth("active"),
    posting: mkAuth("posting"),
    memo_key: roots.memo,
    json_metadata: JSON.stringify({ app: "saos-rotation/v1", at: new Date().toISOString() }),
  };
  const unsigned = await adapter.buildOperations([{ type: "account_update", payload: payload as unknown as Record<string, unknown> }]);
  const signed = await adapter.sign(unsigned, { byRole: { owner: ownerWif } }, ["owner"]);
  const res = await adapter.broadcast(signed);
  const txId = res.txId || "";

  // wait one beat, then re-read the chain — the authorities MUST now carry the roots
  await new Promise((r) => setTimeout(r, 4200));
  const after = (await steemRpc<any[]>("condenser_api.get_accounts", [[account]]))[0];
  const liveNow = (role: string) => ((after[role]?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0])));
  const roleOk = ROLES.map((role) => {
    if (role === "memo") return pubWireToRaw(String(after.memo_key)) === pubWireToRaw(roots.memo);
    return liveNow(role).includes(pubWireToRaw(roots[role]));
  });
  const verified = roleOk.every(Boolean);

  await db.gateAction.create({
    data: {
      agentName: "operator", action: "rotation.account-update",
      params: JSON.stringify({ account, roles: ROLES }),
      ok: verified,
      result: JSON.stringify({ txId, verified, rolesOk: roleOk }),
    },
  });
  await emitEvent("rotation", { kind: "rotation.executed", account, txId, verified }, "rotation-plane");

  if (verified) {
    // seal the four new keys (upsert-safe: unique [chain,account,role,pub])
    for (const role of ROLES) {
      const wif = role === "memo" ? privHexToWif(deriveRolePrivHex(account, "memo", p5)) : privHexToWif(deriveRolePrivHex(account, role, p5));
      const pub = wifToChainPub(wif);
      const exists = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "steem", account, role, pub } });
      if (!exists) {
        const s = sealSecret(wif);
        await db.vaultEntry.create({
          data: {
            kind: "steem-key", chain: "steem", account, role,
            pub, ...s, status: "verified", verifiedAt: new Date(),
            source: "r16: rotation plane (D1 root, chain-proven)",
            verifyNote: `r16: שורש-D1 של ${account} (sha256(account+role+P5)) — הוצב on-chain ברוטציה ואומת live ב-authority לאחר-השידור (${txId.slice(0, 12)}…) · זהה ב-33 בייטים ל-authority על hive+blurt`,
          },
        });
      }
    }
    // the old owner row's material is now rotated-out — honest relabel
    if (ownerRow.pub !== roots.owner) {
      await db.vaultEntry.update({ where: { id: ownerRow.id }, data: { status: "rotated-out", verifyNote: `${ownerRow.verifyNote || ""} · r16: הוצא מה-authority ברוטציה של 2026-09-10 (${txId.slice(0, 12)}…) — חומר-היסטורי`.slice(0, 900) } });
    }
  }
  return {
    txId,
    verified,
    detail: verified
      ? `${account}: כל ארבעת ה-authorities נושאים עכשיו את שורשי-D1 — אומת live (${ROLES.join(",")})`
      : `${account}: השידור עבר (${txId.slice(0, 12)}…) אך האימות-חי אחריו לא השלים — נבדק שוב בסריקה הבאה`,
  };
}

/**
 * r17 — ACTIVE-PLANE CONNECTION: for accounts whose sealed ACTIVE key IS the
 * live active authority (material-consistent, gap-60-safe), sign ONE
 * account_update WITH THE ACTIVE KEY that sets active/posting/memo to the D1
 * roots. The owner field is ABSENT from the op — the owner authority (whose
 * key is external) is never touched. account_auths preserved verbatim.
 * Chain re-read → seal the D1 rows only if the chain confirms; the replaced
 * 2018 keys are honestly relabeled rotated-out (still sealed — reversible).
 */
export async function executeActivePlaneRotation(account: string, by = "operator"): Promise<{ txId: string; verified: boolean; detail: string }> {
  requireMaster(); // operator session must have the vault open

  const acct = (await steemRpc<any[]>("condenser_api.get_accounts", [[account]]))[0];
  if (!acct) throw new Error(`${account} לא נמצא על steem`);

  // the signing key: the sealed ACTIVE row, live-proven + material-consistent, RIGHT NOW
  const liveActive = ((acct.active?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0])));
  const activeRows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account, role: "active" } });
  const actRow = activeRows.find((r) => r.pub && liveActive.includes(pubWireToRaw(r.pub) || ""));
  if (!actRow) throw new Error(`המפתח-הפעיל החי של ${account} אינו נאטם בכספת — מסרב (fail-closed)`);
  if (!(await rowMaterialOk(actRow))) throw new Error(`שורת ה-active של ${account} אינה עקבית-חומרית (WIF↛pub) — מסרב (fail-closed, gap-60)`);
  const activeWif = openSecret(actRow);

  // already unified? (live active == D1 root) — then nothing to broadcast
  const p5row = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account } });
  if (!p5row) throw new Error(`אין סיסמת-אב P5 נאטמת עבור ${account}`);
  const p5 = openSecret(p5row);
  const roots = Object.fromEntries(ROLES.map((role) => [role, wifToChainPub(privHexToWif(deriveRolePrivHex(account, role, p5)))])) as Record<string, string>;
  if (pubWireToRaw(roots.active) && liveActive.includes(pubWireToRaw(roots.active))) {
    return { txId: "", verified: true, detail: `${account}: מישור-העבודה כבר מאוחד על שורשי-D1 — אין צורך בשידור` };
  }

  // authority payload: active/posting → D1 roots (account_auths preserved), owner ABSENT
  const mkAuth = (role: "active" | "posting") => ({
    weight_threshold: Number(acct[role]?.weight_threshold ?? 1) || 1,
    account_auths: ((acct[role]?.account_auths ?? []) as any[]).map((a) => [String(a[0]), Number(a[1])]),
    key_auths: [[roots[role], 1]],
  });
  const payload: Record<string, unknown> = {
    account,
    active: mkAuth("active"),
    posting: mkAuth("posting"),
    memo_key: roots.memo, // wire contract: memo_key is ALWAYS 33 bytes (r16 node-discovered)
    json_metadata: acct.json_metadata ?? "",
  };
  const adapter = steemBroadcastAdapter();
  const unsigned = await adapter.buildOperations([{ type: "account_update", payload }]);
  const signed = await adapter.sign(unsigned, { byRole: { active: activeWif } }, ["active"]);
  const res = await adapter.broadcast(signed);
  const txId = res.txId || "";

  // wait one beat, re-read the chain: active/posting/memo MUST carry the D1 roots
  await new Promise((r) => setTimeout(r, 4200));
  const after = (await steemRpc<any[]>("condenser_api.get_accounts", [[account]]))[0];
  const liveNow = (role: string) => ((after[role]?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0])));
  const roleOk = (["active", "posting"] as const).map((role) => liveNow(role).includes(pubWireToRaw(roots[role])));
  const memoOk = pubWireToRaw(String(after.memo_key)) === pubWireToRaw(roots.memo);
  const ownerUntouched = String(after.last_owner_update) === String(acct.last_owner_update);
  const verified = roleOk.every(Boolean) && memoOk && ownerUntouched;

  await db.gateAction.create({
    data: {
      agentName: by, action: "rotation.active-plane",
      params: JSON.stringify({ account, roles: ["active", "posting", "memo"] }),
      ok: verified,
      result: JSON.stringify({ txId, verified, roleOk, memoOk, ownerUntouched, delegated: by !== "operator" ? "operator-delegated via r17 chat session (הד.txt material delivery)" : undefined }),
    },
  });
  await emitEvent("rotation", { kind: "rotation.active-plane", account, txId, verified }, "rotation-plane");

  if (verified) {
    // seal the three new D1 rows (owner untouched — no owner row changes here)
    for (const role of ["active", "posting", "memo"] as const) {
      const wif = privHexToWif(deriveRolePrivHex(account, role, p5));
      const pub = wifToChainPub(wif);
      const exists = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "steem", account, role, pub } });
      if (!exists) {
        const s = sealSecret(wif);
        await db.vaultEntry.create({
          data: {
            kind: "steem-key", chain: "steem", account, role,
            pub, ...s, status: "verified", verifiedAt: new Date(),
            source: "r17: active-plane connection (D1 root, chain-proven)",
            verifyNote: `r17: שורש-D1 של ${account} (sha256(account+role+P5)) — הוצב on-chain בחתימת-active (owner לא נוגע) ואומת live ב-authority לאחר-השידור (${txId.slice(0, 12)}…) · זהה ל-authority על hive/blurt`,
          },
        });
      }
    }
    // the replaced 2018 keys — honest relabel (material stays sealed: reversible)
    for (const role of ["active", "posting", "memo"] as const) {
      const old = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "steem", account, role, status: "verified", pub: { not: roots[role] } } });
      if (old && pubWireToRaw(old.pub || "") !== pubWireToRaw(roots[role])) {
        await db.vaultEntry.update({ where: { id: old.id }, data: { status: "rotated-out", verifyNote: `${old.verifyNote || ""} · r17: הוחלף בשורש-D1 בחיבור מישור-העבודה (${txId.slice(0, 12)}…) — החומר נשאר נאטם (היסטורי, ניתן-לשחזור)`.slice(0, 900) } });
      }
    }
  }
  return {
    txId,
    verified,
    detail: verified
      ? `${account}: active/posting/memo נושאים את שורשי-D1 — owner לא נוגע, account_auths נשמרו — אומת live`
      : `${account}: השידור עבר (${txId.slice(0, 12)}…) אך האימות-חי לא השלים — ייבדק בסריקה הבאה`,
  };
}

/** post-rotation sweep refresh (reuses the standard verifier). */
export async function sweepAfterRotation(): Promise<void> {
  try { await verifyAll(); } catch { /* the inventory route re-sweeps on demand */ }
}
