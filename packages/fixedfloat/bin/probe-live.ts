/**
 * Saosmartwallet packages/fixedfloat — guarded LIVE probe (wave G76-b)
 * ======================================================================
 * The ONLY place this package touches the real network. Hard-gated:
 *
 *     FIXEDFLOAT_LIVE_PROBE=1 FIXEDFLOAT_VAULT=<vault.json> bun run bin/probe-live.ts
 *
 * Read-only laws:
 *   • Calls ONLY ccies (and optionally price) — never create, never emergency.
 *   • Prints ONLY public response data (counts, sample currency codes, price
 *     numbers) and the fingerprint of nothing — key material is never printed,
 *     never logged, never echoed, in any failure mode.
 *   • Exit code 0 + "PROBE OK" when the API accepts our signature (code=0);
 *     any FF_E_* error surfaces honestly with its code (e.g. FF_E_API 401) and
 *     exits 1 — an honest verdict, no retry theater.
 */

import { loadFixedFloatKeys } from "../src/vault-loader";
import { FixedFloatClient } from "../src/client";
import { FixedFloatError } from "../src/errors";

async function main(): Promise<number> {
  if (process.env.FIXEDFLOAT_LIVE_PROBE !== "1") {
    console.error("PROBE REFUSED: set FIXEDFLOAT_LIVE_PROBE=1 to run the live probe (read-only)");
    return 2;
  }
  const vaultPath = process.env.FIXEDFLOAT_VAULT;
  if (!vaultPath) {
    console.error("PROBE REFUSED: set FIXEDFLOAT_VAULT to the custody vault path");
    return 2;
  }
  const keys = loadFixedFloatKeys({ path: vaultPath });
  const client = new FixedFloatClient({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    timeoutMs: 20_000,
    maxRetries: 1,
  });

  const t0 = Date.now();
  const ccies = (await client.currencies()) as Array<{ code?: string; coin?: string; network?: string; recv?: boolean; send?: boolean }>;
  const dt = Date.now() - t0;
  if (!Array.isArray(ccies)) {
    console.error("PROBE FAIL: ccies response is not an array (unexpected shape)");
    return 1;
  }
  const samples = ccies.slice(0, 5).map((c) => `${c.code ?? "?"}/${c.network ?? "?"}`);
  console.log(`PROBE OK: ccies accepted (code=0) — ${ccies.length} currencies in ${dt}ms; sample: ${samples.join(", ")}`);

  const fromCcy = process.env.FIXEDFLOAT_PROBE_FROM ?? "BTC";
  const toCcy = process.env.FIXEDFLOAT_PROBE_TO ?? "ETH";
  try {
    const price = (await client.price({ fromCcy, toCcy, amount: 0.001, direction: "from", type: "float" })) as {
      from?: { amount?: number; code?: string };
      to?: { amount?: number; code?: string };
      errors?: unknown[];
    };
    console.log(
      `PROBE OK: price accepted — ${fromCcy}->${toCcy} float, in=${price.from?.amount} out=${price.to?.amount}, errors=${JSON.stringify(price.errors ?? [])}`,
    );
  } catch (err) {
    if (err instanceof FixedFloatError && err.code === "FF_E_API") {
      console.log(`PROBE NOTE: price probe refused by API (${err.message}) — signature itself was already proven by ccies`);
    } else {
      throw err;
    }
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof FixedFloatError) {
      console.error(`PROBE FAIL (honest): ${err.code}: ${err.message}`);
    } else {
      console.error(`PROBE FAIL (honest): ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  });
