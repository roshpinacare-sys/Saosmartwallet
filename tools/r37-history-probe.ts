/** r37 — raw probe: owner history + account_update history for headcorner. */
const node = process.argv[2] || "https://api.steemit.com";
const call = async (method: string, params: unknown[]) => {
  const r = await fetch(node, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(20000),
  });
  return r.json();
};
const oh = await call("condenser_api.get_owner_history", ["headcorner"]);
console.log("owner history raw:", JSON.stringify(oh.result ?? oh.error).slice(0, 600));
const ah = await call("condenser_api.get_account_history", ["headcorner", -1, 10000, { filter: ["account_update_operation"] }]);
const items: Array<[number, { op: [string, Record<string, unknown>] }]> = ah.result || [];
console.log("account_update ops:", items.length);
for (const [idx, ev] of items.slice(-8)) {
  const op = ev.op?.[1] || {};
  const ownerAuths = (op.owner as { key_auths?: [string][] } | null)?.key_auths || [];
  const activeAuths = (op.active as { key_auths?: [string][] } | null)?.key_auths || [];
  const postingAuths = (op.posting as { key_auths?: [string][] } | null)?.key_auths || [];
  const stamp = op[0];
  console.log(`#${idx} block-time=${stamp}`);
  console.log(`   owner:   ${JSON.stringify(ownerAuths)}`);
  console.log(`   active:  ${JSON.stringify(activeAuths)}`);
  console.log(`   posting: ${JSON.stringify(postingAuths)}`);
  console.log(`   memo:    ${op.memo_key ?? ""}`);
}
export {};
