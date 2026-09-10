/**
 * r10 — the server-side sweep, exactly as the inventory route runs it.
 * Runs the NEW multi-rail verifyAll() live (authority plane needs no master;
 * sealed kinds report honest noLive while locked).
 */
import { verifyAll } from "../src/lib/gate/verify";

const { entries, steemOk, hiveOk, blurtOk, githubOk } = await verifyAll();
const verified = entries.filter((e) => e.liveOk === true).length;
const failed = entries.filter((e) => e.liveOk === false).length;
const noLive = entries.filter((e) => e.liveOk === null).length;
console.log(`nodes: steem=${steemOk} hive=${hiveOk} blurt=${blurtOk} github=${githubOk}`);
console.log(`entries: ${entries.length} · verified=${verified} failed=${failed} noLive=${noLive}`);
const rails: Record<string, number> = {};
for (const e of entries) for (const c of e.chains) rails[c] = (rails[c] || 0) + 1;
console.log("live authorities per rail:", JSON.stringify(rails));
for (const e of entries.filter((x) => x.liveOk !== true)) {
  console.log(`  NOT-verified: kind=${e.kind} chain=${e.chain} ${e.account ?? ""}@${e.role ?? ""} liveOk=${e.liveOk} · ${e.detail.slice(0, 110)}`);
}
process.exit(0);
