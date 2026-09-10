/**
 * r16 — STEEM ROTATION TRUTH: the operator asks "why only 4 of my steem
 * keys rotated — connect all of them" (upload/הד.txt = what they have).
 *
 * Chain is the oracle, three mechanical planes:
 *  (1) ROTATION TIMELINE — live authorities + last_owner/active/post_update
 *      + get_account_history filtered to account_update(10)/recover(23)/
 *      change_recovery(24) per fleet account: how many rotations actually
 *      happened on-chain and when (the "only 4" question, chain-proven).
 *  (2) OPERATOR TOKENS — every P5 token in הד.txt tested against the LIVE
 *      authorities of every fleet account on steem+hive+blurt:
 *      DIRECT (P+WIF as-is) · D1 sha256(account+role+P5) · D2 (sansP) ·
 *      SEED (sha256(P5full)) — roles owner/active/posting/memo.
 *  (3) VAULT ROWS — every sealed steem row's pub compared to the live
 *      authority: LIVE (row rules the chain today) vs STALE (rotated past).
 * Truth JSON → /tmp/r16/truth.json. Public keys only are printed; zero key
 * material leaves this process.
 */
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import bs58 from "bs58";
import { FLEET_ACCOUNTS, chainPub } from "@/lib/gate/key-id";
import { PrismaClient } from "@prisma/client";

const FILE = "/home/z/my-project/upload/הד.txt";
const OUT = "/tmp/r16";
const CANDIDATES = [...FLEET_ACCOUNTS, "headcorner-legacy", "laint", "steemauto"];
const NODES: Record<string, string[]> = {
  steem: ["https://api.steemit.com", "https://api.justyy.com"],
  hive: ["https://api.hive.blog", "https://api.deathwing.me"],
  blurt: ["https://blurt-rpc.saboin.com"],
};
const PREFIX: Record<string, string> = { steem: "STM", hive: "HIVE", blurt: "BLT" };
const ROLES = ["owner", "active", "posting", "memo"] as const;
const db = new PrismaClient();

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function railRpc<T>(rail: string, method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of NODES[rail]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(20000),
        });
        const j = (await res.json()) as any;
        if (j.error) { last = j.error.message; continue; }
        return j.result as T;
      } catch (e) { last = (e as Error).message; if (attempt === 0) await new Promise((r) => setTimeout(r, 1200)); }
    }
  }
  throw new Error(`${rail} down: ${last}`);
}

function pubWireToRaw(pub: string): string | null {
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex"); } catch { return null; }
}

/** raw 33-byte compressed pub hex from 32-byte priv hex. */
function pub33(privHex: string): string {
  const stm = chainPub(privHex, true);
  const body = stm.slice(3);
  return Buffer.from(bs58.decode(body)).subarray(0, 33).toString("hex");
}

function wirePub(privHex: string, rail: string): string {
  return PREFIX[rail] + pub33(privHex);
}

/* ---------- (1) live authorities + rotation history ---------- */

interface LiveAcct {
  chain: string; name: string; exists: boolean;
  auth: Record<string, string[]>; // role → raw33 list
  lastUpdate: Record<string, string | null>;
}

async function fetchLive(rail: string): Promise<LiveAcct[]> {
  const a = await railRpc<any[]>(rail, "condenser_api.get_accounts", [CANDIDATES]);
  return (a || []).map((x: any) => {
    const auth: Record<string, string[]> = {};
    for (const role of ["owner", "active", "posting"] as const) {
      auth[role] = ((x[role]?.key_auths ?? []) as any[]).map((k) => pubWireToRaw(String(k[0]))).filter(Boolean) as string[];
    }
    auth["memo"] = pubWireToRaw(String(x.memo_key ?? "")) ? [pubWireToRaw(String(x.memo_key)) as string] : [];
    return {
      chain: rail, name: String(x.name), exists: true,
      auth,
      lastUpdate: {
        owner: x.last_owner_update ?? null,
        active: x.last_active_update ?? null,
        posting: x.last_post_update ?? null,
      },
    };
  });
}

async function updateHistory(rail: string, account: string): Promise<Array<{ ts: string; trx: string; kind: string }>> {
  // filter bitmask: account_update=10 → 1024, recover_account=23 → 8388608,
  // change_recovery_account=24 → 16777216, request_account_recovery=22 → 4194304
  const low = 1024 | 8388608 | 16777216 | 4194304;
  try {
    const h = await railRpc<any[]>(rail, "condenser_api.get_account_history", [account, -1, 10000, low, 0]);
    return (h || []).map(([, e]: any) => ({
      ts: e.timestamp as string,
      trx: (e.trx_id ?? "") as string,
      kind: (e.op?.[0] ?? "?") as string,
    }));
  } catch (e) {
    return [];
  }
}

/* ---------- (2) operator tokens ---------- */

interface TokenMatch { chain: string; account: string; role: string; variant: string; pub: string }

function parseTokens(): string[] {
  const txt = readFileSync(FILE, "utf8");
  const seen = new Map<string, number>();
  const order: string[] = [];
  for (const tok of txt.match(/P[1-9A-HJ-NP-Za-km-z]{50,52}/g) ?? []) {
    if (!seen.has(tok)) { seen.set(tok, order.length + 1); order.push(tok); }
  }
  return order;
}

function matchToken(p5: string, lives: LiveAcct[]): TokenMatch[] {
  const out: TokenMatch[] = [];
  const variants: Array<[string, (acct: string, role: string) => string]> = [
    ["D1", (a, r) => sha256hex(a + r + p5)],
    ["D2", (a, r) => sha256hex(a + r + p5.slice(1))],
    ["SEED", () => sha256hex(p5)],
    ["SEED-nP", () => sha256hex(p5.slice(1))],
  ];
  // DIRECT: strip P → WIF (checksum-verified)
  let directRaw: string | null = null;
  try {
    const wif = p5.slice(1);
    const raw = Buffer.from(bs58.decode(wif));
    const calc = createHash("sha256").update(createHash("sha256").update(raw.subarray(0, raw.length - 4)).digest()).digest().subarray(0, 4);
    if (raw[0] === 0x80 && raw.subarray(raw.length - 4).equals(calc)) {
      const body = raw.subarray(1, raw.length - 4);
      const privHex = (body.length === 33 ? body.subarray(0, 32) : body).toString("hex");
      directRaw = pub33(privHex);
      for (const live of lives) {
        for (const role of ROLES) {
          if (live.auth[role]?.some((raw33) => raw33 === directRaw)) {
            out.push({ chain: live.chain, account: live.name, role, variant: "DIRECT", pub: wirePub(privHex, live.chain) });
          }
        }
      }
    }
  } catch { /* not a WIF payload */ }
  for (const [name, der] of variants) {
    for (const live of lives) {
      for (const role of ROLES) {
        const privHex = der(live.name, role);
        const raw33 = pub33(privHex);
        if (live.auth[role]?.some((x) => x === raw33)) {
          out.push({ chain: live.chain, account: live.name, role, variant: name, pub: wirePub(privHex, live.chain) });
        }
      }
    }
  }
  return out;
}

/* ---------- (3) vault rows ---------- */

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tokens = parseTokens();
  console.log(`tokens in הד.txt: ${tokens.length} (deduped)\n`);

  // plane 1 — live authorities + histories (steem only for history; auth for 3 rails)
  const steemLives = await fetchLive("steem");
  console.log(`steem live accounts: ${steemLives.length}/${CANDIDATES.length}`);
  const existing = new Set(steemLives.map((x) => x.name));
  const missing = CANDIDATES.filter((c) => !existing.has(c));
  if (missing.length) console.log(`not on steem: ${missing.join(", ")}`);

  const histories: Record<string, Array<{ ts: string; trx: string; kind: string }>> = {};
  for (const live of steemLives) {
    histories[live.name] = await updateHistory("steem", live.name);
  }

  console.log("\n=== (1) ROTATION TIMELINE (steem chain truth) ===");
  for (const live of steemLives) {
    const lu = live.lastUpdate;
    const h = histories[live.name] || [];
    const ups = h.filter((e) => e.kind === "account_update");
    console.log(`\n-- ${live.name}: last_owner=${lu.owner || "1970-01-01"} | last_active=${lu.active || "1970-01-01"} | last_posting=${lu.posting || "1970-01-01"} | account_update ops=${ups.length}`);
    for (const u of ups) console.log(`     ${u.ts} ${u.trx}`);
  }

  // plane 2 — operator tokens vs live (3 rails)
  const hiveLives = await fetchLive("hive").catch(() => []);
  const blurtLives = await fetchLive("blurt").catch(() => []);
  const lives = [...steemLives, ...hiveLives, ...blurtLives];
  console.log(`\n=== (2) OPERATOR TOKENS vs LIVE (${lives.length} live accounts, 3 rails) ===`);
  const tokenReports = tokens.map((tok, i) => {
    const m = matchToken(tok, lives);
    console.log(`T${i + 1} (P${tok.slice(1, 7)}…): ${m.length} live matches → ${m.map((x) => `${x.chain}:${x.account}:${x.role}(${x.variant})`).join(" · ") || "NO MATCH"}`);
    return { token: `T${i + 1}`, matches: m };
  });

  // plane 3 — vault rows vs live steem
  const rows = await db.vaultEntry.findMany({ where: { chain: "steem", role: { in: ["owner", "active", "posting", "memo"] } } });
  console.log(`\n=== (3) VAULT STEEM ROWS vs LIVE: ${rows.length} rows ===`);
  const rowClass = rows.map((r) => {
    const live = steemLives.find((a) => a.name === r.account);
    const raw = r.pub ? pubWireToRaw(r.pub) : null;
    const verdict = !live ? "no-live-account" : !raw ? "no-pub" : live.auth[r.role as string]?.some((x) => x === raw) ? "LIVE" : "STALE";
    return { account: r.account, role: r.role, status: r.status, source: r.source, verdict };
  });
  const byVerdict = new Map<string, number>();
  for (const rc of rowClass) byVerdict.set(rc.verdict, (byVerdict.get(rc.verdict) || 0) + 1);
  console.log("verdicts:", Object.fromEntries(byVerdict));
  for (const rc of rowClass) {
    if (rc.verdict !== "LIVE") console.log(`  ${rc.account}/${rc.role} ${rc.status} [${rc.verdict}] src=${(rc.source || "").slice(0, 40)}`);
  }

  // accounts the operator NOW controls on steem via הד.txt
  const steemMatched = new Map<string, Set<string>>();
  for (const t of tokenReports) for (const m of t.matches) {
    if (m.chain !== "steem") continue;
    const set = steemMatched.get(m.account) || new Set<string>();
    set.add(m.role); steemMatched.set(m.account, set);
  }
  console.log(`\n=== OPERATOR CONTROL ON STEEM (via הד.txt tokens): ${steemMatched.size} accounts ===`);
  for (const [acct, roles] of steemMatched) console.log(`  ${acct}: ${[...roles].join(",")}`);

  writeFileSync(`${OUT}/truth.json`, JSON.stringify({
    at: new Date().toISOString(),
    tokens: tokenReports,
    histories,
    rowClass,
    operatorSteemControl: Object.fromEntries([...steemMatched].map(([k, v]) => [k, [...v]])),
  }, null, 2));
  console.log(`\ntruth → ${OUT}/truth.json`);
  await db.$disconnect();
}
main();

export {};
