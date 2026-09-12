/**
 * social-guard — r33: the mechanical style gate for EVERY public post.
 * =====================================================================
 * The operator's decree after the junk posts went live ("Exploring the
 * Latest Trends in KR", "The Rise of Hive-129948", "The Art of
 * Photography…"): nothing leaves the fleet's mouth that smells like a
 * text generator, leaks internal reporting, or chases trend tags.
 *
 * The rulebook already exists (Adsmarket: content/fleet/style-human.md).
 * This module ENFORCES it at the signing gate — a post that fails any
 * rule never reaches a key. Failures return named reasons (public-safe,
 * no content echoes) so the producing agent can rewrite honestly.
 */

import { GateError } from "../crypto";

/** Public-safe rejection: names the rule, never echoes the content. */
export class SocialContentError extends GateError {
  constructor(public reasons: string[]) {
    super("content-rejected", `התוכן נפסל-בשער-הסגנון: ${reasons.join(" · ")}`);
    this.name = "SocialContentError";
  }
}

/** Banned fingerprints — each one has marked machine-written text publicly. */
const BANNED_PHRASES: RegExp[] = [
  /\bdelve\b/i, /\btapestry\b/i, /\blandscape\b/i, /\brealm\b/i,
  /\bever[- ]evolving\b/i, /\bgame[- ]?chang/i, /\brevolutioniz/i,
  /\bseamless(ly)?\b/i, /\brobust\b/i, /\bleverage\b/i, /\bunlock\b/i,
  /\bjourney\b/i, /\bcrucial\b/i, /\bpivotal\b/i, /\bvital\b/i,
  /\bit is worth noting\b/i, /\bit is important to note\b/i,
  /\bin today's fast[- ]paced world\b/i, /\bin the digital age\b/i,
  /\bdive (deep|into)\b/i, /\bnavigat(e|ing) the\b/i, /\bembrace\b/i,
  /\bfoster\b/i, /\btestament to\b/i, /\ba beacon of\b/i,
  /\bthe power of\b/i, /\bfurthermore\b/i, /\bmoreover\b/i,
  /\bin conclusion\b/i, /\bto summarize\b/i, /\bat the end of the day\b/i,
  /\bwhen it comes to\b/i, /\bwhether you (are|'re) a\b/i,
  /\bstay tuned\b/i, /\bactionable (insights|takeaways)\b/i,
  /\bevolv(ing|ed) (dramatically|landscape)\b/i, /\bkey (discussions|factors)\b/i,
  /\bnew frontier\b/i, /\bmaking significant waves\b/i,
];

/** Internal/report-tone leaks — the feed is not the command bridge. */
const REPORT_TONE: RegExp[] = [
  /\bfleet report\b/i, /\binternal (report|note|status)\b/i,
  /\breport(ing)? to (the )?(operator|commander|bridge)\b/i,
  /\bcommand bridge\b/i, /\bthe operator\b/i, /דוח/, /דיווח/, /מפעיל/, /גשר/,
];

/** Money/payout exposure — on-chain figures of any wallet, ours or a tag's. */
const MONEY: RegExp[] = [
  /\b\d[\d,.]*\s*(STEEM|HIVE|HBD|SBD|BLURT|ETH|SOL|TRX|BTC|USDT|USDC)\b/i,
  /\bpayout\b/i, /\bbalance\b/i, /\btreasury\b/i, /\barnek\b/i, /ארנק/, /יתרה/, /תגמול/,
  /\$\s?\d[\d,.]*(k|m)?\b/i,
];

function hits(patterns: RegExp[], text: string): string[] {
  const out: string[] = [];
  for (const p of patterns) if (p.test(text)) out.push(p.source.slice(0, 40));
  return out;
}

export interface ContentVerdict {
  ok: boolean;
  reasons: string[];
}

/** Pure check — reusable by the gate AND by pre-publish tooling. */
export function judgePublicContent(input: { title: string; body: string; tags?: string[] }): ContentVerdict {
  const reasons: string[] = [];
  const text = `${input.title}\n${input.body}`;

  if (/[\u0590-\u05FF]/.test(text)) reasons.push("hebrew-in-public-feed");
  if (/[\u2014\u2013]/.test(text)) reasons.push("dash-banned");
  if (/[\u201C\u201D\u2018\u2019]/.test(text)) reasons.push("smart-quotes-banned");

  const banned = hits(BANNED_PHRASES, text);
  if (banned.length) reasons.push(`banned-clichés:${Math.min(banned.length, 3)}`);
  const report = hits(REPORT_TONE, text);
  if (report.length) reasons.push("report-tone-internal");
  const money = hits(MONEY, text);
  if (money.length) reasons.push("money-figures-exposed");

  // punctuation abuse: the operator flagged colon/quote storms
  const dbl = (text.match(/"/g) ?? []).length;
  const colons = (text.match(/:/g) ?? []).length;
  const words = Math.max(text.split(/\s+/).length, 1);
  if (dbl > 6) reasons.push("quote-storm");
  if (colons / words > 0.02 && colons > 5) reasons.push("colon-storm");

  if (input.body.trim().length < 400) reasons.push("too-thin (<400ch)");
  if ((input.tags ?? []).some((t) => /^[\u0590-\u05FF]+$/.test(t))) reasons.push("hebrew-tag");

  return { ok: reasons.length === 0, reasons };
}

/** The gate — throws SocialContentError with named reasons. */
export function requirePublicContent(input: { title: string; body: string; tags?: string[] }): void {
  const v = judgePublicContent(input);
  if (!v.ok) throw new SocialContentError(v.reasons);
}
