/** R6 — inspect the saos-dex.anchor.v1 custom_json stream: content + start time. READ-ONLY. */
export {}; // module scope — global-script tools collide on rpc/main (tsc TS2393)
const NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://api.steemitdev.com"];

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let lastErr: unknown = null;
  for (const url of NODES) {
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
  throw new Error(`all nodes failed for ${method}: ${String(lastErr)}`);
}

interface Trace {
  block: number;
  timestamp: string;
  op: [string, Record<string, unknown>];
}

async function main() {
  // 1. full content of the latest anchor op
  const latest = await rpc<Array<[number, Trace]>>("condenser_api.get_account_history", ["headcorner", -1, 2]);
  for (const [idx, t] of latest) {
    if (t.op[0] === "custom_json") {
      console.log(`── latest custom_json #${idx} @${t.timestamp} b${t.block}`);
      console.log(JSON.stringify(t.op[1], null, 1).slice(0, 1200));
    }
  }

  // 2. find the START of the anchor stream: walk backwards in 100-op pages until
  //    we see a non-anchor op, or hit ~3000 ops.
  let start = (latest[latest.length - 1]?.[0] ?? 0) - 1; // highest idx to examine
  let firstAnchorIdx: number | null = null;
  let scanned = 0;
  let nonAnchor: Array<[number, Trace]> = [];
  for (let page = 0; page < 40 && scanned < 4000; page++) {
    const from = Math.max(start, 1);
    const limit = Math.min(from, 100);
    const batch = await rpc<Array<[number, Trace]>>("condenser_api.get_account_history", [
      "headcorner",
      from,
      limit,
    ]);
    if (!batch.length) break;
    scanned += batch.length;
    for (const [idx, t] of batch) {
      if (idx > start) continue; // already-seen overlap window
      if (t.op[0] === "custom_json" && String(t.op[1].id || "") === "saos-dex.anchor.v1") {
        if (firstAnchorIdx === null || idx < firstAnchorIdx) firstAnchorIdx = idx;
      } else if (firstAnchorIdx !== null && idx < firstAnchorIdx) {
        nonAnchor.push([idx, t]);
      }
    }
    const oldestIdx = batch[0][0];
    if ((nonAnchor.length >= 8 && firstAnchorIdx !== null) || oldestIdx <= 1) break;
    start = oldestIdx - 1;
  }
  console.log(`\n── anchor stream: first idx seen=${firstAnchorIdx}, ops scanned=${scanned}`);
  if (firstAnchorIdx !== null) {
    const around = await rpc<Array<[number, Trace]>>("condenser_api.get_account_history", [
      "headcorner",
      Math.max(firstAnchorIdx - 3, 1),
      8,
    ]);
    for (const [idx, t] of around) {
      console.log(`  #${idx} ${t.timestamp} b${t.block} ${t.op[0]}${t.op[0] === "custom_json" ? ` id=${t.op[1].id}` : ""}`);
    }
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
