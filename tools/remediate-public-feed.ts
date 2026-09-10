/**
 * ROAST round 3 — live public-feed remediation through the REAL rail primitives.
 *
 * Round 2 claimed "zero-Hebrew across all 12 recent posts" — true for the
 * window it scanned, false for the feed: the FULL-history scan (245 steem +
 * 229 hive posts) found 24 live doctrine violations, including the FULL
 * HEBREW SAOS-1 spec still standing on HIVE that round 2 never touched.
 * This script fixes every EDITABLE violation:
 *   1. re-lights the master honestly (server token → key-seal ladder);
 *   2. drives editPostFromAgent with operatorOverride (the daily cap bounds
 *      AGENT autonomy; operator remediation is a duty — override is loud,
 *      refused for any non-operator name, and still passes the exposure
 *      gate + chain key proof);
 *   3. replaces Hebrew-only posts with honest ENGLISH archive notices
 *      (originals stay readable in each post's on-chain edit history);
 *   4. surgically patches posts whose only violation is an embedded Hebrew
 *      image filename (content otherwise kept intact);
 *   5. prints txId per post — every claim verifiable on a public node.
 * Zero mock: real vault key, real signature, real broadcast, real chain.
 */
import { db } from "../src/lib/db";
import { sha256hex, openWith, deriveKek, setMaster } from "../src/lib/gate/crypto";
import { loadKeySeals } from "../src/lib/gate/key-seal";
import fs from "fs/promises";
import { editPostFromAgent } from "../src/lib/gate/harness/social";
import { railGetContent } from "../src/lib/social/rails-server";

const TOKEN_FILE = "/tmp/gate_token";
const RUN_ID = `roast-r3-${Date.now()}`;
const COMMANDER = "headcorner";

const ARCHIVE_NOTICE =
  "*Feed language notice:* This post was originally published in Hebrew. This account's public feed is maintained in " +
  "English only, so the visible text has been replaced by this notice. The original Hebrew text remains available in " +
  "the post's on-chain edit history.";

// chain-polite pacing (live-learned 2026-09-10): STEEM_MIN_COMMENT_EDIT_INTERVAL
// allows only ONE comment edit per block — consecutive broadcasts collide on
// the same block and die on the assert. ~2 blocks of pause between edits.
const EDIT_PAUSE_MS = 7_000;

type EditSpec = { rail: "steem" | "hive"; permlink: string; title: string; body: string | "PATCH_HEBREW_ALT"; tags?: string[] };

const EDITS: EditSpec[] = [
  // ── fleet-era leftovers ────────────────────────────────────────────────
  { rail: "steem", permlink: "5vmvfj", title: "Archived Post From 2023", body: ARCHIVE_NOTICE },
  // ── operator-era Hebrew posts (2018) — steem originals ─────────────────
  { rail: "steem", permlink: "2enxwg", title: "Archived Post From 2018", body: ARCHIVE_NOTICE },
  { rail: "steem", permlink: "7ssdza", title: "Archived Post From 2018", body: ARCHIVE_NOTICE },
  { rail: "steem", permlink: "3", title: "Archived Post From 2018", body: ARCHIVE_NOTICE },
  { rail: "steem", permlink: "2sxnbd", title: "Archived Post From 2018", body: ARCHIVE_NOTICE },
  { rail: "steem", permlink: "bandwidth", title: "Archived Post From 2018", body: ARCHIVE_NOTICE },
  { rail: "steem", permlink: "2gqskj", title: "Archived Post From 2018", body: ARCHIVE_NOTICE },
  // English title, Hebrew body — title kept, body replaced with the honest notice
  {
    rail: "steem",
    permlink: "yizkor-memorial-day-for-israel-s-fallen-soldiers",
    title: "Yizkor: Memorial Day for Israel's Fallen Soldiers",
    body: ARCHIVE_NOTICE,
  },
  // Mixed post: English content with one Hebrew image filename — surgical patch
  { rail: "steem", permlink: "celebrating-the-jewish-new-year", title: "Celebrating the Jewish New Year!", body: "PATCH_HEBREW_ALT" },
  // ── the round-2 miss: FULL Hebrew SAOS-1 spec still standing on HIVE ───
  // explicit clean tags — the ORIGINAL tags carry the codename and would be
  // re-asserted by the edit's preserve-tags default (the exposure gate rightly
  // blocked that first attempt; the fix is cleaner tags, not a weaker gate).
  { rail: "hive", permlink: "saos-1-protocol-spec-20260903", title: "Feed Cleanup Notice", body: ARCHIVE_NOTICE, tags: ["hive", "blog", "notice"] },
];

const ONLY = process.argv.slice(2);
const TARGETS = ONLY.length ? EDITS.filter((e) => ONLY.includes(e.permlink)) : EDITS;

async function relightMasterFromTokenFile(): Promise<void> {
  const token = (await fs.readFile(TOKEN_FILE, "utf8").catch(() => "")).trim();
  if (token) {
    const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
    if (row && !row.revoked && row.expiresAt.getTime() > Date.now() && row.encMaster && row.sealSalt) {
      const s = JSON.parse(row.encMaster) as { ct: string; iv: string; tag: string };
      const masterHex = openWith(deriveKek(token, row.sealSalt), s);
      const master = Buffer.from(masterHex, "hex");
      if (master.length === 32) {
        setMaster(master);
        console.log("[vault] master re-lit from server token (honest ladder, no fabrication)");
        return;
      }
    }
  }
  const keyFile = (await fs.readFile("upload/הדקור.txt", "utf8").catch(() => "")).split("\n");
  const postingLine = keyFile.map((l) => l.trim()).find((l) => /^POS/i.test(l)) ?? "";
  const key = postingLine.replace(/^POS[TING]*\s*[=:]\s*/i, "").trim();
  if (!key) throw new Error("no posting key line in operator key file — cannot re-light honestly");
  const seals = await loadKeySeals();
  for (const seal of seals) {
    try {
      const masterHex = openWith(deriveKek(key, seal.kdfSalt), { ct: seal.encMaster, iv: seal.sealIv, tag: seal.sealTag });
      const master = Buffer.from(masterHex, "hex");
      if (master.length === 32) {
        setMaster(master);
        console.log(`[vault] master re-lit via key-seal (${seal.chain}/${seal.account}/${seal.role}) — GCM verified`);
        return;
      }
    } catch {
      /* wrong seal for this key — GCM refused; honest, keep scanning */
    }
  }
  throw new Error("key-seal ladder failed — no seal opened with the operator posting key");
}

/** Surgical patch: only the Hebrew image alt goes; English content is kept. */
async function patchHebrewAlt(rail: "steem" | "hive", permlink: string): Promise<string> {
  const post = await railGetContent(rail, COMMANDER, permlink);
  if (!post) throw new Error("post vanished mid-remediation");
  const patched = post.body.replace(/!\[[^\]]*[\u0590-\u05FF][^\]]*\]/g, "![image]");
  if (/[\u0590-\u05FF]/.test(patched)) throw new Error("surgical patch insufficient — Hebrew remains outside image alts");
  return patched;
}

async function main(): Promise<void> {
  await relightMasterFromTokenFile();
  let done = 0;
  let failed = 0;
  for (const e of TARGETS) {
    if (done + failed > 0) {
      console.log(`[pace] waiting ${EDIT_PAUSE_MS}ms — one comment edit per block (chain etiquette)`);
      await new Promise((r) => setTimeout(r, EDIT_PAUSE_MS));
    }
    try {
      const body = e.body === "PATCH_HEBREW_ALT" ? await patchHebrewAlt(e.rail, e.permlink) : e.body;
      const r = await editPostFromAgent({
        agentName: "operator",
        runId: RUN_ID,
        rail: e.rail,
        permlink: e.permlink,
        title: e.title,
        body,
        tags: e.tags,
        operatorOverride: true,
      });
      done++;
      console.log(`[edit-ok] ${e.rail}/${e.permlink} tx=${r.txId} block=${r.blockNum ?? "?"} delta=${r.changedChars} chars`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[edit-fail] ${e.rail}/${e.permlink} — ${msg.slice(0, 220)}`);
    }
  }
  console.log(`[summary] edits ok=${done} failed=${failed} runId=${RUN_ID}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("[fatal]", e instanceof Error ? e.message : e);
  process.exit(1);
});
