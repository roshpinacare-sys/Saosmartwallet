/**
 * THE COMPREHENSION PLANE (r25) + THE FRONT-DOOR PLANE (r26).
 * ==========================================================
 * r23 gave the fleet a voice (we pushed our report into every partner
 * repo), r24 gave the vault ears (incoming broadcast watch). But ears
 * that only count files are still deaf: r25 fetches each broadcast's
 * CONTENT (bounded: latest file per repo, ~12 calls on the same 10-min
 * cadence), hashes it, detects echoes of our own report, classifies
 * what a partner actually said (report / question / request / alert),
 * extracts their asks, and — draft-only — builds a suggested response.
 *
 * r26 — the front-door plane: the network answered. The platform agent
 * pushed its response INTO OUR OWN repo's broadcasts/ folder (not its
 * own repo) — a door knock the r25 digest was structurally blind to,
 * because it trusted "our repo = our voice". It also revealed the
 * root-voice pattern: partners (foundry, Adsmarket, jummper) push
 * reports into OUR repo ROOT instead of broadcasts/. So r26 adds:
 *  · DOOR WATCH: our own broadcasts/ is scanned as a door — any file
 *    that is not authored-by-us (name not matching our vault-report
 *    convention AND hash ≠ our authored report) is an incoming voice.
 *  · ROOT-VOICE WATCH: our repo root is scanned for partner reports
 *    that bypass the broadcasts/ channel (bounded: infra files
 *    excluded, ≤4 newest fetched).
 *  · kind "response": a broadcast that answers us is classified as
 *    such, and the suggested-response drafts an acknowledgment.
 *  · echo-reference fix: our echo baseline is our AUTHORED report
 *    (name convention), never our repo's "latest" file — a partner
 *    response at our door can no longer break echo detection.
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
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { getSituationSnapshot } from "@/lib/gate/situation";

const DIGEST_REFRESH_MS = 10 * 60_000;
const SEEN_FILE = "docs/broadcast-seen.json"; // run artifact — gitignored (like docs/org-scan.json)
const MAX_REPOS = 20; // bounded — the org is 12 repos today
const ASK_LIMIT = 5;
const HEADLINE_MAX = 140;
const MAX_DOOR_VOICES = 3; // bounded — newest non-ours files fetched at our door
const MAX_ROOT_VOICES = 4; // bounded — newest root candidates fetched

/** our authored broadcast naming convention — a door file NOT matching this is not ours by name */
const OUR_BROADCAST_NAME = /^\d{4}-\d{2}-\d{2}-vault-(report|ack|reply)\.md$/;

/**
 * r27-finalization — identity by FINGERPRINT, not only by name.
 * Our own authored docs (e.g. the r27 efficiency broadcast, whose name is not
 * vault-*) land in our own door and used to be miscounted as knocks.
 * Fix: hash every file in our local docs/broadcast/ at read time — any door
 * voice whose content hash matches one of those is OURS, whatever its name.
 * Honest and generic: zero secrets, zero extra API calls, works for any
 * future authored doc. If the local dir is unreadable the set is empty and
 * behavior degrades to name-only (exactly the pre-fix behavior).
 */
async function readOurFingerprints(): Promise<Set<string>> {
  const fingerprints = new Set<string>();
  try {
    const dir = path.join(process.cwd(), "docs", "broadcast");
    const entries = await readdir(dir).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((f) => f.endsWith(".md"))
        .map(async (f) => {
          try {
            const c = await readFile(path.join(dir, f), "utf8");
            fingerprints.add(createHash("sha256").update(c).digest("hex"));
          } catch {
            /* one unreadable file never kills the set */
          }
        })
    );
  } catch {
    /* identity degrades honestly to name-only */
  }
  return fingerprints;
}
/** root files that are repo infrastructure, never partner voices */
const ROOT_INFRA = new Set(["README.md", "worklog.md", "SECURITY.md", "Caddyfile"]);
/** a root *.md file whose name smells like a dropped report/briefing */
const ROOT_VOICE_NAME = /report|briefing|daily|broadcast|status|audit|alert/i;

export type BroadcastKind = "report" | "question" | "request" | "alert" | "response";

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

/** a voice that arrived AT OUR DOOR — inside our own broadcasts/ folder, written by someone else.
 *  selfEcho (r27): the hash matched our own authored docs — our own broadcast record, not a knock. */
export interface DoorVoice {
  file: string;
  ok: boolean;
  error?: string;
  bytes: number;
  hash: string;
  hash8: string;
  isNew: boolean;
  selfEcho: boolean;
  lang: "he" | "en" | "he+en" | "?";
  kind: BroadcastKind;
  headline: string;
  asks: string[];
  mentionsUs: boolean;
}

/** a voice that bypassed the channel — a partner report dropped at our repo ROOT */
export interface RootVoice {
  file: string;
  ok: boolean;
  error?: string;
  bytes: number;
  hash: string;
  hash8: string;
  looksLikeReport: boolean; // name matched the report/briefing pattern
  isNew: boolean;
  headline: string;
  mentionsUs: boolean;
}

export interface DoorPlane {
  checked: boolean;
  error?: string;
  files: number; // total files at our door
  oursFiles: number; // files authored by us — by name convention OR by fingerprint (r27)
  selfEchoVoices: number; // r27 — our own broadcast records seen on the door (fingerprint match)
  incoming: number; // genuine knocks: not ours by name AND not ours by fingerprint
  voices: DoorVoice[]; // fetched (bounded ≤ MAX_DOOR_VOICES)
}

export interface RootPlane {
  checked: boolean;
  error?: string;
  scanned: number; // root *.md files seen (after infra exclusion)
  voices: RootVoice[]; // fetched (bounded ≤ MAX_ROOT_VOICES)
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
  door: DoorPlane; // r26 — who knocked at our own door
  rootVoices: RootPlane; // r26 — who bypassed the channel and dropped at our root
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

async function fetchGithubContent(token: string, org: string, repo: string, dir: string, file: string): Promise<string | null> {
  try {
    const p = dir ? `${dir}/${encodeURIComponent(file)}` : encodeURIComponent(file);
    const res = await fetch(`https://api.github.com/repos/${org}/${repo}/contents/${p}`, {
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

const fetchBroadcastContent = (token: string, org: string, repo: string, file: string) => fetchGithubContent(token, org, repo, "broadcasts", file);

/** list a directory — names only, bounded (Contents API has no timestamps; name-sort ≈ time-sort for ISO-prefixed names) */
async function listGithubDir(token: string, org: string, repo: string, dir: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${org}/${repo}/contents/${dir}`, {
      headers: githubHeaders(token),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Array<{ name?: string; type?: string }>;
    if (!Array.isArray(j)) return null;
    return j.filter((f) => f.type === "file" && typeof f.name === "string").map((f) => f.name as string).sort().reverse();
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

  const isResponse = /תגובה|response|reply/i.test(headline) || /^(?:#|>)?\s*(?:📡\s*)?תגובת/i.test(content.trim().slice(0, 200));
  const kind: BroadcastKind = isResponse
    ? "response"
    : urgentRe.test(content)
      ? "alert"
      : asks.length > 0
        ? (/(request|בקשה|מבקש|נדרש)/i.test(content) ? "request" : "question")
        : "report";

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

  // 2) our own repo — r26: the door. List our broadcasts/ + root, split authored vs incoming.
  const token = await readGithubToken();
  if (!token) return emptyDigest("no github token — the vault cannot read broadcast content");

  const ours = lists.find((b) => b.ours);
  const org = sit.repos.org;
  const door: DoorPlane = { checked: false, files: 0, oursFiles: 0, selfEchoVoices: 0, incoming: 0, voices: [] };
  const rootVoices: RootPlane = { checked: false, scanned: 0, voices: [] };
  let ourAuthoredFile: string | null = null;
  const seen = await readSeen();
  const nowIso = new Date().toISOString();
  const nextSeen: SeenMap = { ...seen };

  if (ours) {
    // 2a) our door: list our broadcasts/ — authored = our name convention; everything else = a knock
    //     r27-finalization: a knock whose CONTENT hash matches one of our local authored docs is
    //     OURS (self-echo on the door, e.g. our efficiency broadcast) — not a knock anymore.
    const [doorFiles, ourFingerprints] = await Promise.all([
      listGithubDir(token, org, ours.repo, "broadcasts"),
      readOurFingerprints(),
    ]);
    if (doorFiles === null) {
      door.error = "our broadcasts/ listing failed honestly — the door stays unwatched this round";
    } else {
      door.checked = true;
      door.files = doorFiles.length;
      const authored = doorFiles.filter((f) => OUR_BROADCAST_NAME.test(f));
      ourAuthoredFile = authored[0] ?? null; // name-sorted desc → newest authored report
      const knocks = doorFiles.filter((f) => !OUR_BROADCAST_NAME.test(f));
      const seen2 = seen; // capture for isNew before merging
      door.voices = await Promise.all(
        knocks.slice(0, MAX_DOOR_VOICES).map(async (file): Promise<DoorVoice> => {
          const content = await fetchBroadcastContent(token, org, ours.repo, file);
          if (content === null) {
            return { file, ok: false, error: "content fetch failed honestly", bytes: 0, hash: "", hash8: "", isNew: false, selfEcho: false, lang: "?", kind: "report", headline: "(unavailable)", asks: [], mentionsUs: false };
          }
          const hash = createHash("sha256").update(content).digest("hex");
          const selfEcho = ourFingerprints.has(hash);
          const isNew = !Object.prototype.hasOwnProperty.call(seen2, hash) && !selfEcho; // our own records never count as new
          if (isNew) nextSeen[hash] = nowIso;
          return { file, ok: true, bytes: Buffer.byteLength(content, "utf8"), hash, hash8: hash.slice(0, 8), isNew, selfEcho, ...classify(content) };
        })
      );
      const selfEchoCount = door.voices.filter((v) => v.ok && v.selfEcho).length;
      door.selfEchoVoices = selfEchoCount;
      door.oursFiles = authored.length + selfEchoCount;
      door.incoming = knocks.length - selfEchoCount;
    }

    // 2b) root voices: partners who bypass the channel and drop reports at our repo root
    const rootFiles = await listGithubDir(token, org, ours.repo, "");
    if (rootFiles === null) {
      rootVoices.error = "root listing failed honestly — root stays unwatched this round";
    } else {
      rootVoices.checked = true;
      const candidates = rootFiles.filter((f) => f.endsWith(".md") && !ROOT_INFRA.has(f) && !OUR_BROADCAST_NAME.test(f));
      rootVoices.scanned = candidates.length;
      const seen3 = seen;
      rootVoices.voices = await Promise.all(
        candidates.slice(0, MAX_ROOT_VOICES).map(async (file): Promise<RootVoice> => {
          const content = await fetchGithubContent(token, org, ours.repo, "", file);
          if (content === null) {
            return { file, ok: false, error: "content fetch failed honestly", bytes: 0, hash: "", hash8: "", looksLikeReport: ROOT_VOICE_NAME.test(file), isNew: false, headline: "(unavailable)", mentionsUs: false };
          }
          const hash = createHash("sha256").update(content).digest("hex");
          const isNew = !Object.prototype.hasOwnProperty.call(seen3, hash);
          if (isNew) nextSeen[hash] = nowIso;
          const cls = classify(content);
          return { file, ok: true, bytes: Buffer.byteLength(content, "utf8"), hash, hash8: hash.slice(0, 8), looksLikeReport: ROOT_VOICE_NAME.test(file), isNew, headline: cls.headline, mentionsUs: cls.mentionsUs };
        })
      );
    }
  }

  // 3) our echo reference = our AUTHORED report (r26 fix) — never our repo's latest file,
  //    which can now be a partner's response knock at our door.
  const ourHash = ours
    ? (ourAuthoredFile
        ? fetchBroadcastContent(token, org, ours.repo, ourAuthoredFile).then((c) => (c ? createHash("sha256").update(c).digest("hex") : null))
        : Promise.resolve(null))
    : Promise.resolve(null);
  const oursRef = await ourHash;

  // 4) fetch every partner's latest broadcast content — bounded, honest per repo
  const items: DigestItem[] = await Promise.all(
    lists.map(async (b): Promise<DigestItem> => {
      const file = b.ours && ourAuthoredFile ? ourAuthoredFile : (b.latest as string);
      const content = await fetchBroadcastContent(token, org, b.repo, file);
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
  const doorNewVoices = door.voices.filter((v) => v.ok && v.isNew && !v.selfEcho); // our own records never count as new partner voices
  const rootNewVoices = rootVoices.voices.filter((v) => v.ok && v.isNew);

  // 5) draft-only response: answer a partner voice's asks / acknowledge a door response
  let suggestedResponse: SuggestedResponse;
  const doorResponse = door.voices.find((v) => v.ok && v.kind === "response" && !v.selfEcho);
  const asking = partnerVoices.filter((i) => i.asks.length > 0);
  if (doorResponse) {
    suggestedResponse = {
      needed: doorResponse.isNew,
      reason: doorResponse.isNew
        ? `תגובת-שותף נחתה בדלת-שלנו (${doorResponse.file}) — הכספת מציעה טיוטת-אישור-קבלה; השליחה החלטת-מפעיל/סוכן`
        : `תגובת-הדלת כבר נקראה ונענתה (${doorResponse.file})`,
      toRepo: "saos-sovereign-platform",
      draft: doorResponse.isNew
        ? [
            `נקרא במלואו ונקלט — תגובתכם (${doorResponse.file}) נחתה בדלת-שלנו וזוהתה חיה ע"י מישור-הדלת-הקדמית (r26).`,
            "אימצנו את הערוץ-הדו-כיווני: מעתה הדלת-שלנו נסרקת בכל-מחזור-קריאה — תגובה-חדשה מדליקה NEW פעם-אחת.",
            "נרשם אצלנו: חוזה-החתימה 1/6 שלכם (gap #34) — אנחנו תומכים בהמלצת שדרן-אחד-לאחוזה ומחכים להחלטת-הבעלים.",
            "פער-נורמליזציה שרשמנו על-עצמנו: הערוץ-הדו-כיווני קיים אך מקום-השידור לא אחיד (broadcasts/ מול שורש-ריפו) — אנו מזהים-גם-גם, ומבקשים: לריפו-המקבל ב-broadcasts/.",
          ]
        : undefined,
    };
  } else if (partnerVoices.length === 0 && doorNewVoices.length === 0 && rootNewVoices.length === 0) {
    suggestedResponse = { needed: false, reason: "רק הדים של הדוח שלנו בערוץ ובדלת — אין קול-שותף להשיב לו" };
  } else if (asking.length === 0) {
    suggestedResponse = { needed: false, reason: `קול-שותף נשמע (${[...partnerVoices.map((i) => i.repo), ...doorNewVoices.map((v) => v.file), ...rootNewVoices.map((v) => v.file)].slice(0, 3).join(", ")}) אבל אין שאלה/בקשה מפורשת — אין מה להשיב` };
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
    door,
    rootVoices,
    suggestedResponse,
  };
}

function emptyDigest(error: string): BroadcastDigest {
  return { measuredAt: new Date().toISOString(), cached: false, scannedRepos: 0, fetched: 0, failed: 0, uniqueContents: 0, echoesOfOurs: 0, newPartnerContents: 0, partnerVoices: 0, items: [], door: { checked: false, files: 0, oursFiles: 0, selfEchoVoices: 0, incoming: 0, voices: [] }, rootVoices: { checked: false, scanned: 0, voices: [] }, suggestedResponse: { needed: false, reason: "הערוץ לא נקרא — ראה שדה השגיאה הכנה" }, error };
}

export async function getBroadcastDigest(force = false): Promise<BroadcastDigest> {
  const cache = g.__saosDigestCache;
  // shape-guard (r26/r27): a cache from an older module generation is not
  // an honest read — treat it as absent so the fresh code rebuilds immediately.
  // r27: the door must also carry selfEchoVoices (fingerprint identity).
  const shapeOk =
    !!cache &&
    typeof (cache.digest as { door?: unknown }).door === "object" &&
    cache.digest.door !== null &&
    typeof (cache.digest.door as { selfEchoVoices?: unknown }).selfEchoVoices === "number";
  const stale = !cache || !shapeOk || Date.now() - Date.parse(cache.digest.measuredAt) > DIGEST_REFRESH_MS;

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
