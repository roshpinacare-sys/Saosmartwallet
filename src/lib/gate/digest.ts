/**
 * THE COMPREHENSION PLANE (r25) — the vault doesn't just HEAR broadcasts,
 * it READS them.
 * =====================================================================
 * r23 gave the fleet a voice (we pushed our report into every partner
 * repo), r24 gave the vault ears (incoming broadcast watch). But ears
 * that only count files are still deaf: r25 fetches each broadcast's
 * CONTENT (bounded: latest file per repo, ~12 calls on the same 10-min
 * cadence), hashes it, detects echoes of our own report, classifies
 * what a partner actually said (report / question / request / alert),
 * extracts their asks, and — draft-only — builds a suggested response.
 *
 * Laws:
 *  · Zero-load: content fetch rides its own stale-while-revalidate
 *    (10 min, in-memory lock) — the org API is never hammered.
 *  · Every repo fails honestly and independently — one dead repo never
 *    kills the digest.
 *  · No raw content leaves here: hashes, headlines and extracted asks
 *    only (content is public on GitHub anyway — we stay bounded).
 *  · The vault DRAFTS, it never auto-answers: a suggested response is
 *    returned for the operator/agent to send deliberately. No silent
 *    writes into partner repos, ever.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { getSituationSnapshot } from "@/lib/gate/situation";

const DIGEST_REFRESH_MS = 10 * 60_000;
const SEEN_FILE = "docs/broadcast-seen.json"; // run artifact — gitignored (like docs/org-scan.json)
const MAX_REPOS = 20; // bounded — the org is 12 repos today
const ASK_LIMIT = 5;
const HEADLINE_MAX = 140;

export type BroadcastKind = "report" | "question" | "request" | "alert";

export interface DigestItem {
  repo: string;
  file: string;
  ours: boolean;
  ok: boolean;
  error?: string;
  bytes: number;
  hash: string; // full sha256
  hash8: string;
  echo: boolean; // byte-identical to our own broadcast — a mirror, not a message
  isNew: boolean; // first time this exact content is seen by the vault
  lang: "he" | "en" | "he+en" | "?";
  kind: BroadcastKind;
  headline: string;
  asks: string[]; // questions / explicit requests extracted from the body (≤ ASK_LIMIT)
  mentionsUs: boolean; // mentions our repo / the vault
}

export interface SuggestedResponse {
  needed: boolean;
  reason: string;
  toRepo?: string;
  draft?: string[]; // draft lines only — sending stays an operator/agent decision
}

export interface BroadcastDigest {
  measuredAt: string;
  cached: boolean;
  scannedRepos: number;
  fetched: number;
  failed: number;
  uniqueContents: number;
  echoesOfOurs: number;
  newPartnerContents: number;
  partnerVoices: number; // non-echo, non-ours items — a partner actually said something
  items: DigestItem[];
  suggestedResponse: SuggestedResponse;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* seen-set — which exact contents the vault has already read          */
/* ------------------------------------------------------------------ */

type SeenMap = Record<string, string>; // full sha256 → firstSeenAt ISO

async function readSeen(): Promise<SeenMap> {
  try {
    const raw = await readFile(path.join(process.cwd(), SEEN_FILE), "utf8");
    const parsed = JSON.parse(raw) as SeenMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function persistSeen(seen: SeenMap): Promise<void> {
  try {
    await mkdir(path.join(process.cwd(), "docs"), { recursive: true });
    await writeFile(path.join(process.cwd(), SEEN_FILE), JSON.stringify(seen, null, 1), "utf8");
  } catch { /* disk best-effort — honesty survives a lost seen-file */ }
}

/* ------------------------------------------------------------------ */
/* content fetch + classification                                      */
/* ------------------------------------------------------------------ */

function githubHeaders(token: string): HeadersInit {
  return { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "User-Agent": "saos-comprehension-plane" };
}

async function readGithubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  try {
    const raw = (await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8")).trim();
    const line = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => /^ghp_|^github_pat_/.test(l));
    return line ?? null;
  } catch {
    return null;
  }
}

async function fetchBroadcastContent(token: string, org: string, repo: string, file: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${org}/${repo}/contents/broadcasts/${encodeURIComponent(file)}`, {
      headers: githubHeaders(token),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content?: string; encoding?: string };
    if (j.encoding !== "base64" || typeof j.content !== "string") return null;
    return Buffer.from(j.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function classify(content: string): Pick<DigestItem, "lang" | "kind" | "headline" | "asks" | "mentionsUs"> {
  const heChars = (content.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latinChars = (content.match(/[A-Za-z]/g) ?? []).length;
  const lang: DigestItem["lang"] = heChars > 40 && latinChars > 40 ? "he+en" : heChars > 40 ? "he" : latinChars > 40 ? "en" : "?";

  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const heading = lines.find((l) => /^#{1,3}\s/.test(l));
  const headline = ((heading ?? lines[0] ?? "(empty)").replace(/^#{1,3}\s*/, "").slice(0, HEADLINE_MAX)) || "(empty)";

  const askRe = /\?|מבקשים|מבקש|נדרש|בבקשה|בקשה|תשובה|לענות|request|please|respond|reply|answer|needed/i;
  const urgentRe = /דחוף|בהול|מיידי|urgent|asap|critical/i;
  const asks = lines.filter((l) => askRe.test(l)).slice(0, ASK_LIMIT).map((l) => (l.length > 180 ? `${l.slice(0, 177)}…` : l));

  const kind: BroadcastKind = urgentRe.test(content) ? "alert" : asks.length > 0 ? (/(request|בקשה|מבקש|נדרש)/i.test(content) ? "request" : "question") : "report";

  const mentionsUs = /Saosmartwallet|כספת|vault/i.test(content);
  return { lang, kind, headline, asks, mentionsUs };
}

/* ------------------------------------------------------------------ */
/* the digest — stale-while-revalidate, in-memory lock                 */
/* ------------------------------------------------------------------ */

type DigestCache = { digest: BroadcastDigest; refreshing: boolean };
const g = globalThis as unknown as { __saosDigestCache?: DigestCache };

async function buildDigest(): Promise<BroadcastDigest> {
  // 1) the broadcast LIST rides the situation plane (already 10-min fresh)
  const sit = await getSituationSnapshot().catch(() => null);
  const lists = sit?.repos.ok ? sit.repos.broadcasts.filter((b) => b.count > 0 && b.latest).slice(0, MAX_REPOS) : [];
  if (!sit || !sit.repos.ok) {
    return emptyDigest("situation plane unavailable — the digest reads only what the situation plane hears");
  }

  // 2) our own repo's content = the echo reference
  const token = await readGithubToken();
  if (!token) return emptyDigest("no github token — the vault cannot read broadcast content");

  const ours = lists.find((b) => b.ours);
  const ourHash = ours ? await fetchBroadcastContent(token, sit.repos.org, ours.repo, ours.latest as string).then((c) => (c ? createHash("sha256").update(c).digest("hex") : null)) : Promise.resolve(null);
  const oursRef = await ourHash;

  // 3) fetch every partner's latest broadcast content — bounded, honest per repo
  const seen = await readSeen();
  const nowIso = new Date().toISOString();
  const nextSeen: SeenMap = { ...seen };

  const items: DigestItem[] = await Promise.all(
    lists.map(async (b): Promise<DigestItem> => {
      const file = b.latest as string;
      const content = await fetchBroadcastContent(token, sit.repos.org, b.repo, file);
      if (content === null) {
        return { repo: b.repo, file, ours: b.ours, ok: false, error: "content fetch failed honestly", bytes: 0, hash: "", hash8: "", echo: false, isNew: false, lang: "?", kind: "report", headline: "(unavailable)", asks: [], mentionsUs: false };
      }
      const hash = createHash("sha256").update(content).digest("hex");
      const echo = !b.ours && oursRef !== null && hash === oursRef;
      const isNew = !Object.prototype.hasOwnProperty.call(seen, hash);
      if (isNew) nextSeen[hash] = nowIso;
      return { repo: b.repo, file, ours: b.ours, ok: true, bytes: Buffer.byteLength(content, "utf8"), hash, hash8: hash.slice(0, 8), echo, isNew, ...classify(content) };
    })
  );

  await persistSeen(nextSeen);

  const okItems = items.filter((i) => i.ok);
  const partnerVoices = okItems.filter((i) => !i.ours && !i.echo);
  const unique = new Set(okItems.map((i) => i.hash));

  // 4) draft-only response: answer a partner voice's asks; echoes need no answer
  let suggestedResponse: SuggestedResponse;
  const asking = partnerVoices.filter((i) => i.asks.length > 0);
  if (partnerVoices.length === 0) {
    suggestedResponse = { needed: false, reason: "רק הדים של הדוח שלנו בערוץ — אין קול-שותף להשיב לו (כנות: הערוץ עדיין חד-כיווני)" };
  } else if (asking.length === 0) {
    suggestedResponse = { needed: false, reason: `קול-שותף נשמע (${partnerVoices.map((i) => i.repo).join(", ")}) אבל אין שאלה/בקשה מפורשת — אין מה להשיב` };
  } else {
    const first = asking[0];
    suggestedResponse = {
      needed: true,
      reason: `שאלות/בקשות זוהו בשידור של ${first.repo} — טיוטה מוצעת בלבד; השליחה היא החלטת-מפעיל/סוכן`,
      toRepo: first.repo,
      draft: first.asks.map((a) => `ראינו את השידור שלכם (${first.file}) — לגבי "${a.slice(0, 80)}": הכספת על הקו בערוץ broadcasts/ שלנו; נשיב מתוך אמת-חיה, לא מהנחות.`),
    };
  }

  return {
    measuredAt: nowIso,
    cached: false,
    scannedRepos: lists.length,
    fetched: okItems.length,
    failed: items.length - okItems.length,
    uniqueContents: unique.size,
    echoesOfOurs: okItems.filter((i) => i.echo).length,
    newPartnerContents: partnerVoices.filter((i) => i.isNew).length,
    partnerVoices: partnerVoices.length,
    items,
    suggestedResponse,
  };
}

function emptyDigest(error: string): BroadcastDigest {
  return { measuredAt: new Date().toISOString(), cached: false, scannedRepos: 0, fetched: 0, failed: 0, uniqueContents: 0, echoesOfOurs: 0, newPartnerContents: 0, partnerVoices: 0, items: [], suggestedResponse: { needed: false, reason: "הערוץ לא נקרא — ראה שדה השגיאה הכנה" }, error };
}

export async function getBroadcastDigest(force = false): Promise<BroadcastDigest> {
  const cache = g.__saosDigestCache;
  const stale = !cache || Date.now() - Date.parse(cache.digest.measuredAt) > DIGEST_REFRESH_MS;

  if (!force && cache && stale && !cache.refreshing) {
    // stale-while-revalidate: serve the last honest read, re-read in background —
    // the org API is never hammered, the caller is never blocked (r22 pattern).
    cache.refreshing = true;
    void buildDigest()
      .then((d) => { g.__saosDigestCache = { digest: d, refreshing: false }; })
      .catch(() => { if (g.__saosDigestCache) g.__saosDigestCache.refreshing = false; });
  }

  if (force || !cache) {
    const digest = await buildDigest();
    g.__saosDigestCache = { digest, refreshing: false };
    return digest;
  }
  return { ...cache.digest, cached: true };
}
