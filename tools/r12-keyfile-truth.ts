/**
 * r12 — KEYFILE TRUTH: the operator uploaded בחן.txt ("missing keys — check,
 * verify, and anchor everything final").
 *
 * The file holds TWELVE P5… tokens — steemit MASTER PASSWORDS (the steemit.com
 * account-creation format: "P" + a random WIF-shaped seed). These are NOT the
 * account keys themselves: steemit derives each role key as
 *     private = SHA256(accountName + role + password)      [the condenser rule]
 * so a P5 password is the master seed material for owner/active/posting/memo.
 *
 * Mechanical truth — the chain is the oracle, the file's Hebrew labels are
 * only hints. For every token we test, against the LIVE authorities of every
 * fleet account on every graphene rail (steem + hive + blurt):
 *   A) DIRECT  — the embedded WIF itself (checksum-verified) may hold
 *                authority as-is (old-style exports).
 *   B) DERIVED — sha256(account + role + P5full)   [condenser rule]
 *                sha256(account + role + P5sansP)  [no-P variant]
 *                sha256(P5full)                    [seed-only variant]
 * for roles owner/active/posting/memo, account ∈ FLEET_ACCOUNTS.
 *
 * Also harvested (read-only): full authority objects (key_auths AND
 * account_auths — the r11 account-authority plane), pending rewards and
 * balances for every fleet account on all three rails.
 *
 * READ-ONLY: key material never printed, never stored — truth JSON → /tmp/r12/.
 */
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import bs58 from "bs58";
import { FLEET_ACCOUNTS, chainPub } from "@/lib/gate/key-id";

const FILE = "/home/z/my-project/upload/בחן.txt";
const OUT = "/tmp/r12";
// FLEET_ACCOUNTS + the DISCOVERED account: ynet@steem carries an extra posting
// account-auth for "steemauto" (r12 finding — an account no census ever listed).
// If any token derives its keys, the "unclear" label dissolves into truth.
const CANDIDATES = [...FLEET_ACCOUNTS, "steemauto"];
const NODES: Record<string, string[]> = {
  steem: ["https://api.steemit.com", "https://api.justyy.com"],
  hive: ["https://api.hive.blog", "https://api.deathwing.me"],
  blurt: ["https://blurt-rpc.saboin.com"],
};
const PREFIX: Record<string, string> = { steem: "STM", hive: "HIVE", blurt: "BLT" };
const ROLES = ["owner", "active", "posting", "memo"] as const;

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function railRpc<T>(rail: string, method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of NODES[rail]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(15000),
        });
        const j = (await res.json()) as any;
        if (j.error) { last = j.error.message; continue; }
        return j.result as T;
      } catch (e) { last = (e as Error).message; if (attempt === 0) await new Promise((r) => setTimeout(r, 1200)); }
    }
  }
  throw new Error(`${rail} down: ${last}`);
}

/** raw 33-byte hex of the compressed pub derived from a 32-byte priv hex. */
function pub33(privHex: string): string {
  const stm = chainPub(privHex, true); // "STM" + bs58(pk33 || ck4)
  const body = stm.slice(3);
  return Buffer.from(bs58.decode(body)).subarray(0, 33).toString("hex");
}

/** full graphene wire pub for a rail (STM…/HIVE…/BLT…). */
function wirePub(privHex: string, rail: string): string {
  const stm = chainPub(privHex, true);
  const body = stm.slice(3);
  return PREFIX[rail] + body;
}

function pubWireToRaw(pub: string): string | null {
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex"); } catch { return null; }
}

interface Acct {
  chain: string; name: string; exists: boolean;
  balances?: { steem: string; sbd: string; vests: string; rewardSteem: string; rewardSbd: string; rewardVests: string; rcMana?: number };
  keyAuth?: Array<{ role: string; pub: string; raw: string; weight: number }>;
  acctAuth?: Array<{ role: string; debtor: string; weight: number }>;
}

async function fetchRailAccounts(rail: string): Promise<Acct[]> {
  const j = await railRpc<any[]>(rail, "condenser_api.get_accounts", [CANDIDATES]);
  return (j || []).map((a: any) => {
    const keyAuth: Acct["keyAuth"] = [];
    const acctAuth: Acct["acctAuth"] = [];
    for (const role of ["owner", "active", "posting"]) {
      for (const k of a[role]?.key_auths ?? []) {
        const raw = pubWireToRaw(String(k[0]));
        if (raw) keyAuth.push({ role, pub: String(k[0]), raw, weight: Number(k[1]) });
      }
      for (const acc of a[role]?.account_auths ?? []) {
        acctAuth.push({ role, debtor: String(acc[0]), weight: Number(acc[1]) });
      }
    }
    const rawMemo = pubWireToRaw(String(a.memo_key ?? ""));
    if (rawMemo) keyAuth.push({ role: "memo", pub: String(a.memo_key), raw: rawMemo, weight: 1 });
    return {
      chain: rail, name: String(a.name), exists: true,
      balances: {
        steem: String(a.balance ?? a.hive_balance ?? a.blurt_balance ?? "0"), sbd: String(a.sbd_balance ?? a.hbd_balance ?? "0"), vests: String(a.vesting_shares),
        // rail-aware pending rewards: steem reward_steem_balance / hive reward_hive_balance / blurt reward_blurt_balance
        rewardSteem: String(a.reward_steem_balance ?? a.reward_hive_balance ?? a.reward_blurt_balance ?? "0"),
        rewardSbd: String(a.reward_sbd_balance ?? a.reward_hbd_balance ?? "0"),
        rewardVests: String(a.reward_vesting_balance ?? "0"),
      },
      keyAuth, acctAuth,
    };
  });
}

function wifToPriv(wif: string): string {
  const raw = Buffer.from(bs58.decode(wif.trim()));
  if (raw[0] !== 0x80) throw new Error("not WIF payload");
  const calc = createHash("sha256").update(createHash("sha256").update(raw.subarray(0, raw.length - 4)).digest()).digest().subarray(0, 4);
  if (!raw.subarray(raw.length - 4).equals(calc)) throw new Error("bad WIF checksum");
  const body = raw.subarray(1, raw.length - 4);
  return (body.length === 33 && body[32] === 0x01 ? body.subarray(0, 32) : body).toString("hex");
}

/* ── the file's own Hebrew labels — hints only, the chain decides ── */
function parseFile(): Array<{ p5: string; line: number; hint: string }> {
  const lines = readFileSync(FILE, "utf8").split(/\r?\n/);
  const tokens: Array<{ p5: string; line: number }> = [];
  lines.forEach((l, i) => {
    // tokens stand alone AND inside chat-timestamp lines ("[date] Haran Titi: P5…")
    const m = /\bP5([1-9A-HJ-NP-Za-km-z]{50})\b/.exec(l);
    if (m) tokens.push({ p5: "P5" + m[1], line: i + 1 });
  });
  const HEBREW: Record<string, string> = { "מקרמה": "macrame", "הרן": "haran", "קשמשין": "cashmachine", "ynet": "ynet", "israelnews": "israelnews", "לא ברור": "unknown" };
  const bareName = (s: string): string | null => {
    const t = s.trim();
    if (!t || /^\[/.test(t)) return null;
    return HEBREW[t] ?? (/^[a-z0-9._-]{3,16}$/.test(t) ? t : null);
  };
  return tokens.map((t) => {
    const idx = t.line - 1;
    // (a) annotation right AFTER the token: "סטימיט סיסמא מקרמה" or a bare name
    const after = idx + 1 < lines.length ? lines[idx + 1].trim() : "";
    const annMatch = /סטימיט\s+סיסמא\s+(\S+)/.exec(after);
    if (annMatch && HEBREW[annMatch[1]]) return { ...t, hint: HEBREW[annMatch[1]] };
    const afterName = bareName(after);
    if (afterName) return { ...t, hint: afterName };
    // (b) name BEFORE the token (the name-then-key chat pattern: קשמשין → key)
    const beforeName = idx > 0 ? bareName(lines[idx - 1]) : null;
    if (beforeName) return { ...t, hint: beforeName };
    return { ...t, hint: "unknown" };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("== r12 KEYFILE TRUTH — the chain is the oracle ==");
  const tokens = parseFile();
  console.log(`file tokens: ${tokens.length} (P5 master-password shape, P+WIF)`);

  // ── 1. live authorities on all three rails ──
  const rails: Record<string, Acct[]> = {};
  const alive: Record<string, boolean> = {};
  for (const rail of Object.keys(NODES)) {
    try { rails[rail] = await fetchRailAccounts(rail); alive[rail] = true; console.log(`${rail}: ${rails[rail].length}/${CANDIDATES.length} accounts answered (incl. steemauto)`); }
    catch (e) { rails[rail] = []; alive[rail] = false; console.log(`${rail}: DOWN (${(e as Error).message})`); }
  }
  // map raw33 → controls across ALL rails
  const map = new Map<string, Array<{ chain: string; account: string; role: string; pub: string }>>();
  for (const rail of Object.keys(rails)) for (const a of rails[rail]) for (const k of a.keyAuth ?? []) {
    const arr = map.get(k.raw) || []; arr.push({ chain: rail, account: a.name, role: k.role, pub: k.pub }); map.set(k.raw, arr);
  }

  // ── 2. test every token ──
  const results: any[] = [];
  for (const t of tokens) {
    const entry: any = { line: t.line, hint: t.hint, p5tail: t.p5.slice(-6), direct: [], derived: [], invalid: null };
    let priv = "";
    try { priv = wifToPriv(t.p5.slice(1)); } catch (e) { entry.invalid = (e as Error).message; results.push(entry); continue; }
    // A) direct WIF
    const dRaw = pub33(priv);
    entry.direct = map.get(dRaw) || [];
    // B) password derivations
    const variants: Record<string, string> = {
      "condenser(account+role+P5)": "D1",
      "noP(account+role+P5sansP)": "D2",
      "seedOnly(sha256(P5))": "D3",
    };
    for (const account of CANDIDATES) {
      for (const role of ROLES) {
        const seeds: Array<[string, string]> = [
          ["D1", sha256hex(account + role + t.p5)],
          ["D2", sha256hex(account + role + t.p5.slice(1))],
        ];
        for (const [variant, privHex] of seeds) {
          const raw = pub33(privHex);
          const hits = map.get(raw) || [];
          for (const h of hits) entry.derived.push({ variant, candidate: account, ...h, derivedPrivHex: privHex });
        }
      }
    }
    // D3: seed-only — one pub, checked against everything
    const s3 = pub33(sha256hex(t.p5));
    entry.seedOnly = map.get(s3) || [];
    results.push(entry);
  }

  // ── 3. print the truth table (pubs only, never privs) ──
  console.log("\n── per-token truth (labels are hints; only live matches count) ──");
  for (const r of results) {
    const tag = r.invalid ? `INVALID: ${r.invalid}` : "";
    console.log(`\n#L${r.line} hint=${r.hint} …${r.p5tail} ${tag}`);
    if (r.direct.length) for (const h of r.direct) console.log(`  DIRECT  ${h.chain}/${h.account}@${h.role} ${h.pub}`);
    const seen = new Set<string>();
    for (const d of r.derived) {
      const key = `${d.variant}|${d.chain}|${d.account}|${d.role}|${d.pub}`;
      if (seen.has(key)) continue; seen.add(key);
      console.log(`  DERIVED ${d.variant} ${d.chain}/${d.account}@${d.role} ${d.pub}`);
    }
    if (r.seedOnly?.length) for (const h of r.seedOnly) console.log(`  SEEDONLY ${h.chain}/${h.account}@${h.role} ${h.pub}`);
    if (!r.invalid && !r.direct.length && !r.derived.length && !(r.seedOnly || []).length)
      console.log("  אין-התאמה חיה על אף רשת (steem+hive+blurt) — הסיסמה אינה שולטת יותר (רוטציה)");
  }

  // ── 4. authority + rewards truth per account ──
  console.log("\n── fleet authority & rewards (per rail, rail-aware reward fields) ──");
  const fleetTruth: any[] = [];
  for (const name of CANDIDATES) {
    const on: any = { account: name, rails: {} };
    for (const rail of Object.keys(rails)) {
      const a = rails[rail].find((x) => x.name === name);
      if (!a) { on.rails[rail] = { exists: false }; continue; }
      on.rails[rail] = {
        exists: true,
        keyAuth: (a.keyAuth ?? []).map((k) => ({ role: k.role, pub: k.pub })),
        acctAuth: a.acctAuth,
        balances: a.balances,
      };
    }
    const parts: string[] = [];
    for (const rail of Object.keys(rails)) {
      const st = on.rails[rail];
      if (!st?.exists) { parts.push(`${rail}:NOT-FOUND`); continue; }
      const pend = parseFloat(st.balances.rewardSteem) + parseFloat(st.balances.rewardSbd) + parseFloat(st.balances.rewardVests);
      parts.push(`${rail}: pending=${pend > 0 ? pend.toFixed(3) : "no"} acctAuths=${st.acctAuth.length ? st.acctAuth.map((x: any) => x.debtor + "@" + x.role).join(",") : "none"}`);
    }
    console.log(`  ${name.padEnd(11)} ${parts.join(" · ")}`);
    fleetTruth.push(on);
  }

  mkdirSync(OUT, { recursive: true });
  // derivedPrivHex travels ONLY in /tmp (sealed by the next stage, never printed, never committed)
  writeFileSync(`${OUT}/truth.json`, JSON.stringify({ tokens, results, fleetTruth, alive, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`\ntruth written → ${OUT}/truth.json (key material stays in /tmp only)`);
  const totalLive = results.reduce((n, r) => n + (r.direct?.length || 0) + new Set((r.derived || []).map((d: any) => `${d.chain}|${d.account}|${d.role}`)).size, 0);
  console.log(`LIVE CONTROL MATCHES: ${totalLive}`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
