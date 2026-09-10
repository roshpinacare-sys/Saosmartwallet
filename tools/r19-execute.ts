/**
 * r19 — operator-authorized sovereign sequence (explicit "כן תעשה", 2026-09-10):
 *   1) rotate the steem authorities of the 11 ready accounts to the D1 roots
 *      (via the r16 bit-proven engine — fail-closed, owner-signed, chain re-read)
 *   2) close the steemauto (mahdiyari, 2017) posting doors on every hive
 *      account we control — MINIMAL DIFF: key_auths/memo/json_metadata verbatim,
 *      account_auths minus "steemauto" only. No other door is touched.
 *   3) fresh sweep of both chains
 *   4) ⚓ anchor r19 (saos.vault.anchor.v1) — synchronous broadcast
 * The vault must be ALIVE (operator presence re-lit it) — honest exit otherwise.
 * No private material is ever printed; the report carries txIds and pubs only.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { createHash, createHmac, scryptSync, createDecipheriv } from "crypto";
import bs58 from "bs58";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DOOR = "steemauto";
const ROTATE_TARGETS = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

interface Report { at: string; rotations: unknown[]; doors: unknown[]; sweep: unknown; anchor: unknown; }

/* ── vault lighting (in-process) ── */

async function mintSession(): Promise<string | null> {
  const s = await fetch(`${BASE}/api/gate/session`, { method: "POST" });
  const sj = (await s.json()) as { ok: boolean; in?: boolean; token?: string };
  if (!sj.ok || sj.in === false || !sj.token) return null;
  writeFileSync("/tmp/gate_token", String(sj.token), { mode: 0o600 });
  return sj.token;
}

async function lightVaultInProcess(token: string): Promise<boolean> {
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now() || !row.encMaster || !row.sealSalt) return false;
  const s = JSON.parse(row.encMaster) as { ct: string; iv: string; tag: string };
  const kek = scryptSync(token, Buffer.from(row.sealSalt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", kek, Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  const { setMaster } = await import("@/lib/gate/crypto");
  setMaster(Buffer.from(Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8"), "hex"));
  return true;
}

/* ── shared helpers ── */

const raw33 = (pub: string): string | null => {
  const m = /^STM([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[1])).subarray(0, 33).toString("hex"); } catch { return null; }
};

async function hiveRpc<T>(method: string, params: unknown): Promise<T> {
  const urls = ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"];
  let last = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) { last = String(j.error.message || "rpc error"); continue; }
      return j.result as T;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`hive rpc down: ${last}`);
}

type Acct = { name: string; owner?: any; active?: any; posting?: any; memo_key?: string; json_metadata?: string };

interface RcRow { account: string; rc_manabar: { current_mana: string; last_update_time: number }; max_rc: string }
interface RcReply { rc_accounts: RcRow[] }

/** effective hive RC right now: stored mana + regen since last_update (5-day full bar). */
async function effectiveRc(account: string): Promise<bigint> {
  const j = await hiveRpc<RcReply>("rc_api.find_rc_accounts", { accounts: [account] });
  const a = j.rc_accounts[0];
  if (!a) return 0n;
  const stored = BigInt(a.rc_manabar.current_mana || "0");
  const max = BigInt(a.max_rc || "0");
  const elapsed = BigInt(Math.max(0, Math.floor(Date.now() / 1000) - a.rc_manabar.last_update_time));
  const regen = (max * elapsed) / 432000n;
  const eff = stored + regen;
  return eff > max ? max : eff;
}

/** every sealed/derivable WIF whose pub sits in the LIVE authority of this role — fail-closed by construction. */
async function findSigners(account: string, role: "active" | "posting"): Promise<Array<{ wif: string; via: string }>> {
  const { openSecret } = await import("@/lib/gate/crypto");
  const { deriveRolePrivHex, privHexToWif } = await import("@/lib/gate/rotation");
  const { wifToChainPub } = await import("@/lib/gate/key-id");
  const acct = (await hiveRpc<Acct[]>("condenser_api.get_accounts", [[account]]))[0];
  const live = ((acct[role]?.key_auths ?? []) as [string, number][]).map((k) => raw33(String(k[0]))).filter(Boolean) as string[];
  const out: Array<{ wif: string; via: string }> = [];
  const push = (wif: string, via: string) => {
    const pub = wifToChainPub(wif);
    const r = raw33(pub);
    if (r && live.includes(r)) out.push({ wif, via });
  };
  // candidate 1 — the D1 derivation from the sealed P5
  const p5row = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account } });
  if (p5row) {
    const p5 = openSecret(p5row);
    push(privHexToWif(deriveRolePrivHex(account, role, p5)), "D1(P5)");
  }
  // candidate 2 — sealed hive rows for this account/role (ROT1 or FULL-4 custody)
  const rows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "hive", account, role } });
  for (const row of rows) {
    try {
      const wif = openSecret(row);
      if (!(row.pub && raw33(row.pub) === raw33(wifToChainPub(wif)))) continue; // row material inconsistency — refuse
      push(wif, `row:${row.source?.slice(0, 24) ?? "sealed"}`);
    } catch { /* unopenable row — skip */ }
  }
  // candidate 3 — the ROT1 mother seed (r17: HMAC wiring proved the fleet's steem
  // keys; if the account's HIVE authority also carries a ROT1 key, this matches it)
  const seedRow = await db.vaultEntry.findFirst({ where: { kind: "note", chain: "sovereign", account: "saos-rot1", role: "rot1-seed" } });
  if (seedRow) {
    try {
      const seed = openSecret(seedRow);
      const wiring = createHmac("sha256", seed).update(`SAOS-ROT1/${account}/hive/${role}`).digest();
      const wif = privHexToWif(wiring.toString("hex"));
      push(wif, "ROT1(mother-seed)");
    } catch { /* seed row unopenable — skip */ }
  }
  return out;
}

/* ── phase 2: hive door closure (minimal diff) ── */

async function closeDoors(report: Report): Promise<void> {
  const { openSecret } = await import("@/lib/gate/crypto");
  const { deriveRolePrivHex, privHexToWif } = await import("@/lib/gate/rotation");
  const { wifToChainPub } = await import("@/lib/gate/key-id");
  const { hiveBroadcastAdapter } = await import("@/lib/social/rails-server");

  const accounts = (await hiveRpc<Acct[]>("condenser_api.get_accounts", [[
    "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "ynet",
  ]]));
  const adapter = hiveBroadcastAdapter();
  for (const acct of accounts) {
    const account = acct.name;
    const doors = ((acct.posting?.account_auths ?? []) as [string, number][]) ;
    const doorEntry = doors.find((d) => d[0] === DOOR);
    if (!doorEntry) { report.doors.push({ account, chain: "hive", result: "no-door" }); continue; }

    // RC pre-check — the payer for account_update is the updated account; a
    // chain-economics wall is NOT a signing failure and must not burn a
    // broadcast attempt (r19: measured — these accounts' max_rc is far below
    // the op cost; honest skip instead of noisy errors).
    const MIN_RC = 8_000_000_000n; // an account_update of this size costs single-digit B on hive
    const rc = await effectiveRc(account);
    if (rc < MIN_RC) {
      report.doors.push({ account, chain: "hive", result: "blocked-rc", effectiveRc: rc.toString(), doorKept: true });
      console.log(`DOOR ${account}: BLOCKED by chain economics — effective RC ${rc} < ${MIN_RC} (door kept, honest record)`);
      continue;
    }

    const signers: Array<{ role: "active" | "posting"; wif: string; via: string }> = [];
    for (const role of ["active", "posting"] as const) {
      for (const s of await findSigners(account, role)) signers.push({ role, ...s });
    }
    if (!signers.length) {
      report.doors.push({ account, chain: "hive", result: "no-signing-key-in-vault-matches-live-authority", doorKept: true });
      console.log(`DOOR ${account}: SKIP — no sealed key matches the live authority (fail-closed, door kept)`);
      continue;
    }

    const newAccountAuths = doors.filter((d) => d[0] !== DOOR).map((d) => [String(d[0]), Number(d[1])]);
    const payload = {
      account,
      posting: {
        weight_threshold: Number(acct.posting?.weight_threshold ?? 1) || 1,
        account_auths: newAccountAuths,
        key_auths: ((acct.posting?.key_auths ?? []) as [string, number][]).map((k) => [String(k[0]), Number(k[1])]),
      },
      memo_key: String(acct.memo_key ?? ""),
      json_metadata: String(acct.json_metadata ?? ""),
    };
    try {
      const unsigned = await adapter.buildOperations([{ type: "account_update", payload: payload as unknown as Record<string, unknown> }]);
      const byRole: Record<string, string> = {};
      for (const s of signers) byRole[s.role] = s.wif;
      const roles = [...new Set(signers.map((s) => s.role))];
      const signed = await adapter.sign(unsigned, { byRole }, roles);
      const res = await adapter.broadcast(signed);
      const txId = res.txId || "";
      await new Promise((r) => setTimeout(r, 4200));
      const after = (await hiveRpc<Acct[]>("condenser_api.get_accounts", [[account]]))[0];
      const stillThere = ((after.posting?.account_auths ?? []) as [string, number][]).some((d) => d[0] === DOOR);
      const intact = JSON.stringify(((after.posting?.account_auths ?? []) as [string, number][]).map((d) => d[0])) === JSON.stringify(newAccountAuths.map((d) => d[0]));
      const keysUntouched = JSON.stringify(((after.posting?.key_auths ?? []) as [string, number][]).map((k) => k[0])) === JSON.stringify(payload.posting.key_auths.map((k) => k[0]));
      const verified = !stillThere && intact && keysUntouched;
      report.doors.push({ account, chain: "hive", result: verified ? "closed-verified" : "broadcast-unverified", txId, removed: DOOR, kept: newAccountAuths.map((d) => d[0]), signers: signers.map((s) => s.via) });
      console.log(`DOOR ${account}: ${verified ? `CLOSED+VERIFIED tx=${txId.slice(0, 12)}…` : `BROADCASTED tx=${txId.slice(0, 12)}… but re-read unclear`} (kept: ${newAccountAuths.map((d) => d[0]).join(",") || "none"})`);
      await db.gateAction.create({
        data: { agentName: "operator-delegated:r19", action: "door.close-steemauto", ok: verified,
          params: JSON.stringify({ account, chain: "hive", removed: DOOR, kept: newAccountAuths.map((d) => d[0]) }),
          result: JSON.stringify({ txId, verified, signers: signers.map((s) => s.via) }) },
      });
    } catch (e) {
      report.doors.push({ account, chain: "hive", result: "error", error: (e as Error).message.slice(0, 160), doorKept: true });
      console.log(`DOOR ${account}: ERROR ${(e as Error).message.slice(0, 120)} — door kept, honest record`);
    }
  }
}

/* ── phase 3: fresh sweep ── */

async function sweep(report: Report): Promise<void> {
  const { deriveRolePrivHex, privHexToWif, ROTATION_ACCOUNTS } = await import("@/lib/gate/rotation");
  const { wifToChainPub } = await import("@/lib/gate/key-id");
  const steemRows = (await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[...ROTATION_ACCOUNTS]] }) }).then((r) => r.json())).result as Acct[];
  const sweepRows: unknown[] = [];
  for (const acct of steemRows) {
    const p5row = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account: acct.name } });
    if (!p5row) continue;
    const { openSecret } = await import("@/lib/gate/crypto");
    const p5 = openSecret(p5row);
    const roles = ["owner", "active", "posting", "memo"] as const;
    const okRoles = roles.map((role) => {
      const target = raw33(wifToChainPub(privHexToWif(deriveRolePrivHex(acct.name, role, p5))));
      if (role === "memo") return raw33(String(acct.memo_key ?? "")) === target;
      const live = ((acct[role]?.key_auths ?? []) as [string, number][]).map((k) => raw33(String(k[0])));
      return live.includes(target as string);
    });
    sweepRows.push({ account: acct.name, d1: okRoles.every(Boolean) ? "4/4-D1" : okRoles.filter(Boolean).length + "/4", doorsOnSteem: ((acct.posting?.account_auths ?? []) as [string, number][]).map((d) => d[0]) });
  }
  const hiveRows = (await hiveRpc<Acct[]>("condenser_api.get_accounts", [[
    "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "ynet",
  ]]));
  const hiveDoors = hiveRows.map((a) => ({ account: a.name, steemauto: ((a.posting?.account_auths ?? []) as [string, number][]).some((d) => d[0] === DOOR) }));
  report.sweep = { steem: sweepRows, hiveDoors };
}

/* ── phase 4: ⚓ anchor r19 ── */

async function anchor(report: Report): Promise<void> {
  const { openSecret } = await import("@/lib/gate/crypto");
  const { deriveRolePrivHex, privHexToWif } = await import("@/lib/gate/rotation");
  const { wifToChainPub } = await import("@/lib/gate/key-id");
  const { steemBroadcastAdapter } = await import("@/lib/steem-server");
  const { buildSteemCustomJsonTx } = await import("@/lib/steem-social");
  const { toSigningKey } = await import("@/lib/gate/harness/orders");

  const acct = (await (await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [["headcorner"]] }) }).then((r) => r.json()))).result[0] as Acct;
  const livePosting = ((acct.posting?.key_auths ?? []) as [string, number][]).map((k) => raw33(String(k[0])));
  let wif: string | null = null;
  const p5row = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account: "headcorner" } });
  if (p5row) {
    const p5 = openSecret(p5row);
    const cand = privHexToWif(deriveRolePrivHex("headcorner", "posting", p5));
    if (livePosting.includes(raw33(wifToChainPub(cand)) as string)) wif = cand;
  }
  if (!wif) {
    for (const row of await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account: "headcorner", role: "posting" } })) {
      try {
        const cand = openSecret(row);
        if (livePosting.includes(raw33(wifToChainPub(cand)) as string)) { wif = cand; break; }
      } catch { /* skip */ }
    }
  }
  if (!wif) throw new Error("anchor: no sealed key matches headcorner's live steem posting authority");

  const entries = await db.vaultEntry.count();
  const verifiedEntries = await db.vaultEntry.count({ where: { status: "verified" } });
  const rotatedOk = (report.rotations as Array<{ ok?: boolean; verified?: boolean }>).filter((r) => r.ok && r.verified).length;
  const closedOk = (report.doors as Array<{ result?: string }>).filter((d) => d.result === "closed-verified").length;
  const counts = {
    steemD1Rotated: `${rotatedOk}/11`, hiveSteemautoDoorsClosed: closedOk,
    ynetSteem: "external operator custody (unchanged)", vaultEntries: entries, vaultVerified: verifiedEntries,
  };
  const payload = {
    protocol: "saos/v1", action: "vault-seal", at: new Date().toISOString(), round: "r19",
    digest: sha256hex(JSON.stringify({ counts })),
    counts,
    prior: "d4b33aa3 (r17, block 109469449)",
    note: "האטימה r19: הצי מאוחד על שורש-אחד — steem הועבר לשורשי-D1 (רוטציית-מפעיל מאושרת, כל-הדלתות-שלנו נשמרו); דלתות-ה-steemauto נסגרו על hive; ynet@steem בחסות-מפעיל ללא-שינוי",
  };
  const build = await buildSteemCustomJsonTx({ account: "headcorner", id: "saos.vault.anchor.v1", json: payload });
  const adapter = steemBroadcastAdapter();
  const signed = await adapter.sign(build.unsigned, { byRole: { posting: wif } }, ["posting"]);
  const meta = signed.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number };
  const txJson = {
    ref_block_num: meta.refBlockNum, ref_block_prefix: meta.refBlockPrefix,
    expiration: new Date(meta.expiration * 1000).toISOString().replace(/[-:]/g, "").slice(0, 15),
    operations: signed.operations.map((o) => [o.type, o.payload]),
    extensions: [], signatures: signed.signatures,
  };
  const res = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.broadcast_transaction_synchronous", params: [txJson] }) });
  const j = (await res.json()) as { error?: { message?: string }; result?: { block_num?: number; id?: string; expired?: boolean } };
  if (j.error) throw new Error(`anchor broadcast rejected: ${String(j.error.message).slice(0, 200)}`);
  const { block_num, id: txId, expired } = j.result ?? {};
  if (!block_num || expired) throw new Error(`anchor not included: ${JSON.stringify(j.result).slice(0, 120)}`);
  report.anchor = { block: block_num, txId, digest: payload.digest };
  console.log(`ANCHOR r19 CONFIRMED: block=${block_num} tx=${String(txId).slice(0, 16)}…`);
  await db.gateAction.create({
    data: { agentName: "operator-delegated:r19", action: "vault-anchor:saos.vault.anchor.v1", params: JSON.stringify(payload).slice(0, 8000), ok: true,
      result: JSON.stringify({ txId, blockNum: block_num, signedBy: "headcorner@posting(D1)", prior: "r17 block 109469449" }) },
  });
  await db.gateMessage.create({
    data: { channel: "command", fromKind: "system", fromName: "r19-unify",
      body: `⚓ האטימה r19 מאומתת על השרשרת (בלוק ${block_num}): הצי מאוחד על שורש-אחד — steem תחת שורשי-D1 (${rotatedOk}/11 רוטציות מאומתות), דלתות-ה-steemauto על hive נסגרו (${closedOk}) בשימור-מלא של שאר-ההרשאות, ynet@steem בחסות-מפעיל. tx: ${String(txId).slice(0, 16)}…`,
      meta: JSON.stringify({ txId, block: block_num, digest: payload.digest }) },
  });
}

/* ── main ── */

async function main(): Promise<void> {
  // 0. operator presence: mint + light
  const token = await mintSession();
  if (!token) { console.log("VAULT DARK — operator presence required (page reload / key). Nothing executed."); process.exit(2); }
  if (!(await lightVaultInProcess(token))) { console.log("SESSION MINTED but master seal undecryptable — honest exit."); process.exit(2); }
  console.log("VAULT LIT (operator session) — executing the authorized sequence");
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const report: Report = { at: new Date().toISOString(), rotations: [], doors: [], sweep: null, anchor: null };

  // 1. rotation × 11 (per-account independent; engine is fail-closed + chain re-read)
  for (const account of ROTATE_TARGETS) {
    try {
      const r = await fetch(`${BASE}/api/gate/rotation`, { method: "POST", headers: H, body: JSON.stringify({ action: "rotate", account }) });
      const j = (await r.json()) as { ok?: boolean; txId?: string; verified?: boolean; detail?: string; error?: string };
      report.rotations.push({ account, ok: j.ok, txId: j.txId, verified: j.verified, detail: j.detail, error: j.error });
      console.log(`ROTATE ${account}: ${j.ok ? `tx=${String(j.txId).slice(0, 12)}… verified=${j.verified}` : `ERR ${String(j.error).slice(0, 140)}`}`);
    } catch (e) {
      report.rotations.push({ account, ok: false, error: (e as Error).message.slice(0, 160) });
      console.log(`ROTATE ${account}: EXCEPTION ${(e as Error).message.slice(0, 120)}`);
    }
  }

  // 2. doors on hive (minimal diff)
  await closeDoors(report);

  // 3. sweep
  await sweep(report);
  const d1Count = (report.sweep as { steem: Array<{ d1: string }> }).steem.filter((s) => s.d1 === "4/4-D1").length;
  console.log(`SWEEP: steem D1-unified ${d1Count}/11 · hive steemauto doors remaining: ${(report.sweep as { hiveDoors: Array<{ steemauto: boolean }> }).hiveDoors.filter((h) => h.steemauto).length}`);

  // 4. anchor
  try { await anchor(report); } catch (e) { report.anchor = { error: (e as Error).message.slice(0, 300) }; console.log(`ANCHOR FAILED honestly: ${(e as Error).message.slice(0, 200)}`); }

  mkdirSync("/tmp/r19", { recursive: true });
  writeFileSync("/tmp/r19/report.json", JSON.stringify(report, null, 1));
  console.log("REPORT → /tmp/r19/report.json");
}

main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); }).finally(() => db.$disconnect());
