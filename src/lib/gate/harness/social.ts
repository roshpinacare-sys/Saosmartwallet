/**
 * SOVEREIGN-VOICE — the agents' real VOICE on the network (posting authority).
 *
 * The sovereignty boundary, in Steem's own terms:
 *   · POSTING authority = the agents' hands — content, votes, follows,
 *     reblogs. It can NEVER move funds, change keys or touch governance —
 *     the chain itself forbids it. So these actions run DIRECTLY on agent
 *     decision inside honest rails (daily caps, weight cap, per-run caps),
 *     with a full audit trail (GateAction + bridge message + on-chain
 *     evidence: permlink/txId). This is what "constantly building on the
 *     network" means in code.
 *   · ACTIVE authority = the operator's hands — funds and DEX orders go
 *     through SOVEREIGN-HAND's pending queue and explicit approval. Never
 *     touched here.
 *
 * Rails fail loudly (GateError) so the maker learns the boundary; every
 * broadcast records REAL chain evidence or an honest failure.
 */
import { db } from "@/lib/db";
import { requireMaster, openSecret, GateError } from "@/lib/gate/crypto";
import { steemBroadcastAdapter } from "@/lib/steem-server";
import { buildSteemPostTx, buildSteemVoteTx, buildSteemFollowTx, buildSteemReblogTx, buildSteemClaimTx, type SocialBuild } from "@/lib/steem-social";
import { PrivateKey } from "../../../../packages/crypto/src/index";
import { toSigningKey, COMMANDER_ACCOUNT } from "./orders";
import { renewLease } from "./lease";
import { assertPublishable, scanExposure } from "./exposure";
import {
  hiveBroadcastAdapter,
  railBlogPosts,
  railGetContent,
  railHealth,
  railRpc,
  verifyPostingKeyOnChain,
  type Rail,
  type RailHealth,
  type RailPost,
} from "@/lib/social/rails-server";

export const SOCIAL_RAILS = {
  maxPostsPerDay: 4, // fleet-wide real publications per UTC day
  maxInteractionsPerDay: 12, // votes + follows + reblogs combined per UTC day
  maxEditsPerDay: 8, // fixing exposed/wrong content is a duty, not spam — but bounded
  maxClaimsPerDay: 16, // harvesting what the fleet EARNED — bounded diligence, not greed
  maxVoteWeight: 2000, // ≤ 20% — the fleet votes with conviction, never spam
  maxPostBodyChars: 20000,
  maxTags: 5,
} as const;

export type PublishRail = "steem" | "hive";

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function socialMsg(body: string, meta: Record<string, unknown>): Promise<void> {
  await db.gateMessage
    .create({ data: { channel: "command", fromKind: "system", fromName: "sovereign-voice", body: body.slice(0, 1000), meta: JSON.stringify(meta) } })
    .catch(() => {});
}

/** The vault POSTING key of the commander on a rail — never taken from agent input. */
async function commanderPostingKey(rail: Rail = "steem"): Promise<PrivateKey> {
  requireMaster();
  const entry = await db.vaultEntry.findFirst({
    where: { chain: rail, account: COMMANDER_ACCOUNT, role: "posting" },
    orderBy: { updatedAt: "desc" },
  });
  if (!entry) throw new GateError("vault-missing-key", `אין מפתח-posting של ${COMMANDER_ACCOUNT} על ${rail} בכספת`);
  const wif = openSecret({ encPriv: entry.encPriv, privIv: entry.privIv, privTag: entry.privTag });
  return toSigningKey(wif);
}

/**
 * PUBLISH-DESK gate: prove the vault key is the account's CURRENT posting
 * authority ON THE CHAIN (33-byte public-key comparison) before any rail
 * broadcast. Fail-closed — a mismatch refuses to sign, loud and honest.
 */
async function verifiedRailKey(rail: Rail): Promise<PrivateKey> {
  const priv = await commanderPostingKey(rail);
  const proof = await verifyPostingKeyOnChain(rail, COMMANDER_ACCOUNT, { pub33: priv.publicKey.bytes });
  if (!proof.match) {
    throw new GateError(
      "rail-key-mismatch",
      `מפתח ה-posting בכספת אינו הסמכות הנוכחית של ${COMMANDER_ACCOUNT} על ${rail}` +
        ` (chain: ${proof.chainPub ?? "—"} · derived: ${proof.derivedPub ?? "—"}${proof.reason ? ` · ${proof.reason}` : ""}) — השידור נחסם`,
    );
  }
  return priv;
}

async function signAndBroadcastRail(
  rail: PublishRail,
  kind: string,
  agentName: string,
  built: SocialBuild,
  evidence: Record<string, unknown>,
): Promise<{ txId: string; blockNum?: number }> {
  const priv = await verifiedRailKey(rail);
  const adapter = rail === "hive" ? hiveBroadcastAdapter() : steemBroadcastAdapter();
  try {
    const signed = await adapter.sign(built.unsigned, { byRole: { posting: priv } }, ["posting"]);
    const res = await adapter.broadcast(signed);
    const txId = res.txId || built.txId;
    await audit(`sovereign-voice:${kind}`, agentName, { rail, ...evidence }, true, { txId, blockNum: res.blockNum ?? null });
    return { txId, blockNum: res.blockNum };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await audit(`sovereign-voice:${kind}`, agentName, { rail, ...evidence }, false, { error: msg });
    await socialMsg(`❌ שידור ${kind} נכשל על ${rail} (${agentName}): ${msg} — נרשם בכנות`, {}).catch(() => {});
    throw new GateError("broadcast-failed", `השידור נכשל: ${msg}`);
  }
}

async function audit(action: string, agentName: string, params: unknown, ok: boolean, result: unknown): Promise<void> {
  await db.gateAction
    .create({ data: { agentName, action, params: JSON.stringify(params).slice(0, 2000), ok, result: JSON.stringify(result).slice(0, 2000) } })
    .catch(() => {});
}

async function dayCount(status: string): Promise<number> {
  const dayStart = new Date(`${dayKey()}T00:00:00.000Z`);
  return db.gateAction.count({ where: { action: { startsWith: status }, createdAt: { gte: dayStart }, ok: true } });
}

/** Sign + broadcast a built social tx with the vault posting key (steem rail — legacy interact path). */
async function signAndBroadcast(
  kind: string,
  agentName: string,
  built: SocialBuild,
  evidence: Record<string, unknown>,
): Promise<{ txId: string; blockNum?: number }> {
  return signAndBroadcastRail("steem", kind, agentName, built, evidence);
}

export interface VoicePostResult {
  permlink: string;
  category: string;
  txId: string;
  blockNum?: number;
  url: string;
}

/**
 * Publish a REAL post to a rail — exposure-gated, bounded, audited,
 * chain-evidenced. rail="hive" runs the SAME wire-exact packer against a
 * hive node after verifyPostingKeyOnChain proved the vault key rules there.
 */
export async function publishPostFromAgent(input: {
  agentName: string;
  runId: string;
  title: string;
  body: string;
  tags: string[];
  rail?: PublishRail;
  replyTo?: { author: string; permlink: string };
}): Promise<VoicePostResult> {
  const rail: PublishRail = input.rail === "hive" ? "hive" : "steem";
  const postsToday = await dayCount("sovereign-voice:post");
  if (postsToday >= SOCIAL_RAILS.maxPostsPerDay) {
    throw new GateError("rate-limited", `תקרת-הפרסום היומית של הצי מוצו (${postsToday}/${SOCIAL_RAILS.maxPostsPerDay}) — איכות קודמת לכמות`);
  }
  const body = String(input.body || "");
  if (body.length > SOCIAL_RAILS.maxPostBodyChars) {
    throw new GateError("bad-input", `הגוף חורג מ-${SOCIAL_RAILS.maxPostBodyChars} תווים`);
  }
  // ── exposure policy: the cards stay home (tags scanned too) ──────────
  const tags = (input.tags || []).slice(0, SOCIAL_RAILS.maxTags);
  const exposure = assertPublishable(input.title, body, tags);
  // ── chain-polite root-post pacing ─────────────────────────────────────
  // The chain itself enforces STEEM_MIN_ROOT_COMMENT_INTERVAL: a root post
  // is allowed only once every 5 minutes per account (live-learned 2026-09-10:
  // three broadcasts in a row died on the exact node assert). Instead of
  // burning the maker's budget on doomed retries, the module READS
  // last_root_post from the chain and waits out the remainder itself.
  if (!input.replyTo) {
    const waitSec = await steemRootPostWaitSec();
    if (waitSec > 0) {
      await socialMsg(
        `⏳ ${input.agentName}: השרשרת דורשת הפרש של 5 דקות בין פוסטי-שורש — ממתין ${waitSec} שניות לפני שידור "${input.title.slice(0, 60)}"`,
        { runId: input.runId },
      );
      // Sleep in ≤120s chunks, renewing the run lease between chunks —
      // LEASE_MS is 180s; one long sleep would let the lease lapse mid-wait
      // and the reaper would reap a perfectly healthy, chain-polite run.
      let leftMs = (waitSec + 2) * 1000;
      while (leftMs > 0) {
        const chunk = Math.min(leftMs, 120_000);
        await new Promise((resolve) => setTimeout(resolve, chunk));
        leftMs -= chunk;
        if (leftMs > 0 && input.runId) await renewLease(input.runId).catch(() => {});
      }
    }
  }
  const built = await buildSteemPostTx(
    { author: COMMANDER_ACCOUNT, title: input.title, body, tags, replyTo: input.replyTo },
    rail === "hive" ? hiveBroadcastAdapter() : undefined, // build ref-block FROM the rail we broadcast to
  );
  const { txId, blockNum } = await signAndBroadcastRail(rail, "post", input.agentName, built, {
    agentName: input.agentName, runId: input.runId, permlink: built.permlink, title: input.title.slice(0, 120), tags,
    exposureRisk: exposure.risk, exposureKinds: exposure.findings.map((f) => f.kind),
  });
  await socialMsg(
    `🗣️ ${input.agentName} פרסם לשרשרת (${rail}): "${input.title.slice(0, 100)}" · @${COMMANDER_ACCOUNT}/${built.permlink} · txId: ${txId}` +
      (exposure.risk === "medium" ? ` · ⚠️ חשיפה-בינונית: ${exposure.findings.map((f) => f.kind).join(",")}` : ""),
    { rail, permlink: built.permlink, txId, runId: input.runId },
  );
  return {
    rail, permlink: built.permlink, category: built.category, txId, blockNum,
    url: rail === "hive" ? `https://peakd.com/@${COMMANDER_ACCOUNT}/${built.permlink}` : `https://steemit.com/@${COMMANDER_ACCOUNT}/${built.permlink}`,
  };
}

export interface VoiceEditResult {
  rail: PublishRail;
  permlink: string;
  txId: string;
  blockNum?: number;
  changedChars: number;
  url: string;
}

/**
 * EDIT an existing fleet post on a rail — the remediation primitive behind
 * "עריכת כל הפוסטים": fetch the original from the chain, prove ownership,
 * run the exposure gate, then broadcast the comment op with the SAME
 * permlink/parent (a graphene edit is a re-comment). Bounded daily cap.
 */
export async function editPostFromAgent(input: {
  agentName: string;
  runId: string;
  rail?: PublishRail;
  permlink: string;
  title: string;
  body: string;
  tags?: string[];
  /**
   * roast r3: the daily cap bounds AGENT autonomy — but feed remediation is
   * the OPERATOR's duty, and round 2's own remediation ran into the round-2
   * cap it had filled (8/8). The override skips ONLY the day count, requires
   * agentName==="operator" (any other name is refused), still passes the
   * exposure gate + chain key proof, and is recorded loudly in the audit.
   */
  operatorOverride?: boolean;
}): Promise<VoiceEditResult> {
  const rail: PublishRail = input.rail === "hive" ? "hive" : "steem";
  if (input.operatorOverride === true && input.agentName !== "operator") {
    throw new GateError("bad-input", "עקיפת-תקרה מותרת למפעיל בלבד (agentName=operator)");
  }
  if (input.operatorOverride !== true) {
    const editsToday = await dayCount("sovereign-voice:edit");
    if (editsToday >= SOCIAL_RAILS.maxEditsPerDay) {
      throw new GateError("rate-limited", `תקרת-העריכות היומית מוצו (${editsToday}/${SOCIAL_RAILS.maxEditsPerDay}) — עריכה מתוכננת, לא ריסוק-היסטוריה`);
    }
  }
  const permlink = String(input.permlink || "").trim();
  if (!/^[a-z0-9-]{1,256}$/.test(permlink)) throw new GateError("bad-input", "permlink חייב להיות [a-z0-9-]");
  // ── chain-polite comment-edit pacing ──────────────────────────────────
  // STEEM_MIN_COMMENT_EDIT_INTERVAL (live-learned round 2): a comment can be
  // edited at most once per block (~3s). A retry or a fast follow-up edit of
  // the SAME post died on the node assert — the remediation tool learned 7s
  // pacing, but the MODULE (the editor's daily hands) never got it. Read
  // last_update from the chain and wait out the remainder, bounded.
  const original: RailPost | null = await railGetContent(rail, COMMANDER_ACCOUNT, permlink);
  if (!original) throw new GateError("no-post", `אין פוסט @${COMMANDER_ACCOUNT}/${permlink} על ${rail} — אין מה לערוך`);
  if (original.author !== COMMANDER_ACCOUNT) throw new GateError("not-ours", "רק פוסטים של הצי נערכים");
  const lastEditMs = Date.parse(original.lastUpdate?.endsWith("Z") || !original.lastUpdate ? original.lastUpdate || "" : `${original.lastUpdate}Z`);
  if (Number.isFinite(lastEditMs)) {
    const sinceEditSec = (Date.now() - lastEditMs) / 1000;
    const EDIT_INTERVAL_SEC = 8; // ~2 blocks — the live-learned polite pace
    if (sinceEditSec < EDIT_INTERVAL_SEC) {
      const waitMs = Math.ceil((EDIT_INTERVAL_SEC - sinceEditSec) * 1000);
      await socialMsg(`⏳ ${input.agentName}: השרשרת מתירה עריכת-תגובה אחת לבלוק — ממתין ${waitMs}ms לפני עריכת @${COMMANDER_ACCOUNT}/${permlink}`, { runId: input.runId });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  const newBody = String(input.body || "");
  if (!newBody.trim() || newBody.length > SOCIAL_RAILS.maxPostBodyChars) {
    throw new GateError("bad-input", "גוף-עריכה חייב להיות לא ריק ובתוך התקרה");
  }
  // tags: default to the ORIGINAL tags — an edit must not silently re-categorize the post
  let tags = (input.tags && input.tags.length ? input.tags : original.tags).slice(0, SOCIAL_RAILS.maxTags);
  if (!tags.length && original.category) tags = [original.category];
  if (!tags.length) throw new GateError("bad-input", "לעריכה דרושות תגיות (המקור לא כלל תגיות ואין קטגוריה שמורה)");
  // ── no-op guard (roast r3, self-caught LIVE): re-running the remediation tool
  // re-broadcast 6 IDENTICAL edits — a zero-delta edit is a wasted transaction
  // and the maker never learned it. If title+body+tags are all already the
  // chain state, refuse loudly instead of burning a block on nothing.
  const normTags = (xs: string[]) => [...new Set(xs.map((t) => t.trim().toLowerCase()))].sort();
  const effTitle = String(input.title || original.title).trim() || original.title;
  if (effTitle === original.title && newBody === original.body && JSON.stringify(normTags(tags)) === JSON.stringify(normTags(original.tags))) {
    throw new GateError("no-op-edit", `התוכן זהה למה שכבר חי בשרשרת @${COMMANDER_ACCOUNT}/${permlink} — אין צורך בשידור (עריכת-אפס מבזבזת טרנזקציה)`);
  }
  // ── exposure policy applies to edits too (tags scanned too) ───────────
  const exposure = assertPublishable(input.title, newBody, tags);
  const built = await buildSteemPostTx(
    {
      author: COMMANDER_ACCOUNT,
      title: String(input.title || original.title).trim() || original.title,
      body: newBody,
      tags,
      permlink, // SAME permlink + SAME original category parent = edit, not a new post
      category: original.category || undefined,
    },
    rail === "hive" ? hiveBroadcastAdapter() : undefined,
  );
  const { txId, blockNum } = await signAndBroadcastRail(rail, "edit", input.agentName, built, {
    agentName: input.agentName, runId: input.runId, permlink, title: input.title.slice(0, 120),
    exposureRisk: exposure.risk, exposureKinds: exposure.findings.map((f) => f.kind),
  });
  await socialMsg(
    `✏️ ${input.agentName} ערך פוסט קיים (${rail}): @${COMMANDER_ACCOUNT}/${permlink} · txId: ${txId} · שינוי ${original.bodyPreview.length}→${newBody.length} תווים`,
    { rail, permlink, txId, runId: input.runId },
  );
  return {
    rail, permlink, txId, blockNum, changedChars: newBody.length - original.bodyPreview.length,
    url: rail === "hive" ? `https://peakd.com/@${COMMANDER_ACCOUNT}/${permlink}` : `https://steemit.com/@${COMMANDER_ACCOUNT}/${permlink}`,
  };
}

export interface FleetContentAuditRow {
  rail: PublishRail;
  permlink: string;
  title: string;
  created: string;
  payout: string;
  tags: string[];
  risk: string;
  findings: Array<{ kind: string; why: string; redacted: string }>;
  /** Findings on parts an EDIT can never change (category = parent_permlink).
   *  Reported honestly instead of silently dropped — and NOT counted into
   *  needsEdit, so the editor loop never thrashes on the unfixable. */
  immutableFindings: Array<{ kind: string; why: string; redacted: string }>;
  needsEdit: boolean;
}

export interface FleetContentAudit {
  rails: Array<{ rail: PublishRail; ok: boolean; posts: number; flagged: number; error?: string }>;
  posts: FleetContentAuditRow[];
  summary: string;
}

/**
 * The chain-truth audit: pull each managed publishing account's blog feed
 * per rail and run the exposure scanner over every post — "מי מפרסם מה,
 * מה חייב לצאת, מה חייב עריכה". Read-only, no keys, bounded (≤20 per rail).
 *
 * roast r3 (two truth-gaps found live):
 *   · this scan saw only the FIRST 400 CHARS of each post (bodyPreview) —
 *     Hebrew/leaks deeper in a post were invisible to the very audit that
 *     claims "scanned". It now scans the FULL body + tags + category.
 *   · the category (parent_permlink) is IMMUTABLE on-chain — findings there
 *     are reported as immutableFindings (disclosed, not "fixable") so the
 *     editor never burns its daily cap re-editing what no edit can change.
 */
export async function auditFleetContent(limitPerRail = 20): Promise<FleetContentAudit> {
  const rails: Array<PublishRail> = ["steem", "hive"];
  const posts: FleetContentAuditRow[] = [];
  const railStats: FleetContentAudit["rails"] = [];
  for (const rail of rails) {
    try {
      const feed = await railBlogPosts(rail, COMMANDER_ACCOUNT, limitPerRail);
      let flagged = 0;
      for (const p of feed) {
        const editable = scanExposure(p.title, p.body, p.tags.join(" ")); // FULL body, tags included
        const immutable = scanExposure(p.category); // parent_permlink — an edit can never touch it
        const needsEdit = editable.risk === "high";
        if (needsEdit) flagged++;
        posts.push({
          rail, permlink: p.permlink, title: p.title, created: p.created, payout: p.payout, tags: p.tags,
          risk: editable.risk === "high" ? "high" : immutable.risk === "high" ? "high" : editable.risk,
          findings: editable.findings, immutableFindings: immutable.findings, needsEdit,
        });
      }
      railStats.push({ rail, ok: true, posts: feed.length, flagged });
    } catch (e) {
      railStats.push({ rail, ok: false, posts: 0, flagged: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const total = posts.length;
  const flagged = posts.filter((p) => p.needsEdit).length;
  const immutable = posts.filter((p) => p.immutableFindings.length > 0).length;
  const summary =
    `ביקורת-תוכן חיה (גוף-מלא + תגיות): ${total} פוסטים אחרונים נסרקו על ${railStats.filter((r) => r.ok).length} מסילות, ` +
    `${flagged} מדגלים לעריכה` +
    (immutable > 0 ? ` · ${immutable} נושאים ממצא-קטגוריה בלתי-ניתן-לתיקון (parent_permlink נחרת בפרסום — מוצג בכנות, לא מזויף כ"ניתן לתיקון")` : "") +
    " (מדיניות-חשיפה)";
  return { rails: railStats, posts, summary };
}

export interface RailsOverview {
  rails: RailHealth[];
  commander: {
    account: string;
    perRail: Array<{
      rail: Rail;
      keyInVault: boolean;
      accountOnChain: boolean | null;
      keyVerifiedAgainstChain: boolean | null; // null = rail unreachable, not a mismatch
      chainPub: string | null;
      derivedPub: string | null;
      reason?: string;
    }>;
  };
  broadcastPolicy: string;
}

/**
 * PUBLISH-DESK overview — which publishing rails exist, which are alive,
 * which accounts the fleet holds THERE, and whether each vault posting key
 * is provably the account's current on-chain authority (33-byte pubkey
 * comparison against the chain itself — never a stored assumption).
 * This is the pre-flight board for every multi-rail publication.
 */
export async function fleetRailsOverview(): Promise<RailsOverview> {
  requireMaster();
  const all: Rail[] = ["steem", "hive", "blurt"];
  const rails = await Promise.all(all.map((r) => railHealth(r)));
  const perRail: RailsOverview["commander"]["perRail"] = [];
  for (const rail of all) {
    const health = rails.find((r) => r.rail === rail);
    const entry = await db.vaultEntry.findFirst({
      where: { chain: rail, account: COMMANDER_ACCOUNT, role: "posting" },
      orderBy: { updatedAt: "desc" },
    });
    if (!entry) {
      perRail.push({ rail, keyInVault: false, accountOnChain: null, keyVerifiedAgainstChain: null, chainPub: null, derivedPub: null, reason: "אין מפתח-posting של המפקד בכספת למסילה זו" });
      continue;
    }
    if (health && !health.reachable) {
      perRail.push({ rail, keyInVault: true, accountOnChain: null, keyVerifiedAgainstChain: null, chainPub: null, derivedPub: null, reason: `המסילה לא נגישה — לא ניתן לאמת (${health.error ?? "no endpoint"})` });
      continue;
    }
    const wif = openSecret({ encPriv: entry.encPriv, privIv: entry.privIv, privTag: entry.privTag });
    // the vault stores headcorner keys in the non-canonical 33-byte quirk —
    // derive pub33 through the SAME tolerant path the signing pipeline uses
    const pub33 = toSigningKey(wif).publicKey.bytes;
    const proof = await verifyPostingKeyOnChain(rail, COMMANDER_ACCOUNT, { pub33 });
    perRail.push({
      rail,
      keyInVault: true,
      accountOnChain: proof.hasChainAccount,
      keyVerifiedAgainstChain: proof.hasChainAccount ? proof.match : null,
      chainPub: proof.chainPub,
      derivedPub: proof.derivedPub,
      reason: proof.reason,
    });
  }
  return {
    rails,
    commander: { account: COMMANDER_ACCOUNT, perRail },
    broadcastPolicy:
      "שידור מותר רק על מסילה שבה המפתח אומת מול השרשרת (steem+hive כרגע) · blurt נשאר סגור עד endpoint מאומת + מפתח · posting לעולם לא נוגע בכספים",
  };
}

export interface VoiceInteractResult {
  kind: "vote" | "follow" | "reblog";
  txId: string;
  blockNum?: number;
  detail: string;
}

/** Vote / follow / reblog — REAL network presence, bounded and audited. */
export async function interactFromAgent(input: {
  agentName: string;
  runId: string;
  action: "vote" | "follow" | "reblog";
  author?: string;
  permlink?: string;
  weight?: number; // vote only, 1..maxVoteWeight (0 = clear vote)
  unfollow?: boolean;
}): Promise<VoiceInteractResult> {
  const today = await dayCount("sovereign-voice:interact");
  if (today >= SOCIAL_RAILS.maxInteractionsPerDay) {
    throw new GateError("rate-limited", `תקרת-האינטראקציות היומית מוצו (${today}/${SOCIAL_RAILS.maxInteractionsPerDay})`);
  }
  const author = String(input.author || "").trim().toLowerCase();
  if (!/^[a-z0-9.\-]{3,16}$/.test(author)) throw new GateError("bad-input", "דרוש author תקין");
  // ── self-dealing guard (roast r3, found LIVE): the fleet's own interact run
  // voted 500/10000 on its own just-published post (tx 048b3162…). Voting for
  // yourself is not conviction, it is farming the reward pool with the fleet's
  // own stake — forbidden on the agent rails. The operator's own wallet is
  // outside this code path and stays free to vote however it chooses.
  if (input.action === "vote" && author === COMMANDER_ACCOUNT) {
    throw new GateError("self-vote-forbidden", "הצבעה-עצמית אסורה במסילות-הסוכנים: הצבעה היא הכרעת-קוראים, לא אמצעי-הכנסה עצמי");
  }
  const permlink = String(input.permlink || "").trim();
  let built: SocialBuild;
  let detail = "";
  let kind: VoiceInteractResult["kind"];
  if (input.action === "vote") {
    if (!permlink) throw new GateError("bad-input", "דרוש permlink להצבעה");
    const weight = Math.max(-SOCIAL_RAILS.maxVoteWeight, Math.min(SOCIAL_RAILS.maxVoteWeight, Math.floor(Number(input.weight ?? SOCIAL_RAILS.maxVoteWeight))));
    built = await buildSteemVoteTx({ voter: COMMANDER_ACCOUNT, author, permlink, weight });
    detail = `vote ${weight}/10000 → @${author}/${permlink}`;
    kind = "vote";
  } else if (input.action === "follow") {
    built = await buildSteemFollowTx({ follower: COMMANDER_ACCOUNT, following: author, unfollow: input.unfollow === true });
    detail = `${input.unfollow ? "unfollow" : "follow"} @${author}`;
    kind = "follow";
  } else {
    if (!permlink) throw new GateError("bad-input", "דרוש permlink ל-reblog");
    built = await buildSteemReblogTx({ account: COMMANDER_ACCOUNT, author, permlink });
    detail = `reblog @${author}/${permlink}`;
    kind = "reblog";
  }
  const { txId, blockNum } = await signAndBroadcast("interact", input.agentName, built, {
    agentName: input.agentName, runId: input.runId, action: input.action, author, permlink, weight: input.weight ?? null,
  });
  await socialMsg(`🤝 ${input.agentName} פעל ברשת: ${detail} · txId: ${txId}`, { action: input.action, txId, runId: input.runId });
  return { kind: kind!, txId, blockNum, detail };
}

/* ══════════════ SOVEREIGN-TREASURY — the fleet harvests what it EARNED ══════════════
 *
 * How Steem rewards actually work (the doctrine behind this code):
 *   · author + curation payouts accrue into reward_steem / reward_sbd /
 *     reward_vests — PENDING balances visible in the wallet but NOT spendable;
 *   · until a claim_reward_balance op moves them into balance / sbd_balance /
 *     vesting_shares, nobody can transfer or power them anywhere — this is why
 *     "יש תגמול בארנק ואי אפשר לממש אותו"; the missing step is the CLAIM;
 *   · the chain itself allows the POSTING key to claim (never funds authority).
 * Census is read-only truth; the claim is a real signed tx with chain evidence.
 */

const STEEM_NODE = "https://api.steemit.com";
void STEEM_NODE; // kept as documentation — all reads below ride the rail's failover pool

/**
 * roast r3: this used to be its own single-node fetch — a private, weaker
 * transport parallel to the rails' failover pool. One dead primary node killed
 * the census, the trends radar, the root-post pacing probe AND the claim path
 * while the rail layer was designed to survive exactly that. Now every read
 * rides the same ordered failover endpoints as everything else.
 */
async function steemRpc<T>(method: string, params: unknown[]): Promise<T> {
  try {
    return await railRpc<T>("steem", method, params, 12_000);
  } catch (e) {
    throw new GateError("rpc-error", `Steem RPC נכשל: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface RawAccount {
  name: string;
  reward_steem_balance: string;
  reward_sbd_balance: string;
  reward_vesting_balance: string;
  reward_vesting_steem: string;
  balance: string;
  sbd_balance: string;
  vesting_shares: string;
  last_root_post?: string;
}

function num(s: string): number {
  return parseFloat(String(s).split(" ")[0]) || 0;
}

/**
 * How many seconds until the chain will accept this account's next ROOT post
 * (STEEM_MIN_ROOT_COMMENT_INTERVAL = 5 min). Reads last_root_post live from
 * the chain; 0 = free to broadcast. Probe failure → 0 (let the chain itself
 * judge — the honest path, never a fake success).
 */
const STEEM_ROOT_POST_INTERVAL_SEC = 300;
async function steemRootPostWaitSec(): Promise<number> {
  try {
    const [raw] = await steemRpc<RawAccount[]>("condenser_api.get_accounts", [[COMMANDER_ACCOUNT]]);
    const stamp = raw?.last_root_post;
    if (!stamp) return 0;
    const last = Date.parse(stamp.endsWith("Z") ? stamp : `${stamp}Z`);
    if (!Number.isFinite(last)) return 0;
    const elapsed = (Date.now() - last) / 1000;
    if (elapsed >= STEEM_ROOT_POST_INTERVAL_SEC) return 0;
    return Math.min(Math.ceil(STEEM_ROOT_POST_INTERVAL_SEC - elapsed), 330);
  } catch {
    return 0;
  }
}

export interface FleetRewardRow {
  account: string;
  rewardSteem: string;
  rewardSbd: string;
  rewardVests: string;
  steemEquiv: number; // pending STEEM + vests component (reward_vesting_steem)
  claimable: boolean; // vault holds a live posting key for this account on steem
  balance: string;
  sbdBalance: string;
  vestingShares: string;
}

export interface FleetRewardsCensus {
  accounts: FleetRewardRow[];
  notOnChain: string[]; // vault keys whose account does not exist on the chain — honest dead-weight report
  unclaimedCount: number;
  totalSteemEquiv: number;
  summary: string;
}

/**
 * The live reward census across the WHOLE fleet — "כמה כל חשבון צבר ומה ממתין
 * לתביעה". Read-only, no keys touched, honest about which accounts we can
 * actually claim for (posting key in the vault).
 */
export async function fleetRewardsCensus(): Promise<FleetRewardsCensus> {
  const vaultRows = await db.vaultEntry.findMany({
    where: { chain: "steem", role: "posting", status: "verified" },
    select: { account: true },
  });
  const claimable = new Set(vaultRows.map((r) => r.account));
  const accounts = [...claimable]; // census the accounts we can act on — no dead weight
  if (accounts.length === 0) throw new GateError("vault-missing-key", "אין בכספת מפתחות-posting מאומתים על steem — אין למי לתבוע");
  const raw = await steemRpc<RawAccount[]>("condenser_api.get_accounts", [accounts]);
  // roast r3 truth-gap: get_accounts SILENTLY drops names that don't exist — the
  // vault held a posting entry for @headcorner-legacy which simply vanished from
  // every census without a word. Now the census says so out loud.
  const returned = new Set((raw || []).map((a) => a.name));
  const notOnChain = accounts.filter((a) => !returned.has(a));
  const rows: FleetRewardRow[] = (raw || []).map((a) => ({
    account: a.name,
    rewardSteem: a.reward_steem_balance,
    rewardSbd: a.reward_sbd_balance,
    rewardVests: a.reward_vesting_balance,
    steemEquiv: num(a.reward_steem_balance) + num(a.reward_vesting_steem),
    claimable: claimable.has(a.name),
    balance: a.balance,
    sbdBalance: a.sbd_balance,
    vestingShares: a.vesting_shares,
  }));
  rows.sort((x, y) => y.steemEquiv - x.steemEquiv);
  const unclaimed = rows.filter((r) => num(r.rewardSteem) > 0 || num(r.rewardSbd) > 0 || num(r.rewardVests) > 0);
  const total = rows.reduce((acc, r) => acc + r.steemEquiv, 0);
  const deadWeight = notOnChain.length > 0 ? ` · ⚠️ ${notOnChain.length} כניסות-כספת לחשבונות שאינם קיימים בשרשרת (${notOnChain.join(", ")}) — משקל-מת` : "";
  return {
    accounts: rows,
    notOnChain,
    unclaimedCount: unclaimed.length,
    totalSteemEquiv: total,
    summary:
      unclaimed.length === 0
        ? `סקר-תגמולים חי: ${rows.length} חשבונות נבדקו — אין תגמולים ממתינים לתביעה באף חשבון${deadWeight}`
        : `סקר-תגמולים חי: ${unclaimed.length}/${rows.length} חשבונות מחזיקים תגמולים שלא נתבעו (${total.toFixed(3)} STEEM שקול) — ${unclaimed.map((u) => u.account).join(", ")} · תביעה = claim_reward_balance חתום (steem.claim)${deadWeight}`,
  };
}

export interface VoiceClaimResult {
  account: string;
  claimed: { steem: string; sbd: string; vests: string };
  txId: string;
  blockNum?: number;
  verified: boolean; // live re-read AFTER broadcast: pending rewards are gone
}

/** Vault posting key of ANY fleet account (steem) — never taken from agent input paths blindly. */
async function postingKeyFor(account: string): Promise<PrivateKey> {
  requireMaster();
  const entry = await db.vaultEntry.findFirst({
    where: { chain: "steem", account, role: "posting" },
    orderBy: { updatedAt: "desc" },
  });
  if (!entry) throw new GateError("vault-missing-key", `אין מפתח-posting של @${account} בכספת — אי אפשר לתבוע בשמו`);
  const wif = openSecret({ encPriv: entry.encPriv, privIv: entry.privIv, privTag: entry.privTag });
  return toSigningKey(wif);
}

/**
 * CLAIM pending rewards for a fleet account — the missing step between "יש
 * תגמול בארנק" and כסף/כוח בפועל. Reads the LIVE pending amounts (never trusts
 * the caller's numbers), refuses zero claims, proves the vault key against the
 * chain, broadcasts, then RE-READS the account to verify the harvest.
 */
export async function claimRewardsFromAgent(input: {
  agentName: string;
  runId: string;
  account?: string;
}): Promise<VoiceClaimResult> {
  const today = await dayCount("sovereign-voice:claim");
  if (today >= SOCIAL_RAILS.maxClaimsPerDay) {
    throw new GateError("rate-limited", `תקרת-התביעות היומית מוצו (${today}/${SOCIAL_RAILS.maxClaimsPerDay})`);
  }
  const account = String(input.account || COMMANDER_ACCOUNT).trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9.\-]{3,16}$/.test(account)) throw new GateError("bad-input", "שם-חשבון לא תקין");

  // live pending rewards — the chain's numbers, never the caller's
  const [raw] = await steemRpc<RawAccount[]>("condenser_api.get_accounts", [[account]]);
  if (!raw) throw new GateError("no-account", `החשבון @${account} לא נמצא בשרשרת`);
  const rewardSteem = raw.reward_steem_balance;
  const rewardSbd = raw.reward_sbd_balance;
  const rewardVests = raw.reward_vesting_balance;
  if (num(rewardSteem) === 0 && num(rewardSbd) === 0 && num(rewardVests) === 0) {
    throw new GateError("nothing-to-claim", `ל@${account} אין תגמולים ממתינים — אין מה לתבוע (זו תשובה כנה, לא כשל)`);
  }

  const priv = await postingKeyFor(account);
  // fail-closed: the vault key must be the account's CURRENT posting authority
  const proof = await verifyPostingKeyOnChain("steem", account, { pub33: priv.publicKey.bytes });
  if (!proof.match) {
    throw new GateError(
      "rail-key-mismatch",
      `מפתח הכספת של @${account} אינו הסמכות הנוכחית בשרשרת (chain: ${proof.chainPub ?? "—"}) — התביעה נחסמת`,
    );
  }

  const built = await buildSteemClaimTx({ account, rewardSteem, rewardSbd, rewardVests });
  const adapter = steemBroadcastAdapter();
  try {
    const signed = await adapter.sign(built.unsigned, { byRole: { posting: priv } }, ["posting"]);
    const res = await adapter.broadcast(signed);
    const txId = res.txId || built.txId;
    await audit(`sovereign-voice:claim`, input.agentName, { account, rewardSteem, rewardSbd, rewardVests }, true, { txId, blockNum: res.blockNum ?? null });

    // verification: the chain itself must now report zero pending
    const [after] = await steemRpc<RawAccount[]>("condenser_api.get_accounts", [[account]]);
    const verified =
      !!after && num(after.reward_steem_balance) === 0 && num(after.reward_sbd_balance) === 0 && num(after.reward_vesting_balance) === 0;
    await socialMsg(
      `🪙 ${input.agentName} תבע את התגמולים של @${account}: ${rewardSteem} + ${rewardSbd} + ${rewardVests} · txId: ${txId}` +
        (verified ? " · אומת חי: הממתינים התאפסו" : " · האימות החי עדיין מציג ממתינים (הצומת מתעדכן)"),
      { account, txId, runId: input.runId },
    );
    return { account, claimed: { steem: rewardSteem, sbd: rewardSbd, vests: rewardVests }, txId, blockNum: res.blockNum, verified };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await audit(`sovereign-voice:claim`, input.agentName, { account, rewardSteem, rewardSbd, rewardVests }, false, { error: msg });
    await socialMsg(`❌ תביעת-תגמולים של @${account} נכשלה: ${msg} — נרשם בכנות`, {}).catch(() => {});
    throw new GateError("broadcast-failed", `התביעה נכשלה: ${msg}`);
  }
}

/* ═══ TOPIC RADAR (steem.trends) — what the network actually reads, live ═══
 * The builders used to write blind — topics picked by feel, not demand.
 * The radar reads the chain's OWN demand signal: trending tags by payout,
 * hot discussions by engagement — and derives editorial candidates from it.
 * Value for the network = content the audience demonstrably reads.
 * Read-only, public data, no vault. Everything traceable to a live call. */

interface RawTrendingTag {
  name: string;
  total_payouts: string;
  top_posts: string;
}
interface RawDiscussion {
  title: string;
  author: string;
  permlink: string;
  category: string;
  total_payout_value: string;
  pending_payout_value: string;
  children: number;
  created: string;
}

export interface TrendingTagRow {
  tag: string;
  payoutSteem: number;
  posts: number;
}
export interface HotDiscussionRow {
  title: string;
  author: string;
  permlink: string;
  category: string;
  payoutSteem: number;
  comments: number;
  ageHours: number;
}
export interface TopicCandidate {
  titleIdeaEn: string;
  tags: string[];
  why: string;
}
export interface TrendsReport {
  generatedAt: string;
  topTags: TrendingTagRow[];
  hot: HotDiscussionRow[];
  candidates: TopicCandidate[];
  summary: string;
}

function assetNum(v: string): number {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export async function steemTrends(): Promise<TrendsReport> {
  const [rawTags, rawHot] = await Promise.all([
    steemRpc<RawTrendingTag[]>("condenser_api.get_trending_tags", [null, 40]),
    steemRpc<RawDiscussion[]>("condenser_api.get_discussions_by_trending", [{ limit: 25 }]),
  ]);

  const topTags: TrendingTagRow[] = (rawTags || [])
    .filter((t) => t && t.name)
    .map((t) => ({ tag: t.name, payoutSteem: assetNum(t.total_payouts), posts: parseInt(t.top_posts || "0", 10) || 0 }))
    .sort((a, b) => b.payoutSteem - a.payoutSteem)
    .slice(0, 12);

  const now = Date.now();
  const hot: HotDiscussionRow[] = (rawHot || [])
    .filter((d) => d && d.author && d.permlink)
    .map((d) => ({
      title: (d.title || "(no title)").slice(0, 90),
      author: d.author,
      permlink: d.permlink,
      category: d.category || "steem",
      payoutSteem: assetNum(d.total_payout_value) + assetNum(d.pending_payout_value),
      comments: d.children || 0,
      ageHours: Math.max(0, Math.round(((now - new Date(d.created + "Z").getTime()) / 3_600_000) * 10) / 10),
    }))
    .sort((a, b) => b.payoutSteem - a.payoutSteem)
    .slice(0, 10);

  // candidates — derived from the LIVE scan only, never invented:
  // the chain's hottest categories, ranked by real payout mass.
  const catMass = new Map<string, { n: number; payout: number }>();
  for (const d of hot) {
    const e = catMass.get(d.category) || { n: 0, payout: 0 };
    e.n += 1;
    e.payout += d.payoutSteem;
    catMass.set(d.category, e);
  }
  const rankedCats = [...catMass.entries()].sort((a, b) => b[1].payout - a[1].payout).slice(0, 5);
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const candidates: TopicCandidate[] = rankedCats.map(([cat, v]) => ({
    titleIdeaEn: `${cap(cat)} in practice: what the chain's top-ranked posts this week reveal`,
    tags: [...new Set([cat, topTags[0]?.tag, topTags[1]?.tag, "howto"].filter((x): x is string => !!x))].slice(0, 5),
    why: `הקטגוריה "${cat}" מופיעה ${v.n} פעמים ברשימה-החמה החיה עם ~${v.payout.toFixed(1)} SBD תשלומים-מצטברים — ביקוש מהשרשרת, לא ניחוש`,
  }));

  const hottest = hot[0];
  const summary =
    `מכ"ם-נושאים חי מהשרשרת: ${topTags.length} תגיות-חמות (ראשונה: ${topTags[0]?.tag || "—"} עם ~${topTags[0]?.payoutSteem.toFixed(1) ?? "—"} SBD), ` +
    `${hot.length} דיונים-חמים${hottest ? ` (החם ביותר: "${hottest.title}" של @${hottest.author}, ${hottest.comments} תגובות)` : ""}. ` +
    `${candidates.length} מועמדויות-נושא נגזרו מהביקוש-החי — הבונים כותבים מה שהרשת קוראת באמת, באנגלית (ניתוב-שפה).`;

  return { generatedAt: new Date().toISOString(), topTags, hot, candidates, summary };
}
