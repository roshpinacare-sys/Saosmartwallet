/** r16 follow-up: headcorner/ynet timeline + posting account_auths for all steem fleet accounts. */
import { createHash } from "crypto";
import bs58 from "bs58";
import { FLEET_ACCOUNTS } from "@/lib/gate/key-id";

const NODES = ["https://api.steemit.com", "https://api.justyy.com"];
const CANDIDATES = [...FLEET_ACCOUNTS, "headcorner-legacy"];
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of NODES) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = (await res.json()) as any;
      if (j.error) { last = j.error.message; continue; }
      return j.result as T;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`down: ${last}`);
}
async function main() {
  const a = await rpc<any[]>("condenser_api.get_accounts", [CANDIDATES]);
  console.log("=== last-authority updates (steem) ===");
  for (const x of a || []) {
    console.log(`${x.name}: owner=${x.last_owner_update} active=${x.last_active_update} posting=${x.last_post_update} created=${x.created}`);
  }
  console.log("\n=== posting/active/owner ACCOUNT_AUTHS (delegated doors) ===");
  for (const x of a || []) {
    const doors: string[] = [];
    for (const role of ["owner", "active", "posting"] as const) {
      for (const acc of x[role]?.account_auths ?? []) doors.push(`${role}←${acc[0]}(${acc[1]})`);
    }
    if (doors.length) console.log(`${x.name}: ${doors.join(" · ")}`);
  }
  console.log("\n=== headcorner/ynet account_update history (unfiltered tail scan) ===");
  for (const name of ["headcorner", "ynet", "cashmachine"]) {
    try {
      const h = await rpc<any[]>("condenser_api.get_account_history", [name, -1, 300]);
      const ups = (h || []).map(([, e]: any) => e).filter((e: any) => e.op?.[0] === "account_update" || e.op?.[0] === "recover_account");
      console.log(`\n${name}: scanned 300 → ${ups.length} key ops`);
      for (const e of ups) console.log(`  ${e.timestamp} ${e.op[0]} trx=${e.trx_id}`);
    } catch (e) { console.log(`${name}: history failed ${(e as Error).message}`); }
  }
}
main();

export {};
