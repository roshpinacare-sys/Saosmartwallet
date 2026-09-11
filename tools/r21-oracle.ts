/**
 * r21 — WIRE ORACLE for the CONVERSION PLANE.
 * ══════════════════════════════════════════════════════════════════════
 * Before any convert/limit-order tx can ever be broadcast, our serializer
 * must agree BYTE-FOR-BYTE with the node's own serializer
 * (condenser_api.get_transaction_hex) — the same discipline as r16
 * (account_update) and r20 (blurt op numbering). Proven here, live:
 *
 *   1. steem `convert`        — op id 8, body owner‖amount‖requestid
 *   2. steem `limit_order_create` — regression guard (M1 oracle still holds)
 *   3. hive  `convert`        — same legacy numbering on hive, HBD asset
 *   4. hive  `limit_order_create` — HIVE/HBD assets through the hive adapter
 *
 * Method: build the tx through the rail adapter (fresh ref-block from THAT
 * rail's node), then ask the node to serialize the SAME logical tx. Our
 * serializedHex must equal the node's hex — anything else is a hard FAIL
 * and the plane stays closed (fail closed).
 */
import { buildSteemOrderTx, buildConvertTx } from "../src/lib/steem-order";
import { steemAdapter } from "../src/lib/steem-server";
import { hiveAdapter } from "../src/lib/social/rails-server";
import { serializeTransaction } from "../packages/chains/steem/src/transaction";
import type { SteemTransaction } from "../packages/chains/steem/src/transaction";

const STEEM_NODE = "https://api.steemit.com";
const HIVE_NODE = "https://api.hive.blog";

async function nodeSerialize(node: string, tx: SteemTransaction): Promise<string> {
  const assetStr = (v: unknown): string | null => {
    if (!v || typeof v !== "object") return null;
    const a = v as { amount?: unknown; precision?: unknown; symbol?: unknown };
    if (typeof a.amount !== "bigint" || typeof a.precision !== "number" || typeof a.symbol !== "string") return null;
    const neg = a.amount < 0n;
    const digits = (neg ? -a.amount : a.amount).toString().padStart(a.precision + 1, "0");
    return `${neg ? "-" : ""}${digits.slice(0, digits.length - a.precision)}.${digits.slice(digits.length - a.precision)} ${a.symbol}`;
  };
  const wire = {
    ref_block_num: tx.refBlockNum,
    ref_block_prefix: tx.refBlockPrefix,
    expiration: new Date(tx.expiration * 1000).toISOString().slice(0, 19),
    operations: tx.operations.map((o) => {
      const b = o.body as unknown as Record<string, unknown>;
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(b)) {
        // fc legacy JSON: time_point_sec fields want ISO strings (the tx-level
        // expiration AND the op-body `expiration` of limit_order_create).
        if (k === "expiration" && typeof v === "number") {
          flat[k] = new Date(v * 1000).toISOString().slice(0, 19);
          continue;
        }
        const asAsset = assetStr(v);
        flat[k] = asAsset ?? v;
      }
      return [o.name, flat];
    }),
    extensions: [],
  };
  const res = await fetch(node, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_transaction_hex", params: [wire] }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { result?: string; error?: { message?: string } };
  if (j.error) throw new Error(`node refused: ${j.error.message}`);
  return (j.result ?? "").replace(/^0x/, "");
}

function oursHex(tx: SteemTransaction): string {
  // serializeTransaction = digest bytes (ref+ops+extensions). get_transaction_hex
  // serializes a SIGNED transaction, which appends varint(sigCount) — for the
  // unsigned comparison that is one extra 0x00. Append the empty sig vector.
  const body = Buffer.from(serializeTransaction(tx));
  const withEmptySigs = Buffer.concat([body, Buffer.from([0])]);
  return withEmptySigs.toString("hex");
}

async function check(label: string, node: string, tx: SteemTransaction): Promise<boolean> {
  const ours = oursHex(tx);
  try {
    const theirs = await nodeSerialize(node, tx);
    const okp = ours === theirs;
    console.log(`${okp ? "✅" : "❌"} ${label}\n   ours:   ${ours}\n   node:   ${theirs}`);
    return okp;
  } catch (e) {
    console.log(`⚠️  ${label} — node serialize failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

async function main() {
  console.log("=== r21 CONVERSION-PLANE WIRE ORACLE ===\n");
  let pass = 0, total = 0;

  // 1. steem convert
  total++;
  {
    const b = await buildConvertTx({ account: "headcorner", amount: "10.000", requestid: 424242 });
    if (await check("steem convert 10.000 SBD (requestid 424242)", STEEM_NODE, b.steemTx)) pass++;
  }

  // 2. steem limit_order_create (regression)
  total++;
  {
    const b = await buildSteemOrderTx({
      account: "headcorner", side: "sell", amount: "1.000", price: "0.140000",
      fillOrKill: false, ttlSeconds: 3600, orderid: 1727172727, orderExpiration: Math.floor(Date.now() / 1000) + 3600,
    });
    if (await check("steem limit_order_create sell 1.000 STEEM @ 0.14 SBD", STEEM_NODE, b.steemTx)) pass++;
  }

  // 3. hive convert (HBD)
  total++;
  {
    const b = await buildConvertTx({
      account: "headcorner", amount: "5.000", requestid: 424243,
      assets: { liquid: "STEEM", debt: "SBD" }, adapterOverride: hiveAdapter(),
    });
    if (await check("hive convert 5.000 HBD (requestid 424243)", HIVE_NODE, b.steemTx)) pass++;
  }

  // 4. hive limit_order_create (HIVE/HBD)
  total++;
  {
    const b = await buildSteemOrderTx({
      account: "headcorner", side: "sell", amount: "2.000", price: "0.300000",
      fillOrKill: false, ttlSeconds: 3600, orderid: 1727172728, orderExpiration: Math.floor(Date.now() / 1000) + 3600,
      assets: { liquid: "STEEM", debt: "SBD" }, adapterOverride: hiveAdapter(),
    });
    if (await check("hive limit_order_create sell 2.000 HIVE @ 0.30 HBD", HIVE_NODE, b.steemTx)) pass++;
  }

  console.log(`\n=== ${pass}/${total} PROVEN against the nodes' own serializers ===`);
  if (pass !== total) {
    console.log("FAIL-CLOSED: the conversion plane stays closed until every wire agrees.");
    process.exit(1);
  }
  console.log("Rail health:", JSON.stringify(await steemAdapter().health()).slice(0, 80), JSON.stringify(await hiveAdapter().health()).slice(0, 80));
}

main().catch((e) => { console.error("oracle crashed:", e); process.exit(1); });
