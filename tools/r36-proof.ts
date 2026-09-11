/**
 * r36 — live proof of crash-burst healing (ריפוי-פרץ-הקריסות).
 *
 * The heart ITSELF executes the test — pure state-machine, zero brain calls:
 *   A. fake crashed run (running, expired lease, attempt=1) → the reaper must
 *      re-queue it WITH retryNotBefore ≈ +90s (the warm-gap).
 *   B. while inside the warm-gap → dispatch must leave it queued (invisible).
 *   C. fake exhausted run (queued, attempt=2/2, retryNotBefore future) → the
 *      exhaustion verdict must WAIT; once the gap is in the past → the verdict
 *      releases (failed) with NO third claim (it failed while still queued).
 * Cleanup deletes both rows and confesses on the bridge.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const MARK = "r36-proof";
async function sleep(ms: number) { await new Promise((r) => setTimeout(r, ms)); }
async function poll(desc: string, check: () => Promise<boolean>, tries = 8): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await check()) { console.log(`PASS ${desc}`); return true; }
    await sleep(5000);
  }
  console.log(`FAIL ${desc}`);
  return false;
}

async function main() {
  const now = Date.now();
  // ── A+B: crashed run → warm-gap → dispatch invisible ──
  const a = await db.gateRun.create({
    data: {
      agentName: "anchor-agent", goal: `${MARK} A — שורת-מבחן, נמחקת-בסוף`,
      doneMeans: JSON.stringify(["placeholder"]), modules: "[]", brain: "zai:glm", checker: "nvidia:probe",
      budget: 1, status: "running", origin: "manual", attempt: 1,
      leaseOwner: "w-dead", leaseExpiresAt: new Date(now - 60_000), heartbeatAt: new Date(now - 300_000),
      error: "simulated crash mid-storm",
    },
  });
  const aGotBackoff = await poll("A1 crashed run re-queued WITH warm-gap", async () => {
    const r = await db.gateRun.findUnique({ where: { id: a.id } });
    return r?.status === "queued" && !!r.retryNotBefore && r.retryNotBefore.getTime() > Date.now() + 60_000;
  });
  await sleep(22_000); // one more beat — dispatch had its chance
  const aInvisible = (await db.gateRun.findUnique({ where: { id: a.id } }))?.status === "queued";
  console.log(aInvisible ? "PASS B  dispatch left the in-backoff run queued (invisible)" : "FAIL B  run was claimed despite backoff!");

  // ── C: exhaustion verdict waits for the gap, then releases without a third claim ──
  const b = await db.gateRun.create({
    data: {
      agentName: "anchor-agent", goal: `${MARK} B — שורת-מבחן, נמחקת-בסוף`,
      doneMeans: JSON.stringify(["placeholder"]), modules: "[]", brain: "zai:glm", checker: "nvidia:probe",
      budget: 1, status: "queued", origin: "manual", attempt: 2, maxAttempts: 2,
      retryNotBefore: new Date(now + 180_000), error: "simulated double crash",
    },
  });
  await sleep(22_000);
  const bDelayed = (await db.gateRun.findUnique({ where: { id: b.id } }))?.status === "queued";
  console.log(bDelayed ? "PASS C1 exhaustion verdict WAITED for the warm-gap" : "FAIL C1 verdict fired during backoff!");
  await db.gateRun.update({ where: { id: b.id }, data: { retryNotBefore: new Date(now - 1_000) } });
  const bReleased = await poll("C2 verdict released after gap (failed, never claimed)", async () => {
    const r = await db.gateRun.findUnique({ where: { id: b.id } });
    return r?.status === "failed";
  });
  const bNeverRan = (await db.gateRun.findUnique({ where: { id: b.id } }))?.attempt === 2;
  console.log(bNeverRan ? "PASS C3 no third claim (attempt stayed 2)" : "FAIL C3 a third claim happened!");

  // ── cleanup + confession ──
  await db.gateRun.delete({ where: { id: a.id } });
  await db.gateRun.delete({ where: { id: b.id } }).catch(() => {});
  const allPass = aGotBackoff && aInvisible && bDelayed && bReleased && bNeverRan;
  await db.gateMessage.create({
    data: { channel: "command", fromKind: "system", fromName: "harness", body: `🧪 ${MARK}: מבחן-ריפוי-הפרץ הסתיים — ${allPass ? "כל-השלבים עברו (הפוגה-נרשמה · דיספאץ' מכבד · פסיקה-ממתינה · שחרור-בלי-ניסיון-שלישי)" : "יש כישלונות — ראו יומן"}. שורות-המבחן נמחקו.`, meta: "{}" },
  }).catch(() => {});
  console.log(allPass ? "ALL-PASS" : "HAS-FAILURES");
  await db.$disconnect();
}
main();
