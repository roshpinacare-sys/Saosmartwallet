/**
 * ROAST round 3 — chain-truth probe (READ-ONLY, no keys, no broadcasts).
 *
 * Verifies every fleet claim against the chains themselves:
 *   1. Full census of vault steem accounts (pending rewards, balances, last_root_post).
 *   2. FULL-BODY scan of every recent fleet post (Hebrew / codename / solicitation /
 *      secret-material patterns) — not just the first 400 chars the audit module sees.
 *   3. Every recent ok:true sovereign-voice GateAction txId must exist ON CHAIN
 *      (get_transaction) — "ok:true" vs reality.
 *   4. Self-vote check on our own posts (active_votes includes headcorner?).
 *   5. Hive RC wall + pending (claim from worklog: 34.1M RC vs ~1.31B needed).
 *   6. ETH/SOL vault totals (eyes cross-check).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const STEEM_NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://api.steemitdev.com"];
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"];

async function rpc<T>(nodes: string[], method: string, params: unknown, timeoutMs = 12_000): Promise<T> {
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
function scan(kind: string, where: string, text: string): string[] {
  const hits: string[] = [];
  if (HEBREW.test(text)) hits.push(`${where}:HEBREW(${(text.match(new RegExp(".{0,25}[\u0590-\u05FF]+.{0,25}", "g")) || []).length} spans, first: ${(text.match(new RegExp(".{0,20}[\u0590-\u05FF]+.{0,20}", "g")) || ["?"])[0].replace(/\s+/g, " ")})`);
  if (/saos/i.test(text)) hits.push(`${where}:codename-saos`);
  if (/wif|5[HJK][1-9A-Za-z]{49}/.test(text)) hits.push(`${where}:possible-WIF`);
  if (/localhost|127\.0\.0\.1|\/home\/|0x[0-9a-fA-F]{40}/.test(text)) hits.push(`${where}:infra-or-addr-leak`);
  if (/send .{0,12}(STEEM|HIVE|SBD)|transfer .{0,12}(STEEM|HIVE|SBD) to/i.test(text)) hits.push(`${where}:solicitation`);
  void kind;
  return hits;
}

async function main(): Promise<void> {
  // ── 1. steem census of the vault fleet ─────────────────────────────────
  const steemKeys = await db.vaultEntry.findMany({
    where: { chain: "steem", role: "posting" },
    select: { account: true, status: true },
  });
  const accounts = [...new Set(steemKeys.map((k) => k.account))];
  console.log(`vault steem posting entries: ${steemKeys.length} (${accounts.join(", ")})`);
  const raw = await rpc<Array<Record<string, string>>>(STEEM_NODES, "condenser_api.get_accounts", [accounts]);
  let pendingAccounts = 0;
  for (const a of raw) {
    const pend = [a.reward_steem_balance, a.reward_sbd_balance, a.reward_vesting_balance]
      .map((s) => parseFloat(String(s).split(" ")[0]) || 0)
      .reduce((x, y) => x + y, 0);
    if (pend > 0) pendingAccounts++;
    console.log(
      `  @${a.name}: pending=${pend.toFixed(3)} balance=${a.balance} sbd=${a.sbd_balance} vests=${a.vesting_shares} last_root_post=${a.last_root_post} post_count=${a.post_count}`,
    );
  }
  console.log(`census: ${pendingAccounts}/${raw.length} accounts hold pending rewards`);

  // ── 2. FULL-BODY doctrine scan of the live blog feed ────────────────────
  const blog = await rpc<Array<Record<string, string>>>(STEEM_NODES, "condenser_api.get_discussions_by_blog", [
    { tag: "headcorner", limit: 20 },
  ]);
  console.log(`\nblog feed: ${blog.length} posts (FULL-body doctrine scan)`);
  const selfVoted: string[] = [];
  for (const p of blog) {
    const metaTags = (() => {
      try {
        const j = JSON.parse(p.json_metadata || "{}") as { tags?: unknown };
        return Array.isArray(j.tags) ? (j.tags as string[]) : [];
      } catch {
        return [];
      }
    })();
    const violations = [
      ...scan("title", "title", p.title || ""),
      ...scan("body", "body", p.body || ""),
      ...(metaTags || []).map((t) => scan("tag", `tag:${t}`, t)).flat(),
      ...scan("category", "category", p.category || ""),
      ...scan("meta", "json_metadata", p.json_metadata || ""),
    ];
    const votedSelf = (p.active_votes || []).some((v: Record<string, unknown>) => v.voter === "headcorner");
    if (votedSelf) selfVoted.push(p.permlink);
    console.log(
      `  ${p.permlink.slice(0, 60)} · created=${p.created} · payout=${p.pending_payout_value || p.total_payout_value} · chars=${(p.body || "").length} · tags=[${(metaTags || []).join(",")}] · selfVote=${votedSelf ? "YES" : "no"}${violations.length ? `\n    ❌ VIOLATIONS: ${violations.join(" | ")}` : " · ✅ clean"}`,
    );
  }
  console.log(`self-votes found: ${selfVoted.length ? selfVoted.join(", ") : "none"}`);

  // ── 3. every ok:true sovereign-voice action must exist ON CHAIN ────────
  const actions = await db.gateAction.findMany({
    where: { action: { startsWith: "sovereign-voice:" }, ok: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  console.log(`\nchain-evidence audit: last ${actions.length} ok:true sovereign-voice actions`);
  let missing = 0;
  for (const a of actions) {
    let txId = "";
    try {
      const r = JSON.parse(a.result || "{}") as { txId?: string };
      txId = r.txId || "";
    } catch {
      /* empty */
    }
    if (!txId) {
      console.log(`  ${a.action} @${a.createdAt.toISOString()} · NO TXID IN EVIDENCE ❌`);
      missing++;
      continue;
    }
    try {
      const tx = await rpc<{ transaction_id?: string; block_num?: number }>(STEEM_NODES, "condenser_api.get_transaction", [txId], 15_000);
      if (tx && tx.transaction_id === txId) {
        console.log(`  ${a.action} @${a.createdAt.toISOString()} · tx ${txId.slice(0, 16)}… block ${tx.block_num} · ON CHAIN ✅`);
      } else {
        console.log(`  ${a.action} @${a.createdAt.toISOString()} · tx ${txId.slice(0, 16)}… · MISMATCH ❌`);
        missing++;
      }
    } catch (e) {
      console.log(`  ${a.action} @${a.createdAt.toISOString()} · tx ${txId.slice(0, 16)}… · NOT FOUND/UNREACHABLE ❌ (${e instanceof Error ? e.message.slice(0, 80) : e})`);
      missing++;
    }
  }
  console.log(`chain-evidence: ${actions.length - missing}/${actions.length} verified on chain`);

  // ── 4. hive RC wall re-measurement ──────────────────────────────────────
  try {
    const rc = await rpc<{ rc_accounts: Array<{ rc_manabar: { current_mana: string }; max_rc: string }> }>(
      HIVE_NODES, "rc_api.find_rc_accounts", { accounts: ["headcorner"] },
    );
    const cur = Number(rc.rc_accounts?.[0]?.rc_manabar?.current_mana ?? 0);
    const max = Number(rc.rc_accounts?.[0]?.max_rc ?? 0);
    const acc = await rpc<Array<Record<string, string>>>(HIVE_NODES, "condenser_api.get_accounts", [["headcorner"]]);
    const a = acc[0];
    const pendingHive =
      (parseFloat(String(a?.reward_hive_balance || "0").split(" ")[0]) || 0) +
      (parseFloat(String(a?.reward_hbd_balance || "0").split(" ")[0]) || 0) +
      (parseFloat(String(a?.reward_vesting_hive || a?.reward_vesting_balance || "0").split(" ")[0]) || 0);
    console.log(`\nhive @headcorner: RC ${cur.toFixed(1)} / max ${max.toFixed(1)} (${((cur / (max || 1)) * 100).toFixed(1)}%) · pending=${pendingHive.toFixed(3)} · hp-vests=${a?.vesting_shares}`);
  } catch (e) {
    console.log(`\nhive probe failed: ${e instanceof Error ? e.message : e}`);
  }

  // ── 5. ETH/SOL vault totals (eyes cross-check) ──────────────────────────
  const ethRows = await db.vaultEntry.findMany({ where: { chain: "ethereum", role: "wallet", status: { not: "rotated-out" } }, select: { pub: true, account: true } });
  let ethTotal = 0n;
  let ethOk = 0;
  for (const r of ethRows) {
    try {
      const hex = await rpc<string>(["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"], "eth_getBalance", [r.pub, "latest"]);
      ethTotal += BigInt(hex);
      ethOk++;
    } catch {
      /* honest skip */
    }
  }
  console.log(`\nethereum: ${ethOk}/${ethRows.length} wallets · total ${(Number(ethTotal) / 1e18).toFixed(6)} ETH`);
  const solRows = await db.vaultEntry.findMany({ where: { chain: "solana", role: "wallet", status: { not: "rotated-out" } }, select: { pub: true, account: true } });
  let solTotal = 0n;
  let solOk = 0;
  for (const r of solRows) {
    try {
      const res = await rpc<{ value: string }>(["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"], "getBalance", [r.pub]);
      solTotal += BigInt(res.value);
      solOk++;
    } catch {
      /* honest skip */
    }
  }
  console.log(`solana: ${solOk}/${solRows.length} wallets · total ${(Number(solTotal) / 1e9).toFixed(6)} SOL`);
}

main()
  .catch((e) => {
    console.error("probe failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
