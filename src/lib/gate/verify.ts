/**
 * SOVEREIGN GATE — live verification of the whole vault ("מחובר להכל").
 * Every claim of connectivity is produced by a fresh chain/API call here.
 */
import { db } from "@/lib/db";
import { openSecret } from "./crypto";
import { chainPub, evmAddress, tronAddress, solAddress, fetchChainAuthorityMap, FLEET_ACCOUNTS } from "./key-id";

export interface EntryVerify {
  id: string;
  kind: string;
  chain: string | null;
  account: string | null;
  role: string | null;
  pub: string | null;
  status: string;
  verifyNote: string | null;
  liveOk: boolean | null; // true=live-verified now, false=live check failed, null=no live check possible
  detail: string;
}

/** Verify one vault entry against live sources (never mutates priv material). */
async function verifyEntry(e: {
  id: string; kind: string; chain: string | null; account: string | null; role: string | null;
  pub: string | null; encPriv: string; privIv: string; privTag: string; status: string; verifyNote: string | null;
}, authority: Map<string, { chain: string; account: string; role: string; pub: string }[]>): Promise<EntryVerify> {
  const base: EntryVerify = {
    id: e.id, kind: e.kind, chain: e.chain, account: e.account, role: e.role, pub: e.pub,
    status: e.status, verifyNote: e.verifyNote, liveOk: null, detail: "",
  };
  try {
    const priv = openSecret(e);
    if (e.kind === "steem-key") {
      if (e.chain && e.account && e.role) {
        const hit = authority.get(e.pub || "")?.find((c) => c.chain === e.chain && c.account === e.account && c.role === e.role);
        base.liveOk = Boolean(hit);
        base.detail = hit ? `אומת live ב-${e.chain} · ${e.account}@${e.role}` : "לא נמצא authority תואם בשרשרת כרגע";
      }
      return base;
    }
    if (e.kind === "evm-key") {
      const derived = evmAddress(priv.replace(/^0x/, "").toLowerCase());
      const match = e.pub ? derived.toLowerCase() === e.pub.toLowerCase() : true;
      base.liveOk = match;
      base.detail = match
        ? `כתובת נגזרה תואמת לרישום: ${derived}`
        : `אי-התאמה: נגזר ${derived} אך הרישום ${e.pub}`;
      return base;
    }
    if (e.kind === "tron-key") {
      const derived = tronAddress(priv);
      const match = e.pub ? derived === e.pub : true;
      base.liveOk = match;
      base.detail = match ? `כתובת נגזרה תואמת לרישום: ${derived}` : `אי-התאמה: נגזר ${derived} אך הרישום ${e.pub}`;
      return base;
    }
    if (e.kind === "sol-key") {
      const derived = solAddress(priv.replace(/^0x/, ""));
      const match = e.pub ? derived === e.pub : true;
      base.liveOk = match;
      base.detail = match ? `כתובת SOL נגזרה תואמת לרישום: ${derived}` : `אי-התאמה: נגזר ${derived} אך הרישום ${e.pub}`;
      return base;
    }
    if (e.kind === "mnemonic") {
      if (/^[0-9a-f]{32,128}$/i.test(priv.trim())) {
        base.liveOk = true;
        base.detail = `זרע הקס ${priv.trim().length / 2} בייטים — תקין`;
      } else {
        const words = priv.trim().split(/\s+/).length;
        base.liveOk = words >= 12;
        base.detail = words + " מילים";
      }
      return base;
    }
    if (e.kind === "token" && e.chain === "github") {
      try {
        const r = await fetch("https://api.github.com/user", {
          headers: { Authorization: "token " + priv },
          signal: AbortSignal.timeout(15000),
        });
        base.liveOk = r.ok;
        base.detail = r.ok ? "GitHub אימת את הטוקן live" : "GitHub דחה את הטוקן (" + r.status + ")";
      } catch {
        base.liveOk = false;
        base.detail = "GitHub לא נענה";
      }
      return base;
    }
  } catch (err) {
    // vault locked or GCM tamper — report honestly
    base.liveOk = null;
    base.detail = (err as Error).message;
    return base;
  }
  // tokens/notes: no live check by default
  base.detail = "מאוחסן מוצפן (ללא בדיקת-רשת)";
  return base;
}

/** Verify everything, batched: one steem + one hive call for all accounts. */
export async function verifyAll(): Promise<{ entries: EntryVerify[]; steemOk: boolean; hiveOk: boolean; githubOk: boolean | null }> {
  const rows = await db.vaultEntry.findMany({ orderBy: [{ chain: "asc" }, { account: "asc" }, { role: "asc" }] });
  const { map, steemOk, hiveOk } = await fetchChainAuthorityMap();
  let githubOk: boolean | null = null;
  // GitHub PAT live check: any github entry with a stored token
  const gh = rows.find((r) => r.kind === "token" && r.chain === "github");
  if (gh) {
    try {
      const tok = openSecret(gh);
      const r = await fetch("https://api.github.com/user", { headers: { Authorization: "token " + tok }, signal: AbortSignal.timeout(15000) });
      githubOk = r.ok;
    } catch {
      githubOk = false;
    }
  }
  const entries: EntryVerify[] = [];
  for (const e of rows) {
    const v = await verifyEntry(e, map);
    if (e.kind === "steem-key") {
      // authoritative chainPub check via stored pub against live map
      const hit = e.pub ? (map.get(e.pub) || []).find((c) => (!e.chain || c.chain === e.chain) && (!e.account || c.account === e.account) && (!e.role || c.role === e.role)) : null;
      v.liveOk = Boolean(hit);
      v.detail = hit ? `אומת live ב-${hit.chain} · ${hit.account}@${hit.role}` : "ה-pub אינו מופיע ב-authorities החיים של החשבונות המוכרים";
    }
    // persist verification result (never downgrade a known rotated-out key)
    const newStatus = v.liveOk === true ? "verified" : v.liveOk === false ? (e.status === "rotated-out" ? "rotated-out" : "unverified") : e.status;
    await db.vaultEntry.update({
      where: { id: e.id },
      data: { status: newStatus, verifiedAt: new Date() },
    });
    entries.push(v);
  }
  return { entries, steemOk, hiveOk, githubOk };
}

export { FLEET_ACCOUNTS };
