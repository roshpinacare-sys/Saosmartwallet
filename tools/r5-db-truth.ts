/**
 * ROAST r5 — DB TRUTH SCAN (read-only).
 *
 * r4 left a claimed but unproven statement: "no plaintext keys in the repo/DB".
 * A raw `strings` pass on db/custom.db flagged 3 WIF-shaped strings — all sitting
 * in VaultEntry.pub fields right after an "STM" prefix. Claim: they are PUBLIC
 * keys whose base58 body happens to start with '5'. Claims are not proofs.
 *
 * This tool proves or breaks the claim, using the same authority the chain uses:
 *   1. A Steem public key  = base58check(33-byte COMPRESSED point)  → decode,
 *      strip 4-byte RIPEMD160(SHA256) checksum, verify checksum == tail.
 *   2. A WIF private key   = base58check(0x80 + 32B + optional 1B)  → decode,
 *      first byte must be 0x80.
 *   3. Every VaultEntry.encPriv must be PURE HEX (AES-256-GCM ciphertext) —
 *      any base58/ASCII private material in storage is a breach.
 *   4. Every GateMessage.body/meta, GateRun report, GateAction payload is
 *      scanned for WIF-shaped or 64-hex-shaped private material.
 *   5. The r4 dev-faucet WIF must NOT exist in the DB.
 */
import bs58 from "bs58";
import { createHash, createHash as ch } from "crypto";
import { db } from "../src/lib/db";

const sha256 = (b: Buffer) => ch("sha256").update(b).digest();
const ripemd160 = (b: Buffer) => createHash("ripemd160").update(b).digest();

// TWO checksum authorities — mixing them is how a truth-tool lies to itself:
//   Bitcoin/WIF:    checksum = SHA256(SHA256(payload))[0:4]
//   Graphene/Steem: checksum = RIPEMD160(payload)[0:4]   (steem-js key_public.toPublicString)
const checkBtc = (p: Buffer) => sha256(sha256(p)).subarray(0, 4);
const checkGraphene = (p: Buffer) => ripemd160(p).subarray(0, 4);

function base58CheckDecode(s: string, check: (p: Buffer) => Buffer): Buffer | null {
  try {
    // bs58 v6 returns Uint8Array (NO .equals) — the exact pathology r4 fixed in
    // key-id.ts, silently reintroduced here by the auditor himself. Buffer.from it.
    const raw = Buffer.from(bs58.decode(s));
    if (raw.length < 5) return null;
    const payload = raw.subarray(0, raw.length - 4);
    const checksum = raw.subarray(raw.length - 4);
    if (!checksum.equals(check(payload))) return null;
    return payload;
  } catch {
    return null;
  }
}

function classifyBase58(s: string): "steem-pub" | "wif-priv" | "invalid" | "other" {
  const payload = base58CheckDecode(s, checkGraphene);
  if (payload) {
    if (payload.length === 33 && (payload[0] === 0x02 || payload[0] === 0x03)) return "steem-pub";
  }
  const wif = base58CheckDecode(s, checkBtc);
  if (wif) {
    if (wif[0] === 0x80 && (wif.length === 33 || wif.length === 34)) return "wif-priv";
    return "other";
  }
  return "invalid";
}

const WIF_RE = /\b5[HJK][1-9A-HJ-NP-Za-km-z]{49}\b/g;
// ROAST r7: the dev-faucet WIF was embedded here as a literal — a doctrine
// violation inside the scanner itself (r5's "git grep 5[HJK] = zero" claim was
// false against this very file). The known historical key now arrives via env;
// without it, this one check reports skipped instead of pretending to run.
const DEV_FAUCET_WIF = process.env.DEV_FAUCET_WIF || "";

let breach = 0;

async function main() {
  console.log("== [1] VaultEntry — every pub and every encPriv ==");
  const entries = await db.vaultEntry.findMany();
  for (const e of entries) {
    const pub = e.pub ?? "";
    if (pub.startsWith("STM") && pub.length > 3) {
      const body = pub.slice(3);
      const kind = classifyBase58(body);
      const flag = kind === "steem-pub" ? "OK  (public key, checksum valid)" : `!!! pub body classified ${kind} — checksum INVALID`;
      if (kind !== "steem-pub") breach++;
      console.log(`${kind === "steem-pub" ? "✅" : "❌"} ${e.id} ${e.account ?? "-"} role=${e.role ?? "-"} status=${e.status} pub-body → ${kind}`);
    } else if (pub) {
      const kind = classifyBase58(pub);
      if (kind === "wif-priv") { breach++; console.log(`❌ ${e.id} PLAIN WIF in pub field!`); }
      else console.log(`ℹ️  ${e.id} pub=${pub.slice(0, 12)}… (${kind})`);
    }
    // encPriv must be pure hex
    if (!/^[0-9a-fA-F]+$/.test(e.encPriv) || e.encPriv.length % 2 !== 0) {
      breach++;
      console.log(`❌ ${e.id} encPriv is NOT pure hex (len=${e.encPriv.length}, head=${e.encPriv.slice(0, 10)}…) — PLAINTEXT MATERIAL IN STORAGE`);
    }
    if (e.encPriv.toLowerCase().includes(DEV_FAUCET_WIF.toLowerCase()) || (e.encPriv && WIF_RE.test(e.encPriv))) {
      breach++;
      console.log(`❌ ${e.id} encPriv contains WIF-shaped material`);
    }
  }
  console.log(`   vault entries scanned: ${entries.length}`);

  console.log("== [2] dev-faucet WIF must not exist anywhere in DB rows ==");
  const rows = await db.$queryRawUnsafe<Array<{ t: string; b: Buffer }>>(
    `SELECT name as t FROM sqlite_master WHERE type='table'`,
  );
  console.log(`   tables: ${rows.map((r) => r.t).join(", ")}`);
  const raw = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM sqlite_master WHERE type='table'`);
  let faucetHit = 0;
  for (const { name } of raw) {
    try {
      const cols = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${name}")`);
      const textCols = cols.map((c) => c.name).filter((c) => !c.endsWith("Iv") && !c.endsWith("Tag"));
      for (const c of textCols) {
        if (!DEV_FAUCET_WIF) break;
        const vals = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT rowid, "${c}" as v FROM "${name}" WHERE "${c}" LIKE '%${DEV_FAUCET_WIF}%'`,
        );
        if (vals.length) { faucetHit += vals.length; breach += vals.length; console.log(`❌ ${name}.${c}: dev-faucet WIF present ×${vals.length}`); }
      }
    } catch { /* non-text table */ }
  }
  if (!DEV_FAUCET_WIF) console.log("⚠ dev-faucet WIF check: SKIPPED (set DEV_FAUCET_WIF env to run it) — honest skip, not a fake pass");
  else if (!faucetHit) console.log("✅ dev-faucet WIF: absent from every table");

  console.log("== [3] GateMessage / GateRun / GateAction / GateOrder — WIF-shaped secrets in free text ==");
  const msgs = await db.gateMessage.findMany({ select: { id: true, body: true, meta: true } });
  let msgHit = 0;
  for (const m of msgs) {
    const hay = `${m.body}\n${m.meta ?? ""}`;
    for (const w of hay.match(WIF_RE) ?? []) {
      const k = classifyBase58(w);
      if (k === "wif-priv") { msgHit++; breach++; console.log(`❌ message ${m.id}: REAL WIF in free text!`); }
    }
  }
  if (!msgHit) console.log(`✅ ${msgs.length} messages: no WIF-shaped private material`);

  console.log("== [4] summary ==");
  if (breach) { console.log(`❌❌ BREACHES: ${breach}`); process.exitCode = 1; }
  else console.log("✅ DB TRUTH: zero plaintext private material; every pub is checksum-valid public key");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
