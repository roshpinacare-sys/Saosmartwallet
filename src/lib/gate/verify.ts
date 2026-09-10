/**
 * SOVEREIGN GATE — live verification of the whole vault ("מחובר להכל").
 * Every claim of connectivity is produced by a fresh chain/API call here.
 *
 * r10 — the multi-rail truth: a Graphene WIF is NOT a "steem key" — the same
 * 33 key bytes may hold authority on steem, hive AND blurt simultaneously.
 * The old verifier asked steem+hive with string-level pub matching and stored
 * ONE boolean, so keys that actually control accounts on 2–3 rails were
 * branded "unverified" and the vault claimed only headcorner@steem was real.
 * Now: raw-33-byte matching across steem+hive+blurt, `chains` lists every
 * rail where the key holds authority, and EVM/TRON/SOL entries get REAL
 * network probes (balance/nonce/getAccountInfo) instead of derivation-only.
 */
import { db } from "@/lib/db";
import { openSecret } from "./crypto";
import { chainPub, evmAddress, tronAddress, solAddress, fetchChainAuthorityMap, FLEET_ACCOUNTS } from "./key-id";
import bs58 from "bs58";
import { createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";

// ── r11: bech32 (BIP-173) P2WPKH v0 encoding for bitcoin fleet addresses ──
const B32CHARS = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
/** BIP-173 hrp-expand: HIGH for every char, then 0, then LOW for every char. */
function bech32HrpExpand(hrp: string): number[] {
  const r: number[] = [];
  for (const c of hrp) r.push(c.charCodeAt(0) >> 5);
  r.push(0);
  for (const c of hrp) r.push(c.charCodeAt(0) & 31);
  return r;
}
function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0, bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || (v >> from) !== 0) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}
export function btcP2wpkhAddress(privHex: string): string {
  const priv = Buffer.from(privHex.replace(/^0x/, ""), "hex");
  const pubC = Buffer.from(secp256k1.getPublicKey(new Uint8Array(priv), true)); // 33B compressed
  const h160 = createHash("ripemd160").update(createHash("sha256").update(pubC).digest()).digest();
  const prog = convertBits(Array.from(h160), 8, 5, true)!;
  const hrp = "bc";
  const data = bech32HrpExpand(hrp).concat([0]).concat(prog);
  const mod = bech32Polymod(data.concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const chk: number[] = [];
  for (let i = 0; i < 6; i++) chk.push((mod >> (5 * (5 - i))) & 31);
  return hrp + "1" + [0].concat(prog, chk).map((d) => B32CHARS[d]).join("");
}

// ── r11: live BTC probe — mempool.space primary, blockstream fallback ──
async function liveBtc(address: string): Promise<{ ok: boolean; detail: string }> {
  const nodes = ["https://mempool.space/api/address/", "https://blockstream.info/api/address/"];
  let lastErr = "לא נענה";
  for (const node of nodes) {
    try {
      const r = await fetch(node + address, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status === 403) {
        lastErr = `HTTP ${r.status}`;
        continue;
      }
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        continue;
      }
      const j = (await r.json()) as { chain_stats?: { funded_txo_sum?: number; tx_count?: number }; mempool_stats?: { funded_txo_sum?: number; tx_count?: number } };
      const cs = j.chain_stats, ms = j.mempool_stats;
      const funded = ((cs?.funded_txo_sum ?? 0) + (ms?.funded_txo_sum ?? 0)) / 1e8;
      const txs = (cs?.tx_count ?? 0) + (ms?.tx_count ?? 0);
      return {
        ok: true,
        detail: `אומת live מול Bitcoin mainnet · txs=${txs}${funded > 0 ? ` · מומן ${funded} BTC` : " · כתובת עוד לא מומנה"}`,
      };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { ok: false, detail: `Bitcoin mainnet לא נענה: ${lastErr}` };
}

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
  chains: string[]; // r10: every live rail where this key holds authority / the chain answered
  detail: string;
}

/** Raw 33-byte hex of a graphene wire pub (STM/HIVE/BLT/TST). */
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

// ---------------------------------------------------------------------------
// r10 — live network probes for single-key chains (no more derivation-only)
// ---------------------------------------------------------------------------

async function liveEvm(address: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch("https://ethereum-rpc.publicnode.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
      signal: AbortSignal.timeout(15000),
    });
    const j = (await r.json()) as { result?: string; error?: { message?: string } };
    if (j.error || typeof j.result !== "string") return { ok: false, detail: `שרשרת-ETH ענתה בשגיאה: ${j.error?.message ?? "תשובה לא תקינה"}` };
    const wei = BigInt(j.result);
    const eth = Number(wei / 10n ** 12n) / 1e6;
    return { ok: true, detail: `אומת live מול ETH mainnet · יתרה ${eth} ETH` };
  } catch (e) {
    return { ok: false, detail: `ETH mainnet לא נענה: ${(e as Error).message}` };
  }
}

async function liveTron(address: string): Promise<{ ok: boolean; detail: string }> {
  // Primary: trongrid v1 accounts. Fallback: the full-node /wallet/getaccount —
  // r10 live-learned: parallel probes trip trongrid's 429 and the sweep
  // branded healthy keys "unverified" (alarm-noise, the exact disease r8 killed).
  // Both endpoints share the domain's rate limit → backoff once before retrying.
  const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const r = await fetch(`https://api.trongrid.io/v1/accounts/${address}`, { signal: AbortSignal.timeout(15000) });
    const j = (await r.json()) as { success?: boolean; data?: Array<{ balance?: number }> };
    if (j.success) {
      const bal = j.data?.[0]?.balance ?? 0;
      return { ok: true, detail: `אומת live מול TRON mainnet · יתרה ${bal / 1e6} TRX` };
    }
  } catch { /* fall through to the full-node probe */ }
  try {
    let r2 = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, visible: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (r2.status === 429) {
      await backoff(1500); // shared-domain limit — one polite retry
      r2 = await fetch("https://api.trongrid.io/wallet/getaccount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, visible: true }),
        signal: AbortSignal.timeout(15000),
      });
    }
    const j2 = (await r2.json()) as { address?: string; balance?: number } | null;
    // the full-node answers 200 even for an unfunded address (empty object) —
    // a 200 IS the live proof the chain answered; balance is extra honesty
    if (r2.ok && j2 && typeof j2 === "object") {
      return { ok: true, detail: `אומת live מול TRON mainnet (full-node) · יתרה ${(j2.balance ?? 0) / 1e6} TRX${!j2.address && j2.balance === undefined ? " · כתובת לא-ממומנת (השרשרת ענתה)" : ""}` };
    }
    return { ok: false, detail: `שרשרת-TRON ענתה בשגיאה (${r2.status})` };
  } catch (e) {
    return { ok: false, detail: `TRON mainnet לא נענה: ${(e as Error).message}` };
  }
}

async function liveSol(address: string): Promise<{ ok: boolean; detail: string }> {
  // Primary: mainnet-beta (rate-limits aggressively); fallback: publicnode.
  const nodes = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
  let lastErr = "לא נענה";
  for (const node of nodes) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
        signal: AbortSignal.timeout(15000),
      });
      const j = (await r.json()) as { result?: { value?: number }; error?: { message?: string } };
      if (j.error || !j.result) {
        lastErr = j.error?.message ?? `HTTP ${r.status}`;
        continue;
      }
      return { ok: true, detail: `אומת live מול SOL mainnet · יתרה ${(j.result.value ?? 0) / 1e9} SOL` };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { ok: false, detail: `SOL mainnet לא נענה: ${lastErr}` };
}

/** Verify one vault entry against live sources (never mutates priv material). */
async function verifyEntry(e: {
  id: string; kind: string; chain: string | null; account: string | null; role: string | null;
  pub: string | null; encPriv: string; privIv: string; privTag: string; status: string; verifyNote: string | null;
}, authority: Map<string, { chain: string; account: string; role: string; pub: string }[]>, alive: { steem: boolean; hive: boolean; blurt: boolean }): Promise<EntryVerify> {
  const base: EntryVerify = {
    id: e.id, kind: e.kind, chain: e.chain, account: e.account, role: e.role, pub: e.pub,
    status: e.status, verifyNote: e.verifyNote, liveOk: null, chains: [], detail: "",
  };
  // ── authority plane first (r10): a steem-key's authority is proven from its
  // PUBLIC key alone — metadata, plaintext, no master needed. The sweep now
  // proves the whole graphene plane even while the vault is LOCKED; sealed
  // material is opened only for kinds that must derive an address.
  if (e.status === "operator-custody") {
    // r11: an honest-null placeholder (e.g. @ynet) — no key material is held,
    // so "failed" would be a lie: nobody controls it from here by design.
    base.liveOk = null;
    base.detail = "מפתח-חי אצל המפעיל (רוטציה חוץ-מערכתית) — הכספת מחזיקה רישום-מצב בלבד, ללא חומר-מפתח";
    return base;
  }
  if (e.kind === "steem-key") {
    const raw = e.pub ? pub33Hex(e.pub) : null;
    const controls = raw ? authority.get(raw) || [] : [];
    const chains = [...new Set(controls.map((c) => c.chain))];
    const scoped = e.chain && e.account && e.role
      ? controls.some((c) => c.chain === e.chain && c.account === e.account && c.role === e.role)
      : chains.length > 0;
    base.chains = chains;
    base.liveOk = scoped || chains.length > 0 ? true : false;
    if (base.liveOk) {
      base.detail = controls.length
        ? `אומת live: authority ב-${chains.join("+")} · ${controls.map((c) => `${c.account}@${c.role}`).slice(0, 4).join(", ")}${controls.length > 4 ? "…" : ""}`
        : "אומת live";
    } else {
      // false only when the WHOLE plane was asked (all three rails answered)
      // and found nothing; a partial sweep must never convict (r10 live-learned:
      // a hive/blurt hiccup mass-demoted 40 provable keys — manufactured alarm)
      const allAlive = alive.steem && alive.hive && alive.blurt;
      const anyAlive = alive.steem || alive.hive || alive.blurt;
      base.liveOk = allAlive ? false : null;
      base.detail = allAlive
        ? "החשבון חי אך המפתח אינו נמצא ב-authorities החיים שלו על אף רשת (steem+hive+blurt — מפתח-ישן/מוחלף)"
        : anyAlive
          ? "חלק מהצמתים לא נענו בסריקה הזו — איננו חותך בלי המישור המלא"
          : "צמתי-הרשת לא נענו — אימות חי בלתי-אפשרי כרגע";
    }
    return base;
  }
  try {
    const priv = openSecret(e);
    if (e.kind === "evm-key") {
      const derived = evmAddress(priv.replace(/^0x/, "").toLowerCase());
      const match = e.pub ? derived.toLowerCase() === e.pub.toLowerCase() : true;
      if (!match) {
        base.liveOk = false;
        base.detail = `אי-התאמה: נגזר ${derived} אך הרישום ${e.pub}`;
        return base;
      }
      const live = await liveEvm(derived);
      base.liveOk = live.ok ? true : null; // derivation proved the binding; a silent network is null, never false
      base.chains = live.ok ? ["ethereum"] : [];
      base.detail = live.ok ? `${live.detail} · כתובת נגזרה תואמת: ${derived}` : `הגזירה תואמת (${derived}) אך ${live.detail}`;
      return base;
    }
    if (e.kind === "tron-key") {
      const derived = tronAddress(priv);
      const match = e.pub ? derived === e.pub : true;
      if (!match) {
        base.liveOk = false;
        base.detail = `אי-התאמה: נגזר ${derived} אך הרישום ${e.pub}`;
        return base;
      }
      const live = await liveTron(derived);
      base.liveOk = live.ok ? true : null;
      base.chains = live.ok ? ["tron"] : [];
      base.detail = live.ok ? `${live.detail} · כתובת נגזרה תואמת: ${derived}` : `הגזירה תואמת (${derived}) אך ${live.detail}`;
      return base;
    }
    if (e.kind === "sol-key") {
      const derived = solAddress(priv.replace(/^0x/, ""));
      const match = e.pub ? derived === e.pub : true;
      if (!match) {
        base.liveOk = false;
        base.detail = `אי-התאמה: נגזר ${derived} אך הרישום ${e.pub}`;
        return base;
      }
      const live = await liveSol(derived);
      base.liveOk = live.ok ? true : null;
      base.chains = live.ok ? ["solana"] : [];
      base.detail = live.ok ? `${live.detail} · כתובת SOL נגזרה תואמת` : `הגזירה תואמת אך ${live.detail}`;
      return base;
    }
    if (e.kind === "btc-key") {
      // r11: the 32-byte priv IS the BIP-32 leaf key — address = P2WPKH(hash160(compressed-pub))
      const derived = btcP2wpkhAddress(priv);
      const match = e.pub ? derived === e.pub : true;
      if (!match) {
        base.liveOk = false;
        base.detail = `אי-התאמה: נגזר ${derived} אך הרישום ${e.pub}`;
        return base;
      }
      const live = await liveBtc(derived);
      base.liveOk = live.ok ? true : null; // derivation proved the binding; a silent network is null, never false
      base.chains = live.ok ? ["bitcoin"] : [];
      base.detail = live.ok ? `${live.detail} · כתובת נגזרה תואמת: ${derived}` : `הגזירה תואמת (${derived}) אך ${live.detail}`;
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
        base.chains = r.ok ? ["github"] : [];
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

/** Verify everything, batched: one call per graphene rail for all accounts. */
export async function verifyAll(): Promise<{ entries: EntryVerify[]; steemOk: boolean; hiveOk: boolean; blurtOk: boolean; githubOk: boolean | null }> {
  const rows = await db.vaultEntry.findMany({ orderBy: [{ chain: "asc" }, { account: "asc" }, { role: "asc" }] });
  const { map, steemOk, hiveOk, blurtOk } = await fetchChainAuthorityMap();
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
  const alive = { steem: steemOk, hive: hiveOk, blurt: blurtOk };
  // bounded concurrency — 14 parallel probes tripped trongrid's 429 and
  // mainnet-beta's limiter; the sweep must not manufacture its own failures
  const CONCURRENCY = 4;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (cursor < rows.length) {
        const e = rows[cursor++];
        const v = await verifyEntry(e, map, alive);
        // persist verification result (never downgrade a known rotated-out key)
        const newStatus = v.liveOk === true ? "verified" : v.liveOk === false ? (e.status === "rotated-out" ? "rotated-out" : "unverified") : e.status;
        await db.vaultEntry.update({
          where: { id: e.id },
          data: { status: newStatus, verifiedAt: new Date() },
        });
        entries.push(v);
      }
    }),
  );
  return { entries, steemOk, hiveOk, blurtOk, githubOk };
}

/**
 * r15 — targeted re-scan: verify ONLY entries still marked "imported"
 * (material the vault inherited but never proved live). verifyAll proves
 * everything but is a full sweep; this closes the honest "imported" backlog
 * with a bounded, cheap pass the fleet can run as a DAILY MISSION (the
 * vault-rescan patrol). Same probe machinery, same persistence rules, same
 * bounded concurrency — never downgrades a rotated-out key, never fakes a
 * live: network-silent probes keep the entry imported (honest-null).
 */
export async function verifyImported(): Promise<{
  scanned: number;
  verified: number;
  failed: number;
  stillImported: number;
  entries: EntryVerify[];
}> {
  const rows = await db.vaultEntry.findMany({
    where: { status: "imported" },
    orderBy: [{ chain: "asc" }, { account: "asc" }, { role: "asc" }],
    take: 30,
  });
  const fetched = rows.length ? await fetchChainAuthorityMap() : null;
  const entries: EntryVerify[] = [];
  if (rows.length && fetched) {
    const alive = { steem: fetched.steemOk, hive: fetched.hiveOk, blurt: fetched.blurtOk };
    const CONCURRENCY = 4;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
        while (cursor < rows.length) {
          const e = rows[cursor++];
          const v = await verifyEntry(e, fetched.map, alive);
          // same persistence contract as verifyAll: live=true → verified,
          // live=false → unverified (rotated-out stays), live=null → untouched
          const newStatus = v.liveOk === true ? "verified" : v.liveOk === false ? (e.status === "rotated-out" ? "rotated-out" : "unverified") : e.status;
          await db.vaultEntry.update({
            where: { id: e.id },
            data: { status: newStatus, verifiedAt: new Date() },
          });
          entries.push(v);
        }
      }),
    );
  }
  const verified = entries.filter((v) => v.liveOk === true).length;
  const failed = entries.filter((v) => v.liveOk === false).length;
  const stillImported = await db.vaultEntry.count({ where: { status: "imported" } });
  return { scanned: entries.length, verified, failed, stillImported, entries };
}

export { FLEET_ACCOUNTS };
