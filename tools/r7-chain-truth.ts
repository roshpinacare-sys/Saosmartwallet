/**
 * ROAST round 7 — chain truth (READ-ONLY).
 * Planes: (1) steem feed since 00:00Z today — anything new after the r6-code
 * era began (~13:18Z restart)? (2) remediation persistence — do the immutables
 * STILL hold? (3) rewards census + headcorner balances. (4) custom_json anchor
 * stream still coherent (external relay). (5) hive RC wall re-measure.
 * (6) ETH/SOL eyes-balances for the 12+12 vault wallets.
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

async function main() {
  console.log(`R7 CHAIN TRUTH @ ${new Date().toISOString()}`);

  const entries = await db.vaultEntry.findMany({
    where: { chain: "steem", account: { not: null } },
    select: { account: true },
    distinct: ["account"],
  });
  const fleet = entries.map((e) => e.account as string).filter(Boolean);
  console.log(`fleet (vault): ${fleet.length}`);

  // ── 1. feed since 00:00Z ──────────────────────────────────────────────────
  console.log("\n── [1] steem feed (headcorner, own posts, 00:00Z+ today)");
  const blog = await rpc<Array<Record<string, string>>>(STEEM_NODES, "condenser_api.get_discussions_by_blog", [
    { tag: "headcorner", limit: 50 },
  ]);
  const own = blog.filter((p) => String(p.author).toLowerCase() === "headcorner");
  const dayStart = Date.parse("2026-09-10T00:00:00Z");
  let todayCount = 0;
  let postCode = 0;
  const kindsAll = new Map<string, number>();
  for (const p of own) {
    const created = Date.parse(String(p.created));
    if (created < dayStart) continue;
    todayCount++;
    const title = String(p.title || "");
    const body = String(p.body || "");
    let tags: string[] = [];
    try {
      const j = JSON.parse(p.json_metadata || "{}") as { tags?: unknown };
      if (Array.isArray(j.tags)) tags = (j.tags as unknown[]).map(String);
    } catch {
      /* ignore */
    }
    const hay = `${title} ${body} ${tags.join(",")} ${p.category || ""}`;
    if (HEBREW.test(title) || HEBREW.test(body) || tags.some((t) => HEBREW.test(t))) postCode++;
    if (CODE_NAME.test(hay)) postCode++;
    if (SOLICIT.test(body)) postCode++;
    console.log(`  · ${p.created.slice(5, 16)} ${String(p.permlink).slice(0, 60)} (${body.length}ch)`);
  }
  console.log(`  posts today: ${todayCount} · doctrine hits: ${postCode}`);

  // ── 2. immutables still hold (the 6 r3-remediated + yizkor etc.) ─────────
  console.log("\n── [2] remediation persistence (all own posts full-scan, category included)");
  let regressed = 0;
  let immutableReported = 0;
  for (const p of own) {
    const title = String(p.title || "");
    const body = String(p.body || "");
    const category = String(p.category || "");
    let tags: string[] = [];
    try {
      const j = JSON.parse(p.json_metadata || "{}") as { tags?: unknown };
      if (Array.isArray(j.tags)) tags = (j.tags as unknown[]).map(String);
    } catch {
      /* ignore */
    }
    const editableHebrew = HEBREW.test(title) || HEBREW.test(body) || tags.some((t) => HEBREW.test(t));
    const categoryHebrew = HEBREW.test(category); // parent_permlink burned at publish — unfixable
    const saos = CODE_NAME.test(`${title} ${body} ${tags.join(",")}`);
    const sol = SOLICIT.test(body);
    if (editableHebrew || saos || sol) {
      immutableReported++;
      if (Date.parse(String(p.created)) > dayStart) regressed++;
      console.log(`  ⚠ EDITABLE ${p.created.slice(5, 16)} ${String(p.permlink).slice(0, 55)} hebrew=${editableHebrew} saos=${saos} sol=${sol}`);
    } else if (categoryHebrew) {
      immutableReported++;
      console.log(`  · immutable-category ${p.created.slice(5, 16)} ${String(p.permlink).slice(0, 45)} cat="${category.slice(0, 30)}"`);
    }
  }
  console.log(`  regressed-since-midnight: ${regressed} · immutable-candidates total: ${immutableReported}`);

  // ── 3. census + headcorner ────────────────────────────────────────────────
  console.log("\n── [3] census (fleet)");
  const accounts = await rpc<Array<Record<string, string>>>(STEEM_NODES, "condenser_api.get_accounts", [fleet]);
  let pending = 0;
  for (const a of accounts) {
    const r = [a.reward_steem_balance, a.reward_sbd_balance, a.reward_vesting_balance].map((s) => String(s).split(" ")[0]);
    if (r.some((x) => Number(x) > 0)) {
      pending++;
      console.log(`  ⚠ pending ${a.name}: STEEM=${r[0]} SBD=${r[1]} VESTS=${r[2]}`);
    }
  }
  const hc = accounts.find((a) => a.name === "headcorner");
  console.log(`  pending=${pending}/${accounts.length} · headcorner STEEM=${hc?.balance} SBD=${hc?.sbd_balance} VESTS=${hc?.vesting_shares}`);

  // ── 4. custom_json anchor stream (external relay still alive?) ───────────
  console.log("\n── [4] custom_json stream (headcorner, last 200 ops)");
  try {
    const hist = await rpc<Array<[number, { block: number; timestamp: string; op: [string, Record<string, unknown>] }]>>(
      STEEM_NODES,
      "condenser_api.get_account_history",
      ["headcorner", -1, 100],
    );
    const cj = hist.filter(([, t]) => t.op[0] === "custom_json");
    let coded = 0;
    let blocks: number[] = [];
    for (const [, t] of cj) {
      const id = String(t.op[1].id || "");
      if (id.includes("saos")) coded++;
      blocks.push(t.block);
    }
    const gap = blocks.length ? Math.max(...blocks) - Math.min(...blocks) : 0;
    console.log(`  custom_json in last ${hist.length} ops: ${cj.length} · codename-carrying: ${coded} · block-span: ${gap}`);
  } catch (e) {
    console.log(`  history error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 5. hive RC wall ───────────────────────────────────────────────────────
  console.log("\n── [5] hive RC wall (headcorner)");
  try {
    const acc = await rpc<Array<Record<string, string>>>(HIVE_NODES, "condenser_api.get_accounts", [["headcorner"]]);
    let rcMana = 0;
    try {
      const m = JSON.parse(String(acc?.[0]?.rc_manabar || "{}")) as { current_mana?: string };
      rcMana = Number(m.current_mana || 0);
    } catch {
      /* rc field missing */
    }
    console.log(`  rc current_mana: ${rcMana} (wall: needs ~914M per edit — measured r3)`);
  } catch (e) {
    console.log(`  hive error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 6. ETH/SOL eyes balances (vault wallets) ─────────────────────────────
  console.log("\n── [6] multichain eyes (vault wallets)");
  const evm = await db.vaultEntry.findMany({
    where: { chain: { in: ["ethereum", "solana"] }, pub: { not: null } },
    select: { chain: true, pub: true },
    distinct: ["chain", "pub"],
  });
  const eths = evm.filter((e) => e.chain === "ethereum").map((e) => e.pub as string);
  const sols = evm.filter((e) => e.chain === "solana").map((e) => e.pub as string);
  console.log(`  vault wallets: eth=${eths.length} sol=${sols.length}`);
  for (const pub of eths) {
    try {
      const wei = await rpc<string>(["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"], "eth_getBalance", [pub, "latest"]);
      console.log(`  ETH ${pub.slice(0, 10)}… = ${(Number(BigInt(wei)) / 1e18).toFixed(6)}`);
    } catch (e) {
      console.log(`  ETH ${pub.slice(0, 10)}… error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const pub of sols) {
    try {
      const res = await rpc<{ value: string }>(["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"], "getBalance", [pub]);
      console.log(`  SOL ${pub.slice(0, 10)}… = ${(Number(res.value) / 1e9).toFixed(6)}`);
    } catch (e) {
      console.log(`  SOL ${pub.slice(0, 10)}… error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await db.$disconnect();
  console.log("\nR7 chain truth done.");
}

main().catch((e) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
