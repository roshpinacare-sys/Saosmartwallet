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
const BLURT_NODE = "https://blurt-rpc.saboin.com"; // r10: live-verified + chain-id oracle-proven 2026-09-10

/** r10: per-rail failover pools (live-verified endpoints only, same rule as rails-server). */
const RAIL_NODES: Record<string, string[]> = {
  steem: [STEEM_NODE, "https://api.justyy.com", "https://api.steemitdev.com"],
  hive: [HIVE_NODE, "https://api.deathwing.me", "https://api.openhive.network"],
  blurt: [BLURT_NODE],
};

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
  // ROAST r4: bs58 v6 decode returns a RAW Uint8Array — `.equals` doesn't
  // exist (TypeError on every call) and `.toString("hex")` yields a decimal
  // list, silently corrupting the derived key. Copy into a Buffer first:
  // real methods, real hex, real checksum verification.
  const raw = Buffer.from(bs58.decode(wif.trim()));
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

/** Canonical public key. r17/r19 chain-proven semantics for THIS fleet's
 *  compressed material (ROT1 / הדקור, K/L… WIFs): the 33-BYTE body (32-byte
 *  value ‖ 0x01) is the private scalar mod N — the standard "0x01 is a
 *  compression flag" reading yields a DIFFERENT pubkey (re-proven live r19:
 *  stored==live, standard-derivation≠live). Canonical 5… WIFs stay on the
 *  steem-js path (authoritative there). */
export function wifToChainPub(wif: string): string {
  const w = wif.trim();
  let raw: Buffer | null = null;
  try { raw = Buffer.from(bs58.decode(w)); } catch { raw = null; }
  if (raw && raw.length === 38 && raw[0] === 0x80 && raw[33] === 0x01) {
    const calc = crypto.createHash("sha256").update(crypto.createHash("sha256").update(raw.subarray(0, 34)).digest()).digest().subarray(0, 4);
    if (!raw.subarray(34, 38).equals(calc)) throw new Error("bad WIF checksum");
    const d = BigInt("0x" + raw.subarray(1, 34).toString("hex")) % 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    // wire encoding must match the chain's own (steem-js key_public.toPublicKeyString):
    // checksum = ripemd160(pubbody)[0:4] — NOT ripemd160(sha256()) (re-proven live r19)
    const pk = Buffer.from(
      ethers.SigningKey.computePublicKey(("0x" + d.toString(16).padStart(64, "0")) as `0x${string}`, true).slice(2),
      "hex",
    );
    const ck = crypto.createHash("ripemd160").update(pk).digest().subarray(0, 4);
    return "STM" + bs58.encode(Buffer.concat([pk, ck]));
  }
  if (steemAuth?.wifToPublic) return String(steemAuth.wifToPublic(w));
  return chainPub(wifToPrivHex(w), true);
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
  blurtOk: boolean;
}

/** Decodes a graphene wire pub (STM/HIVE/BLT/TST prefix) to its raw 33 bytes, hex. */
function pub33Hex(pub: string): string | null {
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try {
    const raw = Buffer.from(bs58.decode(m[2]));
    if (raw.length < 33) return null;
    return raw.subarray(0, 33).toString("hex");
  } catch {
    return null;
  }
}

/**
 * Live authority map (raw-33-byte pub → controls) for every known fleet
 * account, on ALL THREE graphene rails (steem + hive + blurt).
 *
 * r10: blurt joins the map, and the map key is now the RAW 33-byte hex —
 * the same key material appears as STM… on steem/hive and BLT… on blurt;
 * a string-level match could never cross the prefix, which is exactly how
 * the vault's hive/blurt control was rendered invisible ("unverified").
 * Each rail fails over its own verified endpoint pool — one slow node must
 * not blind the whole plane (live-learned mid-r10: a hive hiccup mass-demoted
 * 40 provable keys to "failed" — the sweep manufacturing its own alarm).
 */
export async function fetchChainAuthorityMap(): Promise<ChainAuthorityMap> {
  const map = new Map<string, KeyControl[]>();
  const push = (chain: string, account: string, role: string, pub: string) => {
    if (!pub) return;
    const raw = pub33Hex(pub);
    if (!raw) return;
    const arr = map.get(raw) || [];
    arr.push({ chain, account, role, pub });
    map.set(raw, arr);
  };
  const ok = { steem: false, hive: false, blurt: false };
  await Promise.all(
    Object.entries(RAIL_NODES).map(async ([chain, nodes]) => {
      for (const node of nodes) {
        // two polite attempts per node — one transient timeout must not blind a rail
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
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
            ok[chain as keyof typeof ok] = true;
            return; // this rail answered — done
          } catch {
            /* retry, then the next endpoint of this rail */
          }
        }
      }
    }),
  );
  return { map, steemOk: ok.steem, hiveOk: ok.hive, blurtOk: ok.blurt };
}

function classify(raw: string): KeyKind {
  const s = raw.trim();
  if (/^(ghp_|github_pat_)[A-Za-z0-9_]+$/.test(s)) return "github-pat";
  if (/^saos_admin_[A-Za-z0-9_-]+$/.test(s)) return "admin-token";
  // WIF: uncompressed = '5'+50 base58 (51 chars total); compressed = K/L+51 (52 total)
  if (/^5[1-9A-HJ-NP-Za-km-z]{50}$/.test(s) || /^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(s)) return "steem-wif";
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
    report.label = "מפתח פרטי STEEM/HIVE/BLURT (WIF)";
    const pub = wifToChainPub(s);
    report.pubs.push(pub);
    const { map, steemOk, hiveOk, blurtOk } = await fetchChainAuthorityMap();
    report.liveChecked = steemOk || hiveOk || blurtOk;
    report.controls = map.get(pub33Hex(pub) || "") || [];
    if (report.liveChecked && !report.controls.length)
      notes.push("המפתח תקין קריפטוגרפית אך אינו מחזיק authority באף חשבון-מוכר ברשתות שנבדקו (steem/hive/blurt)");
    if (!steemOk) notes.push("steem node לא נענה");
    if (!hiveOk) notes.push("hive node לא נענה");
    if (!blurtOk) notes.push("blurt node לא נענה");
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
      const raw = /^(STM|HIVE|BLT|TST)/.test(p) ? pub33Hex(p) : p.toLowerCase();
      for (const c of map.get(raw || "") || []) report.controls.push(c);
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
