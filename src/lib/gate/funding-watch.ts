/**
 * FUNDING WATCH (r30) — עיניים על כתובת-המימון של הפלטפורמה.
 *
 * ספר-האוצר v65 של saos-sovereign-platform (נחת על הדלת שלנו) פרסם את
 * כתובת-המימון הריבונית שלהם — אותה כתובת על כל רשתות-EVM — שהפקדת גז
 * אליה פותחת 7 דלתות-פריסה (BSC/Polygon/Arbitrum/Optimism/Base/Avalanche/Gnosis).
 *
 * הגבול-ריבוני: הכתובת הזאת שייכת למישור-הפלטפורמה (אפס-חפיפה עם ארנקי-הכספת
 * שלנו — נמדד r23/r25). הכספת אינה מחזיקה אותה ואינה מזיזה אליה דבר — היא
 * רק צופה: צנזורה read-only על 8 רשתות דרך צמתים-ציבוריים, כך שהרגע שבו
 * כסף נוחת — המערכת רואה אותו בתוך יום. קריאה-בלבד, אפס-מפתחות, אפס-סודות.
 */

export const FUNDING_ADDRESS = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";

const NETWORKS: { net: string; rpc: string; sym: string }[] = [
  { net: "ethereum", rpc: "https://ethereum-rpc.publicnode.com", sym: "ETH" },
  { net: "bsc", rpc: "https://bsc-dataseed.binance.org", sym: "BNB" },
  { net: "polygon", rpc: "https://polygon-bor-rpc.publicnode.com", sym: "POL" },
  { net: "arbitrum", rpc: "https://arb1.arbitrum.io/rpc", sym: "ETH" },
  { net: "optimism", rpc: "https://mainnet.optimism.io", sym: "ETH" },
  { net: "base", rpc: "https://mainnet.base.org", sym: "ETH" },
  { net: "avalanche", rpc: "https://api.avax.network/ext/bc/C/rpc", sym: "AVAX" },
  { net: "gnosis", rpc: "https://rpc.gnosischain.com", sym: "xDAI" },
];

function weiToUnits(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 8);
  return `${whole}.${frac}`;
}

export interface FundingRow {
  net: string;
  sym: string;
  ok: boolean;
  block: number | null;
  balance: string;
  nonZero: boolean;
  error: string | null;
}

async function probe(n: { net: string; rpc: string; sym: string }, address: string): Promise<FundingRow> {
  const base: FundingRow = { net: n.net, sym: n.sym, ok: false, block: null, balance: "0.00000000", nonZero: false, error: null };
  try {
    const res = await fetch(n.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
      signal: AbortSignal.timeout(9000),
    });
    const j: any = await res.json();
    if (!j || j.result === undefined) throw new Error(typeof j?.error?.message === "string" ? j.error.message : "bad-response");
    const wei = BigInt(j.result);
    return { ...base, ok: true, balance: weiToUnits(wei), nonZero: wei > 0n };
  } catch (e: any) {
    return { ...base, error: String(e?.message || e).slice(0, 120) };
  }
}

/** צנזורה-חיה של כתובת-המימון על 8 רשתות-EVM. כשל-פר-רשת כן ולא מפיל את האחרות. */
export async function fundingCensus(addressOverride?: string): Promise<{
  address: string;
  measuredAt: string;
  networks: FundingRow[];
  reachable: number;
  total: number;
  funded: number;
  meaning: string;
}> {
  const address = (addressOverride || FUNDING_ADDRESS).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("funding-watch: כתובת לא תקינה");
  const rows = await Promise.all(NETWORKS.map((n) => probe(n, address)));
  const reachable = rows.filter((r) => r.ok).length;
  const funded = rows.filter((r) => r.ok && r.nonZero).length;
  const empty = rows.filter((r) => r.ok && !r.nonZero).map((r) => r.net);
  const live = rows.filter((r) => r.ok && r.nonZero).map((r) => `${r.net}=${r.balance} ${r.sym}`);
  return {
    address,
    measuredAt: new Date().toISOString(),
    networks: rows,
    reachable,
    total: rows.length,
    funded,
    meaning:
      `כתובת-המימון של מישור-הפלטפורמה (לא שלנו — צפייה-בלבד): ${reachable}/${rows.length} רשתות נמדדו · ` +
      (live.length ? `יתרות-חיות: ${live.join(" · ")}` : "כל-הרשתות-שנמדדו ריקות") +
      (empty.length ? ` · ריקות: ${empty.join(",")}` : "") +
      (reachable < rows.length ? ` · ${rows.length - reachable} רשתות-לא-נענו (כשל-כן)` : ""),
  };
}
