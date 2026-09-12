import { db } from "@/lib/db";
import { requireMaster, openSecretWith, GateError } from "@/lib/gate/crypto";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { wifToChainPub } from "@/lib/gate/key-id";

export const runtime = "nodejs";

/**
 * r37 — KEY DEEP-CHECK ("בדיקת-המפתח לעומק").
 *
 * Every headcorner WIF held by the vault is opened with the live master,
 * re-derived to its public key (proof the encrypted material is VALID, not
 * just decryptable) and matched against the CURRENT on-chain authority of
 * headcorner on steem + hive (condenser_api.get_accounts, live RPC).
 *
 * This is the standing answer to "האם המפתח הראשוני שלי בכספת וזמין
 * לפעולה מיידית" — a mechanical per-role verdict, never an assumption.
 * The response carries public metadata only (roles, verdicts, counts).
 */
const CHAINS: Record<string, string> = {
  steem: "https://api.steemit.com",
  hive: "https://api.hive.blog",
};
const ACCOUNT = "headcorner";

interface ChainAccount {
  name: string;
  owner: { key_auths: [string, number][] };
  active: { key_auths: [string, number][] };
  posting: { key_auths: [string, number][] };
  memo_key: string;
}

async function fetchAccount(rpc: string): Promise<ChainAccount | null> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { result?: ChainAccount[] };
  return j.result?.[0] ?? null;
}

export async function POST() {
  try {
    await requireOperator();
    const master = requireMaster();
    const rows = await db.vaultEntry.findMany({
      where: { account: ACCOUNT, kind: "steem-key" },
      orderBy: [{ chain: "asc" }, { role: "asc" }],
    });

    // live authorities — a down network is an honest "no verdict", never a conviction
    const accounts: Record<string, ChainAccount | null> = {};
    const chainsDown: string[] = [];
    for (const [chain, rpc] of Object.entries(CHAINS)) {
      try { accounts[chain] = await fetchAccount(rpc); }
      catch { accounts[chain] = null; chainsDown.push(chain); }
    }

    interface KeyVerdict { chain: string; role: string; status: string; liveRoles: string[]; note: string }
    const keys: KeyVerdict[] = [];
    let validCount = 0, liveCount = 0, deadCount = 0, brokenCount = 0;

    for (const e of rows) {
      const item: KeyVerdict = { chain: e.chain ?? "?", role: e.role ?? "?", status: "broken", liveRoles: [], note: "" };
      try {
        const priv = openSecretWith(master, e);
        const pub = wifToChainPub(priv); // throws on corrupt/invalid material
        item.status = "valid";
        validCount++;
        const acct = accounts[e.chain ?? ""];
        if (acct) {
          const auths: Record<string, string[]> = {
            owner: acct.owner.key_auths.map(([k]) => k),
            active: acct.active.key_auths.map(([k]) => k),
            posting: acct.posting.key_auths.map(([k]) => k),
            memo: [acct.memo_key],
          };
          item.liveRoles = Object.entries(auths).filter(([, pubs]) => pubs.includes(pub)).map(([role]) => role);
          if (item.liveRoles.length) { item.status = "live-authority"; liveCount++; }
          else { item.status = "valid-rotated-out"; deadCount++; item.note = "חומר תקין אך מחוץ-לסמכות החיה (מת מאז רוטציה)"; }
        } else {
          item.note = "הרשת לא נענו — ללא שיפוט חי הפעם";
        }
      } catch (err) {
        brokenCount++;
        item.note = String((err as Error).message || err).slice(0, 140);
      }
      keys.push(item);
    }

    const reachable = Object.keys(CHAINS).length - chainsDown.length;
    const meaning = reachable === 0
      ? `בדיקת-עומק: ${validCount}/${rows.length} חומר-מפתח תקין (נגזר בהצלחה) · שתי הרשתות לא נענו — אין שיפוט-סמכות חי הפעם (כנות, לא הרשעה).`
      : `בדיקת-עומק: ${validCount}/${rows.length} מפתחות-headcorner בכספת הם חומר-תקין שנגזר בהצלחה · ${liveCount} מחזיקים סמכות-חיה על ${ACCOUNT} · ${deadCount} תקינים-שמחוץ-לסמכות · ${brokenCount} פגומים${chainsDown.length ? " · רשתות-שלא-נענו: " + chainsDown.join(",") : ""}.`;

    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: meaning },
    }).catch(() => {});

    return ok({ at: new Date().toISOString(), account: ACCOUNT, total: rows.length, validCount, liveCount, deadCount, brokenCount, chainsDown, keys, meaning });
  } catch (e) {
    if (e instanceof GateError && e.code === "vault-locked") {
      return Response.json({ ok: false, code: "vault-locked", error: "הכספת נעולה — הכנס כדי להדליק את מפתח-האב" }, { status: 423 });
    }
    return fail(e);
  }
}
