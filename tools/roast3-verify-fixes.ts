/**
 * ROAST round 3 — post-fix live verification (READ-ONLY).
 * 1. fleetRewardsCensus through the NEW code (notOnChain honesty) — requires
 *    master for nothing; census is read-only, but it reads the vault for keys,
 *    so it runs WITHOUT requireMaster? It does not call requireMaster — safe.
 *    (If it throws, we report honestly and continue with the rest.)
 * 2. auditFleetContent through the NEW code — full-body + tags + category,
 *    immutable findings separated from needsEdit.
 * 3. Every round-3 remediation txId must exist on chain (get_transaction).
 */
import { PrismaClient } from "@prisma/client";
import { fleetRewardsCensus, auditFleetContent } from "../src/lib/gate/harness/social";

const db = new PrismaClient();
const STEEM_NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://api.steemitdev.com"];

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let lastErr: unknown = null;
  for (const url of STEEM_NODES) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message || "rpc error");
      return j.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`rpc failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

const R3_TXS = [
  "579df5694968ca6a8404cfdd2186c359efc90d99", // 5vmvfj
  "68e46a11738f4b45b781d0dab26bdd92505b1692", // 7ssdza
  "8c8bc2a8141bdbd543b8b1e92196d79912f44a3e", // bandwidth (run1)
  "7a16ad616a4586d2ea69a675683e0167b860b733", // 2gqskj
  "3196302db549ac08817ed112ef65cbddee858366", // yizkor
  "cbbcb4f8569bbe8b18c4b9399852e858d553d74b", // celebrating (run1 surgical)
];

async function main(): Promise<void> {
  console.log("── 1. census (new code, notOnChain honesty) ──");
  try {
    const c = await fleetRewardsCensus();
    console.log(c.summary);
  } catch (e) {
    console.log(`census unavailable in this process (expected if master-gated): ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  }

  console.log("\n── 2. content audit (new code: full body + tags + category) ──");
  const a = await auditFleetContent(20);
  console.log(a.summary);
  for (const p of a.posts) {
    if (p.needsEdit || p.immutableFindings.length) {
      console.log(
        `  ${p.rail}/${p.permlink.slice(0, 50)} needsEdit=${p.needsEdit} editable=[${p.findings.map((f) => f.kind).join(",")}] immutable=[${p.immutableFindings.map((f) => f.kind).join(",")}]`,
      );
    }
  }

  console.log("\n── 3. round-3 txs on chain ──");
  for (const tx of R3_TXS) {
    try {
      const t = await rpc<{ transaction_id: string; block_num: number }>("condenser_api.get_transaction", [tx]);
      console.log(`  ${tx.slice(0, 16)}… block ${t.block_num} · ON CHAIN ✅`);
    } catch (e) {
      console.log(`  ${tx.slice(0, 16)}… ❌ ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("verify failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
