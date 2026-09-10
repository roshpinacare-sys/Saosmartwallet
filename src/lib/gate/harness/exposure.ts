/**
 * PUBLISH-DESK — exposure policy (מדיניות-חשיפה: "הקלפים נשארים בבית").
 *
 * The fleet's publishing gate: before ANY content leaves to a public chain,
 * the text is scanned for operational disclosure. This is real OPSEC
 * engineering, distilled from live findings (2026-09-10 audit): the fleet
 * had published its own internal protocol specs (SAOS-1 token+DEX plans),
 * internal fleet reports and infrastructure details to the public chain —
 * 5 near-duplicate posts on one account. Every one of those is a card
 * laid face-up on the table.
 *
 * What may never leave:
 *   · private material (WIFs, seed phrases, tokens, passwords, PATs)
 *   · infrastructure topology (paths, ports, hosts, endpoints, DB files)
 *   · internal project codenames & unreleased plans (tokens, DEX, protocol
 *     internals) — strategy is disclosed by the OPERATOR, on purpose, or
 *     not at all
 *   · operator-identifying material
 *
 * Findings are returned REDACTED (first 6 chars + "…") — the scanner itself
 * must never echo a secret into a report or a bridge message.
 */
import { GateError } from "@/lib/gate/crypto";

export type ExposureRisk = "clean" | "medium" | "high";

export interface ExposureFinding {
  kind: string;
  why: string; // Hebrew — shown to the maker so it can FIX the draft itself
  redacted: string; // never echoes the full secret
}

export interface ExposureReport {
  risk: ExposureRisk;
  findings: ExposureFinding[];
}

interface Rule {
  kind: string;
  pattern: RegExp;
  severity: Exclude<ExposureRisk, "clean">;
  why: string;
}

const RULES: Rule[] = [
  // ── outward language routing (ניתוב-שפה) ─────────────────────────────────
  // roast-2026-09-10: the language doctrine lived only in PROMPTS — the editor
  // itself published a HEBREW remediation notice (post-mtusiimi) and left a
  // Hebrew title live (post-mtuvl028) straight through the exposure gate.
  // Language routing is now enforced in CODE: anything leaving to a public
  // chain must be in the audience's language — English. Hebrew stays inside.
  {
    kind: "outward-language",
    pattern: /[\u0590-\u05FF]/g,
    severity: "high",
    why: "תוכן-החוצה כתוב בעברית — ניתוב-שפה: הקהל ברשת דובר-אנגלית; כתוב את התוכן באנגלית (עברית נשארת בפנים בלבד)",
  },

  // ── private material ────────────────────────────────────────────────────
  {
    kind: "wif-private-key",
    // secp256k1 WIF: 5J/5K/5H… (51) · compressed K/L… (52) · EOS-family EV/EK (51)
    pattern: /\b(?:5[HJK][1-9A-Za-z]{48,49}|[KL][1-9A-Za-z]{50,51}|E[VK][1-9A-Za-z]{48,49})\b/g,
    severity: "high",
    why: "נראה כמפתח-פרטי (WIF) — מפתח-פרטי אסור לעולם לצאת לשרשרת ציבורית",
  },
  {
    kind: "hex-private-key",
    pattern: /\b0x[0-9a-fA-F]{64}\b/g,
    severity: "high",
    why: "מחרוזת הקס באורך מפתח-פרטי של EVM — אסור בפרסום",
  },
  {
    kind: "seed-phrase",
    pattern: /\b(mnemonic|seed phrase|ביטוי-זרע|משפט-זרע|מפתח-אב)\b/i,
    severity: "high",
    why: "אזכור חומר-זרע/מפתח-אב — לא יוצא החוצה גם כאזכור מבני",
  },
  {
    kind: "github-pat",
    pattern: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    severity: "high",
    why: "נראה כטוקן GitHub — אסור בפרסום",
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    severity: "high",
    why: "נראה כ-JWT/סשן — אסור בפרסום",
  },
  {
    kind: "credential-marker",
    pattern: /(?:password|passphrase|secret[_ -]?key|bearer\s+[A-Za-z0-9._-]{16,}|x-gate-token|authorization\s*:)/i,
    severity: "high",
    why: "סימון-אישורים (סיסמה/טוקן/כותרת-הרשאה) — לא יוצא לשרשרת",
  },
  {
    kind: "long-base64-blob",
    pattern: /\b[A-Za-z0-9+/]{60,}={0,2}\b/g,
    severity: "medium",
    why: "בלוק base64 ארוך — עלול להיות חומר-סודי; אם זה תוכן לגיטימי נסח אותו במילים",
  },

  // ── infrastructure topology ─────────────────────────────────────────────
  {
    kind: "internal-path",
    pattern: /(?:\/home\/[a-z]+|\/api\/gate\/|\/api\/v1\/|src\/lib\/|packages\/chains|prisma\/schema|custom\.db|\.grid98-lab|worklog\.md)/g,
    severity: "high",
    why: "נתיב פנימי של התשתית — טופולוגיית-מערכת לא יוצאת לציבור",
  },
  {
    kind: "host-or-port",
    pattern: /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|:\d{4,5}\b)/g,
    severity: "medium",
    why: "מארח/פורט פנימי — לא מפרסמים טופולוגיה",
  },
  {
    kind: "internal-endpoints",
    pattern: /(?:STEEM_RPC_URL|HIVE_RPC|rpcUrl|XTransformPort|env var|\.env\b)/g,
    severity: "medium",
    why: "פרטי-תצורה פנימיים — לא לפרסם",
  },

  // ── internal codenames & unreleased plans ───────────────────────────────
  {
    kind: "internal-codename",
    pattern: /\b(?:SAOS[- ]?\d?|SOVEREIGN[- ](?:HAND|VOICE|EYES|GATE)|Grid98|grid98|GATE[- ]HEART|GateState|GateOrder|GateAction)\b/gi,
    severity: "high",
    why: "שם-קוד פנימי של הרשת — תוכניות ושמות-פרויקט נחשפים רק בהחלטת-מפעיל, לא בפרסום-אוטונומי",
  },
  {
    kind: "internal-ops-hebrew",
    pattern: /(?:דוח[- ]צי|כספת[- ]ריבונית|מפתח[- ]posting|מפתח[- ]active|מפתח[- ]owner|מפתח[- ]פרטי|המפעיל שלי|הריפו שלנו|הסוכנים שלי)/g,
    severity: "high",
    why: "מונח מבצעי פנימי — פרטי-הרשת נשארים בבית",
  },
  {
    kind: "unreleased-plans",
    pattern: /\b(?:טוקן שאנחנו בונים|הדקס שלנו|מטבע פנימי|token we are building|our own dex|our token)\b/i,
    severity: "high",
    why: "תוכניות-מוצר שלא יצאו לאור — לא מפרסמים מה לא יצא",
  },

  // ── solicitation (roast r6: the gate never learned its own worst incident) ─
  // The r2 incident — posts inviting strangers to send STEEM with a memo —
  // was remediated BY HAND, but no rule was added: the gate kept publishing
  // the exact pattern that read as an investment pitch to every passer-by.
  // Now it is a rule: any "send/transfer/deposit <coin> … wallet/memo/address"
  // phrasing is HIGH and blocked in autonomous publishing.
  {
    kind: "solicitation",
    pattern: /\b(?:send|sending|transfer|transferring|deposit|depositing|contribute|contributing|donate|donating)\s+(?:me\s+|us\s+|to\s+our\s+|directly\s+)?(?:\d+(?:\.\d+)?\s+)?(?:STEEM|SBD|HIVE|HBD|TRX|USDT|ETH|SOL|BTC|BNB)\b[^.?!]{0,140}\b(?:memo|wallet|address|account)\b/i,
    severity: "high",
    why: "נראה כפיתוי-העברת-מטבעות (לשלוח מטבע לארנק/מזכר) — דפוס שנקרא כמו בקשת-השקעה מכל קורא; אסור בפרסום-אוטונומי (המפעיל בלבד מכריע עניינים כאלה)",
  },

  // ── addresses (public but not for casual doxxing) ───────────────────────
  {
    kind: "evm-address",
    pattern: /\b0x[0-9a-fA-F]{40}\b/g,
    severity: "medium",
    why: "כתובת EVM — ציבורית אך לא מפרסמים כתובות-ארנק באקראי; אם זה חיוני, ציין מדוע",
  },
  {
    kind: "long-base58",
    pattern: /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/g,
    severity: "high",
    why: "מחרוזת base58 באורך מפתח-פרטי של Solana — אסור בפרסום",
  },
];

const REDACT = (s: string) => `${s.slice(0, 6)}…(${s.length} chars)`;

/** Scan text for exposure risks. Findings are redacted — secrets never echo.
 *  roast r6: one finding PER KIND (first redacted sample kept) — 16 identical
 *  rows for one Hebrew sentence is noise, not evidence; the maker reads the
 *  report, so the report shows each violation class exactly once. */
export function scanExposure(...parts: Array<string | undefined | null>): ExposureReport {
  const text = parts.filter((p) => typeof p === "string" && p.length).join("\n");
  const findings: ExposureFinding[] = [];
  const seen = new Set<string>();
  let risk: ExposureRisk = "clean";
  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const key = `${rule.kind}:${m[0]}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!findings.some((f) => f.kind === rule.kind)) {
          findings.push({ kind: rule.kind, why: rule.why, redacted: REDACT(m[0]) });
        }
      }
      if (rule.severity === "high") risk = "high";
      else if (rule.severity === "medium" && risk !== "high") risk = "medium";
      if (findings.length >= 24) return { risk, findings }; // bounded
    }
  }
  return { risk, findings };
}

/** Fail-closed publish gate: HIGH risk refuses; MEDIUM passes but is reported.
 *  roast-2026-09-10: tags were NEVER scanned — a codename tag ("saos") went
 *  out through an edit while title+body were scanned. Tags are part of the
 *  publication; they are scanned now (fail-closed). */
export function assertPublishable(title: string, body: string, tags?: string[]): ExposureReport {
  const report = scanExposure(title, body, Array.isArray(tags) ? tags.join(" ") : undefined);
  if (report.risk === "high") {
    const list = report.findings.map((f) => `· [${f.kind}] ${f.redacted} — ${f.why}`).join("\n");
    throw new GateError(
      "exposure-policy",
      `מדיניות-חשיפה חוסמת את הפרסום (הקלפים נשארים בבית). תקן את הטיוטה והגש שוב:\n${list}`,
    );
  }
  return report;
}
