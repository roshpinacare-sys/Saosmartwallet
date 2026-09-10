/**
 * ROAST r6 — exposure-gate NEGATIVE live proof (in-process, zero chain writes).
 * r2 added the code-level rules; r6 proves them against the REAL functions —
 * Hebrew (title/body/tags), the codename (body AND tag), solicitation, and a
 * clean-English control that must PASS. Fail-closed or it didn't happen.
 */
import { scanExposure, assertPublishable } from "../src/lib/gate/harness/exposure";

interface Case {
  name: string;
  title: string;
  body: string;
  tags?: string[];
  expect: "block" | "pass";
}

const CASES: Case[] = [
  { name: "hebrew-body", title: "Weekly Network Update", body: "שלום לכל הקוראים, עדכון שבועי על הרשת שלנו.", expect: "block" },
  { name: "hebrew-title", title: "עדכון שבועי", body: "Weekly update on the network progress and plans.", expect: "block" },
  { name: "hebrew-tag", title: "Weekly Network Update", body: "A clean English post body about the network.", tags: ["blockchain", "רשת"], expect: "block" },
  { name: "codename-tag", title: "Weekly Network Update", body: "A clean English post body about the network.", tags: ["blockchain", "saos"], expect: "block" },
  { name: "codename-body", title: "Weekly Network Update", body: "The SAOS fleet continues building on the network.", expect: "block" },
  { name: "solicitation", title: "Join Our Wallet Program", body: "Send STEEM to our wallet address with a memo to join the program today.", expect: "block" },
  { name: "wif-key", title: "Dev Note", body: "here is a key 5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF for testing", expect: "block" },
  { name: "clean-english", title: "Weekly Network Update", body: "The fleet published its weekly English digest and cleaned the feed.", tags: ["blockchain", "community", "update"], expect: "pass" },
];

async function main() {
  let pass = 0;
  let fail = 0;
  for (const c of CASES) {
    let outcome: string;
    let kinds: string[] = [];
    try {
      const report = assertPublishable(c.title, c.body, c.tags);
      outcome = "PUBLISHED";
      kinds = report.findings.map((f) => f.kind);
    } catch (e) {
      outcome = "BLOCKED";
      const msg = e instanceof Error ? e.message : String(e);
      kinds = [msg.slice(0, 90)];
    }
    const alsoScan = scanExposure(c.title, c.body, (c.tags || []).join(" "));
    const okOrNot = (c.expect === "block") === (outcome === "BLOCKED");
    if (okOrNot) pass++;
    else fail++;
    console.log(`${okOrNot ? "✓" : "✗ MISMATCH"} ${c.name}: expected=${c.expect} → ${outcome} · scan.kinds=[${alsoScan.findings.map((f) => f.kind).join(",")}] · ${kinds[0] ?? ""}`);
  }
  console.log(`\nnegative-gate proof: ${pass}/${CASES.length} hold`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
