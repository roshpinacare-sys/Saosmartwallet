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
import { buildSteemPostTx, buildSteemVoteTx, buildSteemFollowTx, buildSteemReblogTx, type SocialBuild } from "@/lib/steem-social";
import { PrivateKey } from "../../../../packages/crypto/src/index";
import { toSigningKey, COMMANDER_ACCOUNT } from "./orders";

export const SOCIAL_RAILS = {
  maxPostsPerDay: 4, // fleet-wide real publications per UTC day
  maxInteractionsPerDay: 12, // votes + follows + reblogs combined per UTC day
  maxVoteWeight: 2000, // ≤ 20% — the fleet votes with conviction, never spam
  maxPostBodyChars: 20000,
  maxTags: 5,
} as const;

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function socialMsg(body: string, meta: Record<string, unknown>): Promise<void> {
  await db.gateMessage
    .create({ data: { channel: "command", fromKind: "system", fromName: "sovereign-voice", body: body.slice(0, 1000), meta: JSON.stringify(meta) } })
    .catch(() => {});
}

/** The vault POSTING key of the commander — never taken from agent input. */
async function commanderPostingKey(): Promise<PrivateKey> {
  requireMaster();
  const entry = await db.vaultEntry.findFirst({
    where: { chain: "steem", account: COMMANDER_ACCOUNT, role: "posting" },
    orderBy: { updatedAt: "desc" },
  });
  if (!entry) throw new GateError("vault-missing-key", `אין מפתח-posting של ${COMMANDER_ACCOUNT} בכספת`);
  const wif = openSecret({ encPriv: entry.encPriv, privIv: entry.privIv, privTag: entry.privTag });
  return toSigningKey(wif);
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

/** Sign + broadcast a built social tx with the vault posting key. Returns REAL chain evidence. */
async function signAndBroadcast(
  kind: string,
  agentName: string,
  built: SocialBuild,
  evidence: Record<string, unknown>,
): Promise<{ txId: string; blockNum?: number }> {
  const priv = await commanderPostingKey();
  const adapter = steemBroadcastAdapter();
  try {
    const signed = await adapter.sign(built.unsigned, { byRole: { posting: priv } }, ["posting"]);
    const res = await adapter.broadcast(signed);
    const txId = res.txId || built.txId;
    await audit(`sovereign-voice:${kind}`, agentName, evidence, true, { txId, blockNum: res.blockNum ?? null });
    return { txId, blockNum: res.blockNum };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await audit(`sovereign-voice:${kind}`, agentName, evidence, false, { error: msg });
    await socialMsg(`❌ שידור ${kind} נכשל (${agentName}): ${msg} — נרשם בכנות`, {}).catch(() => {});
    throw new GateError("broadcast-failed", `השידור נכשל: ${msg}`);
  }
}

export interface VoicePostResult {
  permlink: string;
  category: string;
  txId: string;
  blockNum?: number;
  url: string;
}

/** Publish a REAL post to the chain — bounded, audited, chain-evidenced. */
export async function publishPostFromAgent(input: {
  agentName: string;
  runId: string;
  title: string;
  body: string;
  tags: string[];
  replyTo?: { author: string; permlink: string };
}): Promise<VoicePostResult> {
  const postsToday = await dayCount("sovereign-voice:post");
  if (postsToday >= SOCIAL_RAILS.maxPostsPerDay) {
    throw new GateError("rate-limited", `תקרת-הפרסום היומית של הצי מוצו (${postsToday}/${SOCIAL_RAILS.maxPostsPerDay}) — איכות קודמת לכמות`);
  }
  const body = String(input.body || "");
  if (body.length > SOCIAL_RAILS.maxPostBodyChars) {
    throw new GateError("bad-input", `הגוף חורג מ-${SOCIAL_RAILS.maxPostBodyChars} תווים`);
  }
  const tags = (input.tags || []).slice(0, SOCIAL_RAILS.maxTags);
  const built = await buildSteemPostTx({ author: COMMANDER_ACCOUNT, title: input.title, body, tags, replyTo: input.replyTo });
  const { txId, blockNum } = await signAndBroadcast("post", input.agentName, built, {
    agentName: input.agentName, runId: input.runId, permlink: built.permlink, title: input.title.slice(0, 120), tags,
  });
  await socialMsg(
    `🗣️ ${input.agentName} פרסם לשרשרת: "${input.title.slice(0, 100)}" · @${COMMANDER_ACCOUNT}/${built.permlink} · txId: ${txId}`,
    { permlink: built.permlink, txId, runId: input.runId },
  );
  return { permlink: built.permlink, category: built.category, txId, blockNum, url: `https://steemit.com/@${COMMANDER_ACCOUNT}/${built.permlink}` };
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
