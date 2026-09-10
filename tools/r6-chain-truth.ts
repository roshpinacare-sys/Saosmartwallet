/**
 * ROAST round 6 — chain truth (READ-ONLY).
 * New attack surface: between 07:34Z (r5 push) and ~08:46Z, THIS working copy
 * was still running FLEET-MIND-era code (pre VALUE-OPS/r2..r5 fixes: no
 * codename-tag scan, no self-vote guard, no builder v3). If the heart fired
 * schedules in that window, the chain is the ledger that will confess.
 * Also: remediation persistence (do the 6 fixed posts STILL hold clean?)
 * + rewards census + headcorner balances.
 */
import { db } from "../src/lib/db";

const STEEM_NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://api.steemitdev.com"];
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"];

async function rpc<T>(nodes: string[], method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
  let lastErr: unknown = null;
  for (const url of nodes) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message || "rpc error");
      return j.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`all nodes failed for ${method}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

const HEBREW = /[\u0590-\u05FF]/;
const SOLICIT = /(send|transfer|deposit)\s+(steem|sbd|hive|hbd)/i;
const CODE_NAME = /saos/i;

interface Finding {
  account: string;
  permlink: string;
  created: string;
  kinds: string[];
  chars: number;
}

function scanPost(account: string, p: Record<string, string>): Finding | null {
  const title = String(p.title || "");
  const body = String(p.body || "");
  let tags: string[] = [];
  try {
    const j = JSON.parse(p.json_metadata || "{}") as { tags?: unknown };
    if (Array.isArray(j.tags)) tags = (j.tags as unknown[]).map(String);
  } catch {
    /* metadata unparseable */
  }
  const kinds: string[] = [];
  if (HEBREW.test(title)) kinds.push("hebrew-title");
  if (HEBREW.test(body)) kinds.push("hebrew-body");
  if (tags.some((t) => HEBREW.test(t))) kinds.push("hebrew-tag");
  const hay = `${title} ${body} ${tags.join(",")} ${p.category || ""}`;
  if (CODE_NAME.test(hay)) kinds.push("codename-saos");
  if (SOLICIT.test(body)) kinds.push("solicitation");
  if (!kinds.length) return null;
  return { account, permlink: String(p.permlink), created: String(p.created), kinds, chars: body.length };
}

async function feedWindow(rail: string, nodes: string[], account: string): Promise<{ scanned: number; findings: Finding[]; newest: string }> {
  const rows = await rpc<Array<Record<string, string>>>(nodes, "condenser_api.get_discussions_by_blog", [
    { tag: account, limit: 20 },
  ]);
  const findings: Finding[] = [];
  let scanned = 0;
  let newest = "";
  for (const p of rows) {
    if (String(p.author || "").toLowerCase() !== account) continue; // reblogs are not our words
    scanned++;
    if (!newest) newest = String(p.created);
    const f = scanPost(account, p);
    if (f) findings.push(f);
  }
  return { scanned, findings, newest };
}

async function main() {
  const nowIso = new Date().toISOString();
  console.log(`R6 CHAIN TRUTH @ ${nowIso}`);

  // ── fleet accounts from the vault ─────────────────────────────────────────
  const entries = await db.vaultEntry.findMany({
    where: { chain: "steem", account: { not: null } },
    select: { account: true },
    distinct: ["account"],
  });
  const fleet = entries.map((e) => e.account as string).filter(Boolean);
  console.log(`fleet accounts (vault): ${fleet.length} → ${fleet.join(", ")}`);

  // ── 1. the 07:34Z→now window on steem feed (old code ran here) ────────────
  console.log("\n── [1] steem feed window audit (headcorner, newest 20 own posts)");
  const wcutoff = Date.parse("2026-09-10T07:00:00Z");
  const steemFeed = await feedWindow("steem", STEEM_NODES, "headcorner");
  console.log(`  own posts scanned: ${steemFeed.scanned}, newest created: ${steemFeed.newest}`);
  const inWindow = steemFeed.findings.filter((f) => Date.parse(f.created) >= wcutoff);
  const older = steemFeed.findings.filter((f) => Date.parse(f.created) < wcutoff);
  console.log(`  doctrine findings in window (>=07:00Z today): ${inWindow.length}`);
  for (const f of inWindow) console.log(`    ⚠ ${f.permlink} @${f.created} → ${f.kinds.join(",")}`);
  console.log(`  doctrine findings older (pre-window, expected = documented immutables): ${older.length}`);
  for (const f of older.slice(0, 10)) console.log(`    · ${f.permlink} @${f.created.slice(0, 16)} → ${f.kinds.join(",")}`);

  // ── 2. hive feed (economic wall — nothing new should exist) ───────────────
  console.log("\n── [2] hive feed audit (headcorner)");
  try {
    const hiveFeed = await feedWindow("hive", HIVE_NODES, "headcorner");
    console.log(`  own posts scanned: ${hiveFeed.scanned}, newest: ${hiveFeed.newest}`);
    for (const f of hiveFeed.findings) console.log(`    · ${f.permlink} @${f.created.slice(0, 16)} → ${f.kinds.join(",")}`);
  } catch (e) {
    console.log(`  hive feed error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 3. account history window scan: votes/comments/custom_json today ──────
  console.log("\n── [3] headcorner account history since 07:00Z (self-vote guard era check)");
  try {
    const hist = await rpc<Array<[number, { block: number; timestamp: string; op: [string, Record<string, unknown>] }]>>(
      STEEM_NODES,
      "condenser_api.get_account_history",
      ["headcorner", -1, 100],
    );
    const windowOps = hist.filter(([, t]) => Date.parse(t.timestamp + "Z") >= wcutoff);
    console.log(`  ops fetched: ${hist.length}, in window: ${windowOps.length}`);
    for (const [idx, t] of windowOps) {
      const [type, val] = t.op;
      let detail = "";
      if (type === "vote") {
        const voter = String(val.voter);
        const author = String(val.author);
        const self = voter === author ? " ⚠ SELF-VOTE" : "";
        detail = `${voter}→${author} permlink=${String(val.permlink).slice(0, 40)} w=${val.weight}${self}`;
      } else if (type === "comment") {
        detail = `parent=@${String(val.parent_author) || "root"}/"${String(val.title || val.parent_permlink).slice(0, 50)}"`;
      } else if (type === "custom_json") {
        detail = `id=${String(val.id)}`;
      } else {
        detail = JSON.stringify(val).slice(0, 90);
      }
      console.log(`  #${idx} ${t.timestamp} b${t.block} ${type} ${detail}`);
    }
  } catch (e) {
    console.log(`  history error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 4. remediation persistence: the 6 fixed posts must STILL hold ─────────
  console.log("\n── [4] remediation persistence (get_content, zero-Hebrew must hold)");
  const fixed: Array<[string, string, string]> = [
    ["post-mtusiimi", "the-rise-of-hive-129948-a-new-frontier-in-decentralized-communities-mtuz3qgq", "r2 remediation"],
    ["post-mtuvl028", "", "r2 remediation"],
    ["saos-1-protocol-spec-20260906", "", "r2 remediation"],
    ["saos-1-protocol-spec-20260905", "", "r2 remediation"],
    ["saos-1-protocol-spec-20260904", "", "r2 remediation"],
    ["saos-1-protocol-spec-20260903", "", "r2 remediation"],
  ];
  // resolve permlinks from the live feed history instead of hardcoding:
  const allSteem = await rpc<Array<Record<string, string>>>(STEEM_NODES, "condenser_api.get_discussions_by_blog", [
    { tag: "headcorner", limit: 50 },
  ]);
  const candidates = allSteem.filter((p) => String(p.author).toLowerCase() === "headcorner");
  for (const [needle, _hint, label] of fixed) {
    const p = candidates.find((c) => String(c.permlink).includes(needle));
    if (!p) {
      console.log(`  ? ${needle}: not in latest 50 (older than window) — skipped`);
      continue;
    }
    const body = String(p.body || "");
    const title = String(p.title || "");
    let tags: string[] = [];
    try {
      const j = JSON.parse(p.json_metadata || "{}") as { tags?: unknown };
      if (Array.isArray(j.tags)) tags = (j.tags as unknown[]).map(String);
    } catch {
      /* ignore */
    }
    const hebrew = HEBREW.test(title) || HEBREW.test(body) || tags.some((t) => HEBREW.test(t));
    const saos = CODE_NAME.test(`${title} ${body} ${tags.join(",")}`);
    console.log(`  ${hebrew || saos ? "⚠ REGRESSED" : "✓ holds"} ${needle} (${label}) title="${title.slice(0, 40)}" hebrew=${hebrew} saos=${saos}`);
  }

  // ── 5. rewards census across the fleet ────────────────────────────────────
  console.log("\n── [5] rewards census (fleet, steem)");
  const accounts = await rpc<Array<Record<string, string>>>(STEEM_NODES, "condenser_api.get_accounts", [fleet]);
  let pending = 0;
  const known = new Set(fleet);
  for (const a of accounts) known.delete(String(a.name));
  const notOnChain = [...known];
  for (const a of accounts) {
    const r = [a.reward_steem_balance, a.reward_sbd_balance, a.reward_vesting_balance].map((s) => String(s).split(" ")[0]);
    const has = r.some((x) => Number(x) > 0);
    if (has) {
      pending++;
      console.log(`  ⚠ ${a.name}: STEEM=${r[0]} SBD=${r[1]} VESTS=${r[2]}`);
    }
  }
  console.log(`  accounts with pending: ${pending}/${accounts.length}${notOnChain.length ? ` · notOnChain(vault-only): ${notOnChain.join(",")}` : ""}`);

  // ── 6. headcorner balances ────────────────────────────────────────────────
  const hc = accounts.find((a) => a.name === "headcorner");
  if (hc) {
    console.log(`\n── [6] headcorner: STEEM=${hc.balance} SBD=${hc.sbd_balance} VESTS=${hc.vesting_shares}`);
  }

  await db.$disconnect();
  console.log("\nR6 chain truth done.");
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
