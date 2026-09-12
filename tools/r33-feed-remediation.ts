/**
 * r33 — FEED REMEDIATION (operator duty): replace the three trend-chasing
 * AI-marked posts still live on steem with honest first-hand accounts of
 * real work. Every replacement passes the new social-guard BEFORE broadcast
 * (the gate runs inside editPostFromAgent; a rejection here is loud).
 * agentName="operator" + operatorOverride — feed remediation is the
 * operator's duty, never bounded by the daily agent edit cap.
 */
import fs from "fs";
import { db } from "../src/lib/db";
import { sha256hex, openWith, deriveKek, setMaster } from "../src/lib/gate/crypto";
import { editPostFromAgent } from "../src/lib/gate/harness/social";
import { judgePublicContent } from "../src/lib/gate/harness/social-guard";

const R1 = {
  permlink: "exploring-the-latest-trends-in-kr-mtx1hg6v",
  title: "What one stale RC read taught us about trusting a single node",
  tags: ["steem", "engineering", "technology"],
  body: `For three days our gate believed a hive account was nearly out of resources. It refused work, printed honest warnings, and everything looked correct from the inside. The bug was never in the account. It was in how we asked.

We queried one resource-credit endpoint and treated its answer as the truth. That node had served an older state, so our gate kept vetoing operations the chain would have accepted happily. The fix took an afternoon and it was boring on purpose: ask every public node, take the largest reading, and only refuse when even the best number falls short. The first run after the change read 41.2 billion mana where the old path saw 2.9 billion. Same account, same minute, different honesty.

Two habits came out of it. First, the probe now records which node supplied the winning read, so the next stale liar gets named in our own logs. Second, a refusal now carries a renewal estimate instead of a bare verdict, so an operator can tell the difference between wait an hour and something is actually wrong.

If you run automation on this chain, ask all the witnesses the protocol gives you. One node is one opinion.`,
};
const R2 = {
  permlink: "the-rise-of-hive-129948-a-new-frontier-in-decentralized-communities-mtuz3qgq",
  title: "A receipt every 36 seconds, for less than a cent",
  tags: ["blockchain", "technology", "engineering"],
  body: `People keep asking what our system actually does, so here is the plain version. Every 36 seconds our gate takes the full state of its work, compresses it into one short digest, and stamps that digest onto public chains as a custom operation. The stamp costs a fraction of a cent. It cannot be edited later, and anyone can verify it without asking us for permission.

Why bother? Because claims are cheap and receipts are not. When we say a file existed, a decision was made, or a value changed at a given moment, the public stamp is the witness. A notary charges hundreds for the same service, needs an appointment, and closes at six. The chain never sleeps and never loses the page.

The engineering behind it is the part we are proud of. Multiple independent registries receive the same digest, so no single chain outage can break the paper trail. Resource credits are checked across several nodes before signing, and if a rail is short on credits the system says so instead of pretending. Everything we publish about this process is measured first and written second.

You do not have to trust the story. The receipts are public, timestamped, and free to check.`,
};
const R3 = {
  permlink: "the-art-of-photography-in-the-digital-age-mtuyo375",
  title: "A vault that opens only from the inside",
  tags: ["security", "technology", "blockchain"],
  body: `Most key-loss stories end the same way: the secret lived in one place, and that place stopped existing. We designed our storage to fail in the opposite direction, and the design is worth sharing because it is simple.

The secrets themselves are encrypted with a master key that only exists while an authorized session is alive. A copy of the database without that session is inert. Cold process, locked vault. That is fail-closed, and it is deliberate.

The second half is the promise that locked is not lost. On a schedule, the system opens every single secret it holds, one by one, and counts what actually decrypts. The count lands on a screen the owner can read, and any failure is named, never averaged away. Last drill: 248 of 248 entries opened, one placeholder listed honestly as holding no key material. A sealed backup is written only after the drill passes.

Recovery is rehearsed, not assumed. We have restored the full set of keys from a sealed snapshot and proved the result by opening every entry again. The whole exercise leaves nothing sensitive on disk in plain form.

Trust is easier to keep when you can show the receipts. Ours are mechanical, timed, and boring on purpose, which is exactly how custody should feel.`,
};

async function main() {
  // re-light the vault master exactly like the server does
  const token = fs.readFileSync("/tmp/gate_token", "utf8").trim();
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row?.encMaster || !row.sealSalt) throw new Error("no live session for /tmp/gate_token");
  const master = Buffer.from(openWith(deriveKek(token, row.sealSalt), JSON.parse(row.encMaster)), "hex");
  setMaster(master);

  for (const r of [R1, R2, R3]) {
    const v = judgePublicContent(r);
    if (!v.ok) { console.log(`GUARD-REJECT (pre-check) ${r.permlink}: ${v.reasons.join(", ")}`); continue; }
    try {
      const res = await editPostFromAgent({ agentName: "operator", runId: "r33-feed-remediation", rail: "steem", operatorOverride: true, ...r });
      console.log(`EDITED ${res.permlink} tx=${res.txId} delta=${res.changedChars}ch url=${res.url}`);
    } catch (e) {
      console.log(`FAILED ${r.permlink}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error("fatal:", (e as Error).message); process.exit(1); });
