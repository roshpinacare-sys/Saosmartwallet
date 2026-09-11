/**
 * r35 — הוכחה חיה: חוק-הראש ל-governance.scan (הרביעי במשפחת עיוורון-החיתוך)
 *
 * הטענה: השורה-הניתנת-לאימות (summary + meaning) שורדת בתוך RESULT_CLAMP=1400
 * התווים הראשונים של התוצאה המסודרת — בדיוק מה שהבודק העצמאי רואה.
 * לפני-התיקון: rails (12 חשבונות × 30 הצבעות × 3 רשתות) חתכו את השורה
 * והבודק פסק "governance.scan חלקי" — רעש-חסימות שווא.
 */
import { MODULES } from "../src/lib/gate/harness/modules";

const RESULT_CLAMP = 1400; // must mirror src/lib/gate/harness/loop.ts

async function main() {
  const mod = MODULES.find((m) => m.id === "governance.scan");
  if (!mod) {
    console.log("FAIL: governance.scan module not found");
    process.exit(1);
  }
  const t0 = Date.now();
  const result = await mod.exec({}, { runId: "r35-proof", agentName: "proof" });
  const ms = Date.now() - t0;
  const serialized = JSON.stringify(result);
  const head = serialized.slice(0, RESULT_CLAMP);
  const summaryInHead = typeof (result as { summary?: string }).summary === "string" && head.includes("מצביעים");
  const meaningInHead = head.includes("טביעת-רגל ממשלתית");
  const clamped = serialized.length > RESULT_CLAMP;
  console.log(`governance.scan: ${ms}ms · serialized ${serialized.length} chars · clamped-by-harness: ${clamped}`);
  console.log(`summary-בתוך-1400-הראשונים: ${summaryInHead ? "כן ✓" : "לא ✗"} · meaning-בתוך-הראש: ${meaningInHead ? "כן ✓" : "לא ✗"}`);
  console.log(`head-1400: ${head.slice(0, 220)}…`);
  if (summaryInHead && meaningInHead) console.log("VERDICT: ✓ חוק-הראש מקוים — הבודק רואה את הראייה");
  else {
    console.log("VERDICT: ✗ החוק נשבר");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("proof failed honestly:", (e as Error).message.slice(0, 200));
  process.exit(1);
});
