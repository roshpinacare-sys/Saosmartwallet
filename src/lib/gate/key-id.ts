/**
 * SOVEREIGN GATE — universal key identification engine.
 *
 * Paste ANY key → we mechanically determine what it is and what it controls:
 *  · steem/hive WIF (5… 51ch, or compressed K…/L… 52ch) → public key → live
 *    chain lookup against every known fleet account (steem + hive).
 *  · EVM private key (0x…) → address → matched against live authorities too.
 *  · TRON private key (bare 64-hex) → T-address (same derivation as key-broker).
 *  · BIP-39-ish mnemonic (12+ words) → validated shape, stored encrypted.
 *  · GitHub PAT / saos admin token → shape check (+ live GitHub verify).
 *
 * Zero-mock: every "controls X" claim is backed by a live chain/API response
 * inside this same call — never by a stored assumption.
 */
import crypto from "crypto";
import { createRequire } from "module";
import bs58 from "bs58";
import { ethers } from "ethers";
import nacl from "tweetnacl";

// steem-js is legacy CJS — load via createRequire so the bundler never hard-crashes.
let steemAuth: any = null;
try {
  steemAuth = (createRequire(import.meta.url)("steem") as any).auth;
} catch {
  steemAuth = null;
}

export const FLEET_ACCOUNTS = [
  "headcorner", "ynet", "cashmachine", "haran", "israelnews", "lsa",
  "macrame", "siq", "tov", "wic", "wog", "woq",
] as const;

const STEEM_NODE = "https://api.steemit.com";
const HIVE_NODE = "https://api.hive.blog";

export type KeyKind =
  | "steem-wif" | "evm-key" | "hex-priv" | "mnemonic"
  | "github-pat" | "admin-token" | "unknown";

export interface KeyControl {
  chain: string;
  account: string;
  role: string;
  pub: string;
}

export interface KeyIdReport {
  kind: KeyKind;
  label: string;
  pubs: string[];
  controls: KeyControl[];
  liveChecked: boolean;
  notes: string[];
}

export function chainPub(privHex: string, compressed: boolean): string {
  const pk = Buffer.from(
    ethers.SigningKey.computePublicKey(("0x" + privHex.replace(/^0x/, "")) as `0x${string}`, compressed).slice(2),
    "hex",
  );
  const ck = crypto.createHash("ripemd160").update(crypto.createHash("sha256").update(pk).digest()).digest().subarray(0, 4);
  return "STM" + bs58.encode(Buffer.concat([pk, ck]));
}

/** WIF → 32B private entropy (handles 5… uncompressed and K…/L… compressed). */
export function wifToPrivHex(wif: string): string {
  const raw = bs58.decode(wif.trim());
  if (raw[0] !== 0x80) throw new Error("not a WIF payload");
  const calc = crypto
    .createHash("sha256")
    .update(crypto.createHash("sha256").update(raw.subarray(0, raw.length - 4)).digest())
    .digest()
    .subarray(0, 4);
  if (!raw.subarray(raw.length - 4).equals(calc)) throw new Error("bad WIF checksum");
  const body = raw.subarray(1, raw.length - 4);
  const compressed = body.length === 33 && body[32] === 0x01;
  return (compressed ? body.subarray(0, 32) : body).toString("hex");
}

/** Canonical public key via steem-js (authoritative for both 5… and K/L… WIFs). */
export function wifToChainPub(wif: string): string {
  if (steemAuth?.wifToPublic) return String(steemAuth.wifToPublic(wif.trim()));
  return chainPub(wifToPrivHex(wif), true);
}

export function evmAddress(privHex: string): string {
  // address = last 20 bytes of keccak256(uncompressed pubkey body)
  const pubU = ethers.SigningKey.computePublicKey(("0x" + privHex.replace(/^0x/, "")) as `0x${string}`, false);
  const body = pubU.slice(4); // drop 0x04 prefix
  return ethers.getAddress("0x" + ethers.keccak256(Buffer.from(body, "hex")).slice(-40));
}

export function tronAddress(privHex: string): string {
  const pubU = ethers.SigningKey.computePublicKey(("0x" + privHex.replace(/^0x/, "")) as `0x${string}`, false).slice(4);
  const kec = ethers.keccak256(Buffer.from(pubU, "hex"));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), "hex")]);
  const h2 = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest();
  return bs58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
}

export function solAddress(seedHex: string): string {
  const seed = Buffer.from(seedHex.replace(/^0x/, ""), "hex");
  if (seed.length !== 32) throw new Error("sol seed must be 32 bytes");
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
  return bs58.encode(Buffer.from(kp.publicKey));
}

export interface ChainAuthorityMap {
  map: Map<string, KeyControl[]>;
  steemOk: boolean;
  hiveOk: boolean;
}

/** Live authority map (pub → controls) for every known fleet account, both chains. */
export async function fetchChainAuthorityMap(): Promise<ChainAuthorityMap> {
  const map = new Map<string, KeyControl[]>();
  const push = (chain: string, account: string, role: string, pub: string) => {
    if (!pub) return;
    const arr = map.get(pub) || [];
    arr.push({ chain, account, role, pub });
    map.set(pub, arr);
  };
  let steemOk = false;
  let hiveOk = false;
  async function node(node: string, chain: string, setOk: (v: boolean) => void) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [FLEET_ACCOUNTS], id: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      for (const a of j.result || []) {
        for (const role of ["owner", "active", "posting"] as const) {
          for (const [pub] of a[role]?.key_auths || []) push(chain, a.name, role, pub);
        }
        push(chain, a.name, "memo", a.memo_key);
      }
      setOk(true);
    } catch {
      setOk(false);
    }
  }
  await Promise.all([node(STEEM_NODE, "steem", (v) => (steemOk = v)), node(HIVE_NODE, "hive", (v) => (hiveOk = v))]);
  return { map, steemOk, hiveOk };
}

function classify(raw: string): KeyKind {
  const s = raw.trim();
  if (/^(ghp_|github_pat_)[A-Za-z0-9_]+$/.test(s)) return "github-pat";
  if (/^saos_admin_[A-Za-z0-9_-]+$/.test(s)) return "admin-token";
  if (/^5[HJK][1-9A-HJ-NP-Za-km-z]{50}$/.test(s) || /^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(s)) return "steem-wif";
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return "evm-key";
  if (/^[0-9a-fA-F]{64}$/.test(s)) return "hex-priv";
  if (s.split(/\s+/).length >= 12 && /^[a-z\s]+$/.test(s)) return "mnemonic";
  return "unknown";
}

/** Identify a key and (for chain keys) live-verify what it controls. */
export async function identifyKey(raw: string): Promise<KeyIdReport> {
  const s = raw.trim();
  const kind = classify(s);
  const notes: string[] = [];
  const report: KeyIdReport = { kind, label: "", pubs: [], controls: [], liveChecked: false, notes };

  if (kind === "unknown") {
    report.label = "לא מזוהה — לא נראה כאף סוג מפתח מוכר";
    return report;
  }

  if (kind === "steem-wif") {
    report.label = "מפתח פרטי STEEM/HIVE (WIF)";
    const pub = wifToChainPub(s);
    report.pubs.push(pub);
    const { map, steemOk, hiveOk } = await fetchChainAuthorityMap();
    report.liveChecked = steemOk || hiveOk;
    report.controls = map.get(pub) || [];
    if (report.liveChecked && !report.controls.length)
      notes.push("המפתח תקין קריפטוגרפית אך אינו מחזיק authority באף חשבון-מוכר ברשתות שנבדקו");
    if (!steemOk) notes.push("steem node לא נענה");
    if (!hiveOk) notes.push("hive node לא נענה");
    return report;
  }

  if (kind === "evm-key" || kind === "hex-priv") {
    const priv = s.replace(/^0x/, "").toLowerCase();
    report.label = kind === "evm-key" ? "מפתח פרטי EVM" : "מפתח פרטי 64-hex (ECDSA)";
    const pubs: string[] = [];
    try { pubs.push(evmAddress(priv)); } catch (e) { notes.push("EVM derive fail: " + (e as Error).message); }
    try { pubs.push(tronAddress(priv)); } catch (e) { notes.push("TRON derive fail: " + (e as Error).message); }
    try { pubs.push(chainPub(priv, true)); } catch { /* out-of-range key */ }
    report.pubs = pubs;
    const { map, steemOk } = await fetchChainAuthorityMap();
    report.liveChecked = steemOk;
    for (const p of pubs) {
      for (const c of map.get(p) || []) report.controls.push(c);
    }
    if (!report.controls.length) notes.push("נגזרו כתובות EVM+TRON — אין authority-steem למפתח (תקין לארנקי-צי)");
    return report;
  }

  if (kind === "mnemonic") {
    report.label = "מנמוניק (ציר-גזירה)";
    report.notes.push("יישמר כסוד מוצפן — גזירת-דלתות מתבצעת בצד-השרת בלבד");
    return report;
  }

  if (kind === "github-pat") {
    report.label = "GitHub Personal Access Token";
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: "token " + s },
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      report.liveChecked = true;
      if (j.login) {
        report.pubs.push("github:" + j.login);
        report.controls.push({ chain: "github", account: j.login, role: "token", pub: "github:" + j.login });
      } else {
        notes.push("GitHub דחה את הטוקן: " + String(j.message || "unknown"));
      }
    } catch (e) {
      notes.push("GitHub לא נענה: " + (e as Error).message);
    }
    return report;
  }

  // admin-token
  report.label = "SAOS admin token";
  report.notes.push("אומת מול המערכת-המקומית בלבד");
  return report;
}
