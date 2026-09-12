/** r37 — search account history (creation + all account_update ops) for the recovered pub. */
import bs58 from "bs58";
const node = process.argv[2] || "https://api.steemit.com";
const TARGET_RAW = "03d4a70c5518ba509beb8466bf93c4e24ba6134afde327383585a2587f4d5b8d78";
const raw33Of = (pub: string): string | null => {
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex"); } catch { return null; }
};
const call = async (method: string, params: unknown[]) => {
  const r = await fetch(node, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(25000),
  });
  return r.json();
};
// total op count
const last = await call("condenser_api.get_account_history", ["headcorner", -1, 1]);
const lastIdx: number = (last.result || [])[0]?.[0] ?? -1;
console.log(node, "· total ops ≈", lastIdx + 1);
if (lastIdx < 0) process.exit(0);
// scan the FULL history in 10k pages
let hits = 0;
for (let lo = 0; lo <= lastIdx; lo += 10000) {
  const hi = Math.min(lo + 9999, lastIdx);
  const r = await call("condenser_api.get_account_history", ["headcorner", hi, hi - lo]);
  const items: Array<[number, { op: [string, Record<string, unknown>]; timestamp: string }]> = r.result || [];
  for (const [idx, ev] of items) {
    const op = ev.op?.[1] || {};
    const auths: Array<{ role: string; keys: string[] }> = [];
    for (const role of ["owner", "active", "posting"] as const) {
      const ka = (op[role] as { key_auths?: [string][] } | null)?.key_auths || [];
      auths.push({ role, keys: ka.map((k) => k[0]) });
    }
    if (op.memo_key) auths.push({ role: "memo", keys: [String(op.memo_key)] });
    for (const a of auths) {
      for (const k of a.keys) {
        if (raw33Of(k) === TARGET_RAW) {
          hits++;
          console.log(`HIT #${idx} ${ev.timestamp} op=${ev.op[0]} role=${a.role} pub=${k}`);
        }
      }
    }
  }
}
console.log(hits === 0 ? "NO HITS: the key never appeared in any authority update on this rail (within scanned windows)" : `total hits: ${hits}`);
