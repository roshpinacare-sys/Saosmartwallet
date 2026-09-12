import { db } from "@/lib/db";
import { sealSecret, GateError, masterReady } from "@/lib/gate/crypto";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { identifyKey, wifToChainPub, tokenFingerprint } from "@/lib/gate/key-id";
import { unzipSync } from "fflate";

export const runtime = "nodejs";

/**
 * r39 KEY INTAKE — "אני אשלח לך עוד מפתחות אז תתכונן" (operator directive).
 *
 * POST /api/gate/keys-batch — operator only. The READY door for the next
 * batch of keys, however the operator carries them:
 *   { mode: "scan", text?, zipUrl? }  → identify every candidate LIVE, dedup
 *                                       against the vault, and REPORT — seals nothing.
 *   { mode: "seal", text?, zipUrl?, take?: string[] } → seal ONLY the confirmed
 *                                       candidates (by their scan hash), each with a
 *                                       live-verified identity; honest per-line report.
 *
 * Sources: multiline TEXT (one secret per line — WIF / 0x-hex / 64-hex / 12-24
 * word mnemonic / ghp_ PAT) and/or a ZIP URL (github raw / any direct link) —
 * the archive is downloaded, decompressed in-memory, and every text-ish file
 * inside is scanned line-by-line. Binary files are counted and skipped honestly.
 * NO secret is ever echoed back — only masked previews + public identities.
 */

const MAX_ZIP_BYTES = 64 * 1024 * 1024; // 64MB — enough for any wallet backup, small enough to stay sane
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_FILES_SCANNED = 400;

interface Candidate {
  hash: string; // stable id used by the operator to confirm ("take")
  kind: string;
  preview: string; // masked — first 4 chars + length; NEVER the secret
  lines: string; // where it came from (file/line)
  secret: string; // server-side only — stripped before the response
}

function mask(s: string): string {
  return `${s.slice(0, 4)}…(${s.length} chars)`;
}

/** cheap stable id (FNV-1a 32bit, hex) — enough to bind "take" to a scanned candidate */
function stableId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Extract secret-like candidates from one text blob. */
function scanText(text: string, origin: string, out: Candidate[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.length < 12) continue;
    // strip common "LABEL=secret" / "LABEL: secret" prefixes
    const val = raw.replace(/^\s*[A-Za-z0-9_\- ]{1,32}\s*[=:]\s*/, "");
    const isWif = /^(5[1-9A-HJ-NP-Za-km-z]{50}|[KL][1-9A-HJ-NP-Za-km-z]{51})$/.test(val);
    const isEvm = /^0x[0-9a-fA-F]{64}$/.test(val);
    const isHex = /^[0-9a-fA-F]{64}$/.test(val);
    const isPat = /^(ghp_|github_pat_)[A-Za-z0-9_]+$/.test(val);
    // r40: NVIDIA NIM keys (nvapi-…) — the fleet's brain provider rides the same intake.
    const isNvapi = /^nvapi-[A-Za-z0-9_-]{16,}$/.test(val);
    const ws = val.toLowerCase().split(/\s+/);
    const isMnemonic = ws.length >= 12 && ws.length <= 24 && ws.length % 3 === 0 && ws.every((w) => /^[a-z]+$/.test(w));
    if (!isWif && !isEvm && !isHex && !isPat && !isNvapi && !isMnemonic) continue;
    const kind = isWif ? "steem-wif" : isEvm ? "evm-key" : isHex ? "hex-priv" : isPat ? "github-pat" : isNvapi ? "nvidia-api" : "mnemonic";
    out.push({ hash: stableId(val), kind, preview: mask(val), lines: `${origin}:${i + 1}`, secret: val });
  }
}

async function loadZipTexts(zipUrl: string): Promise<{ texts: { name: string; text: string }[]; skipped: number }> {
  const res = await fetch(zipUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new GateError("bad-input", `הורדת ה-zip נכשלה: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_ZIP_BYTES) throw new GateError("bad-input", `הארכיון גדול מדי (${Math.round(buf.length / 1e6)}MB) — התקרה 64MB`);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf);
  } catch {
    throw new GateError("bad-input", "הקובץ אינו zip תקין (או ארכיון-מוצפן — אינו נתמך, בכנות)");
  }
  const texts: { name: string; text: string }[] = [];
  let skipped = 0;
  for (const [name, data] of Object.entries(entries)) {
    if (data.length > MAX_TEXT_BYTES || texts.length >= MAX_FILES_SCANNED) {
      skipped++;
      continue;
    }
    // text-ish sniff: NUL byte in the first 512 bytes → binary, skip honestly
    const probe = data.slice(0, 512);
    if (probe.includes(0)) {
      skipped++;
      continue;
    }
    try {
      texts.push({ name, text: new TextDecoder("utf-8", { fatal: false }).decode(data) });
    } catch {
      skipped++;
    }
  }
  return { texts, skipped };
}

type Ctrl = { chain: string | null; account: string | null; role: string | null; pub: string | null };

/** r40-truth-audit: a pasted string that merely LOOKS like a WIF must never
 *  crash the scan (bs58 checksum throws) — degrade to "unverified" honestly. */
function safeWifPub(secret: string): string | null {
  try {
    return wifToChainPub(secret);
  } catch {
    return null;
  }
}

function kindOf(k: string): string {
  if (k === "steem-wif") return "steem-key";
  if (k === "evm-key" || k === "hex-priv") return "evm-key";
  if (k === "mnemonic") return "mnemonic";
  if (k === "github-pat") return "token";
  if (k === "nvidia-api") return "token";
  return "note";
}

export async function POST(req: Request) {
  try {
    await requireOperator();
    const body = (await req.json()) as { mode?: string; text?: string; zipUrl?: string; take?: string[] };
    const mode = body.mode === "seal" ? "seal" : "scan";
    if (!body.text?.trim() && !body.zipUrl?.trim())
      throw new GateError("bad-input", "דרוש text (שורות-מפתחות) או zipUrl — לפחות מקור אחד");
    if (mode === "seal" && !masterReady())
      throw new GateError("vault-locked", "הכספת נעולה — פתח אותה כדי לאטום מפתחות חדשים");

    /* 1) gather candidates */
    const candidates: Candidate[] = [];
    const meta: Record<string, unknown> = {};
    if (body.text?.trim()) {
      if (body.text.length > MAX_TEXT_BYTES) throw new GateError("bad-input", "הטקסט ארוך מדי (תקרה 2MB)");
      scanText(body.text, "text", candidates);
      meta.textCandidates = candidates.length;
    }
    if (body.zipUrl?.trim()) {
      const { texts, skipped } = await loadZipTexts(body.zipUrl.trim());
      const before = candidates.length;
      for (const t of texts) scanText(t.text, t.name, candidates);
      meta.zipFiles = texts.length;
      meta.zipSkippedBinary = skipped;
      meta.zipCandidates = candidates.length - before;
    }
    if (!candidates.length) {
      return ok({ mode, found: 0, items: [], meta, note: "לא נמצאו מועמדים שנראים כמפתחות במקורות שנסרקו — כנות מלאה" });
    }

    /* 2) identify EVERY candidate live + dedup against the vault */
    const existing = await db.vaultEntry.findMany({ select: { id: true, kind: true, chain: true, account: true, role: true, pub: true } });
    const seen = new Set<string>();
    const items: Record<string, unknown>[] = [];
    for (const c of candidates) {
      if (seen.has(c.hash)) continue; // same secret twice in the batch
      seen.add(c.hash);
      let identity: Awaited<ReturnType<typeof identifyKey>> | null = null;
      try {
        identity = await identifyKey(c.secret);
      } catch {
        identity = null;
      }
      const pubs = identity?.pubs || [];
      let dupOf: string | null = null;
      if (c.kind === "steem-wif") {
        const pub = safeWifPub(c.secret);
        const hit = pub ? existing.find((e) => e.pub === pub) : undefined;
        if (hit) dupOf = [hit.chain, hit.account, hit.role].filter(Boolean).join("/");
      } else if (pubs.length) {
        const hit = existing.find((e) => e.pub && pubs.includes(e.pub));
        if (hit) dupOf = [hit.chain, hit.account, hit.role].filter(Boolean).join("/");
      }
      items.push({
        hash: c.hash,
        kind: c.kind,
        preview: c.preview,
        from: c.lines,
        liveChecked: identity?.liveChecked ?? false,
        label: identity?.label ?? "לא זוהה",
        controls: identity?.controls ?? [],
        notes: identity?.notes ?? [],
        dupOf,
      });
    }

    /* 3a) scan — report only, seal nothing */
    if (mode === "scan") {
      return ok({
        mode,
        found: items.length,
        items, // identity + masked preview — zero secrets
        meta,
        note: "סריקה-בלבד: כלום לא נאטם עד שתאשר. שלח mode:'seal' עם take:[hashes] כדי לאטום את שאישרת.",
      });
    }

    /* 3b) seal — only the confirmed hashes, each with its live identity */
    const take = new Set((body.take || []).map(String));
    const sealed: Record<string, unknown>[] = [];
    let created = 0;
    for (const it of items) {
      if (!take.has(String(it.hash))) continue;
      const c = candidates.find((x) => x.hash === it.hash)!;
      const controls = (it.controls as Ctrl[]) || [];
      const targets: Ctrl[] = controls.length
        ? controls
        : c.kind === "nvidia-api"
          ? // r40: NVIDIA keys anchor to the nvidia-nim slot with a non-reversible
            // fingerprint as pub — the brain's multi-key pool and re-scan dedup both read it.
            [{ chain: "nvidia", account: "nvidia-nim", role: "token", pub: tokenFingerprint(c.secret) }]
          : [{ chain: c.kind === "github-pat" ? "github" : null, account: null, role: c.kind === "mnemonic" ? "doors" : "wallet", pub: null }];
      for (const t of targets) {
        const dup = existing.find((e) => e.kind === kindOf(c.kind) && e.chain === t.chain && e.account === t.account && e.role === t.role && e.pub === t.pub);
        if (dup) continue;
        const status = it.liveChecked && controls.length ? "verified" : "imported";
        const s = sealSecret(c.secret);
        const pub = t.pub ?? (c.kind === "steem-wif" ? safeWifPub(c.secret) : null);
        const row = await db.vaultEntry.create({
          data: {
            kind: kindOf(c.kind),
            chain: t.chain,
            account: t.account,
            role: t.role,
            pub,
            status,
            verifyNote: `keys-batch r39 (${body.zipUrl ? "zip" : "text"}) — ${status === "verified" ? "אומת live" : "יובא ללא-אימות-חי"} · ${String(it.label)}`,
            source: "keys-batch",
            verifiedAt: status === "verified" ? new Date() : null,
            ...s,
          },
        });
        existing.push({ id: row.id, kind: kindOf(c.kind), chain: t.chain, account: t.account, role: t.role, pub });
        created++;
        sealed.push({ hash: it.hash, id: row.id, chain: t.chain, account: t.account, role: t.role, status });
      }
    }
    if (created) {
      await db.gateMessage.create({
        data: { fromKind: "system", fromName: "gate", body: `יבוא-מרובה r39: ${created} סודות חדשים נאטמו בכספת מתוך ${items.length} מועמדים שסרוקים (${body.zipUrl ? "ארכיון" : "טקסט"})` },
      });
    }
    return ok({
      mode,
      found: items.length,
      created,
      sealed,
      items,
      meta,
      note: created
        ? `${created} נאטמו מוצפנים — בדוח זהות ציבורית בלבד (אפס-סודות בפלט)`
        : "שום דבר לא נאטם — לא נשלחו hash-אישורים תואמים (או שהכול כפילויות)",
    });
  } catch (e) {
    return fail(e);
  }
}
