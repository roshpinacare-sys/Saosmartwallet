/**
 * ROAST round 3 — FULL history doctrine scan (READ-ONLY).
 * Paginates the ENTIRE blog feed of @headcorner on steem AND hive and runs
 * the doctrine scan on every post's FULL body — quantifying the real scale
 * of language/codename violations, not just the recent window.
 */
const STEEM_NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://api.steemitdev.com"];
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"];

async function rpc<T>(nodes: string[], method: string, params: unknown, timeoutMs = 12_000): Promise<T> {
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
interface Vio {
  permlink: string;
  created: string;
  kind: string;
  detail: string;
  chars: number;
  payout: string;
}

async function scanRail(rail: "steem" | "hive", nodes: string[], account: string): Promise<Vio[]> {
  const violations: Vio[] = [];
  let scanned = 0;
  let resteemed = 0;
  let startAuthor: string | undefined;
  let startPermlink: string | undefined;
  for (let page = 0; page < 60; page++) {
    const query: Record<string, unknown> = { tag: account, limit: 20 };
    if (startAuthor && startPermlink) {
      query.start_author = startAuthor;
      query.start_permlink = startPermlink;
    }
    const rows = await rpc<Array<Record<string, string>>>(nodes, "condenser_api.get_discussions_by_blog", [query]);
    const batch = startAuthor ? rows.slice(1) : rows;
    if (!batch.length) break;
    for (const p of batch) {
      // roast r3 self-correction: get_discussions_by_blog mixes REBLOGS into the
      // feed — posts AUTHORED BY OTHERS that the account resteemed (live proof:
      // get_content("headcorner", "3") returns an empty struct; the content
      // belongs to its original author). Doctrine violations are counted for
      // OUR OWN words only; resteems are 2018 curation choices that the chain
      // offers no un-reblog for — disclosed, not silently counted.
      if (String(p.author || "").toLowerCase() !== account) {
        resteemed++;
        continue;
      }
      scanned++;
      const body = String(p.body || "");
      const title = String(p.title || "");
      let tags: string[] = [];
      try {
        const j = JSON.parse(p.json_metadata || "{}") as { tags?: unknown };
        if (Array.isArray(j.tags)) tags = (j.tags as unknown[]).map(String);
      } catch {
        /* unparseable metadata — note it */
      }
      const hTitle = HEBREW.test(title);
      const hBody = HEBREW.test(body);
      const hTags = tags.some((t) => HEBREW.test(t));
      const saos = /saos/i.test(`${title} ${body} ${tags.join(",")} ${p.category || ""}`);
      if (hTitle || hBody || hTags || saos) {
        const firstHeb = (body.match(new RegExp(".{0,30}[\u0590-\u05FF]+.{0,30}", "g")) || [""])[0].replace(/\s+/g, " ");
        violations.push({
          permlink: p.permlink,
          created: String(p.created || ""),
          kind: [hTitle && "title-HEB", hBody && "body-HEB", hTags && "tag-HEB", saos && "codename-saos"].filter(Boolean).join("+"),
          detail: `title="${title.slice(0, 50)}" body-first="${firstHeb.slice(0, 60)}"`,
          chars: body.length,
          payout: String(p.pending_payout_value || p.total_payout_value || "0"),
        });
      }
    }
    const last = rows[rows.length - 1];
    startAuthor = String(last.author);
    startPermlink = String(last.permlink);
    if (rows.length < 20) break;
  }
  console.log(`\n[${rail}] @${account}: scanned ${scanned} authored posts (resteems skipped: ${resteemed}) · violations: ${violations.length}`);
  for (const v of violations) console.log(`  ❌ ${v.permlink.slice(0, 58)} · ${v.created.slice(0, 10)} · ${v.kind} · ${v.chars}ch · ${v.payout} · ${v.detail.slice(0, 100)}`);
  return violations;
}

async function main(): Promise<void> {
  const steemV = await scanRail("steem", STEEM_NODES, "headcorner");
  const hiveV = await scanRail("hive", HIVE_NODES, "headcorner");
  console.log(`\nTOTAL: steem ${steemV.length} + hive ${hiveV.length} = ${steemV.length + hiveV.length} doctrine-violating posts live on the public feed`);
}

main().catch((e) => {
  console.error("scan failed:", e);
  process.exitCode = 1;
});
