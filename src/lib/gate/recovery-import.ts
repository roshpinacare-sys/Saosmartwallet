/**
 * SOVEREIGN GATE — mechanical recovery re-import ("שחזור-חירום").
 * ================================================================
 * Parses every SURVIVING secret source on this machine, mechanically,
 * with zero manual typing, and returns the full vault entry list:
 *
 *   1. upload/הדקור.txt                                    — CURRENT headcorner STEEM+HIVE keys (8)
 *   2. upload/Roshcaregt.txt                               — GitHub PAT
 *   3. /tmp/my-project/MASTER-KEYS-RECOVERY-2026-09-09.md  — legacy headcorner set + 10 soldiers ×4
 *                                                            + sovereign seed + 12 fleet wallets (EVM/TRON/SOL)
 *                                                            + 2 TRON mnemonics + infra tokens
 *
 * Honest nulls are REPORTED, never fabricated: GITHUB_TOKEN from the wiped
 * agent/.env is unrecoverable (redacted in the recovery file) → listed in `nulls`.
 *
 * Nothing here is printed or returned in plaintext to any client — the route
 * seals everything straight into the vault.
 */
import fs from "fs";

import { wifToChainPub, evmAddress, tronAddress, solAddress } from "./key-id";

export interface RecoveryEntry {
  kind: string; // steem-key | evm-key | tron-key | sol-key | mnemonic | token
  chain: string | null;
  account: string | null;
  role: string | null;
  priv: string;
  pub: string | null;
  status: string; // verified | rotated-out | unverified | imported
  source: string;
}

export interface RecoveryBundle {
  entries: RecoveryEntry[];
  nulls: string[];
  sources: { path: string; found: number }[];
}

const RECOVERY_MD = "/tmp/my-project/MASTER-KEYS-RECOVERY-2026-09-09.md";
const HEDEKOR_TXT = "/home/z/my-project/upload/הדקור.txt";
const PAT_TXT = "/home/z/my-project/upload/Roshcaregt.txt";

const WIF_ROW = /^\|\s*(owner|active|posting|memo)\s*\|\s*`([5KL][1-9A-HJ-NP-Za-km-z]{49,51})`\s*\|\s*`(STM[1-9A-HJ-NP-Za-km-z]+)`\s*\|/;
const SOLDIER_H = /^###\s+@([a-z0-9-]+)\b/i;
const WALLET_H = /^###\s+([a-z0-9-]+)\s+\(idx (\d+)\)/i;
const EVM_ADDR = /- \*\*EVM\*\*[^`]*`0x([0-9a-fA-F]{40})`/;
const TRON_ADDR = /- \*\*TRON\*\*[^`]*`(T[1-9A-HJ-NP-Za-km-z]{33})`/;
const SOL_ADDR = /- \*\*SOL\*\*[^`]*`([1-9A-HJ-NP-Za-km-z]{43,44})`/;
const PK_LINE = /^\s*- pk:\s*`0x([0-9a-fA-F]{64})`\s*$/;
const SEED_HEX = /^[0-9a-f]{96}$/;
const MNEMONIC = /^[a-z]+(\s+[a-z]+){11,23}$/;
const INFRA_ROW = /^\|\s*([^|`]+?)\s*\|\s*`([^`]+)`\s*\|/;

/** Parse upload/הדקור.txt — the operator's CURRENT headcorner keys (steem block, then HIVE block). */
function parseHedekor(text: string, out: RecoveryEntry[]): number {
  let chain: "steem" | "hive" | null = null;
  let n = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/steemit/i.test(line) && !line.includes("=")) chain = "steem";
    else if (/^HIVE$/i.test(line)) chain = "hive";
    const m = /^(owner|active|posting|memo)\s*=\s*([5KL][1-9A-HJ-NP-Za-km-z]{49,51})$/i.exec(line);
    if (m && chain) {
      const role = m[1].toLowerCase();
      const wif = m[2];
      out.push({
        kind: "steem-key", chain, account: "headcorner", role,
        priv: wif, pub: wifToChainPub(wif), status: "verified", source: "upload/הדקור.txt",
      });
      n++;
    }
  }
  return n;
}

/** Parse the master recovery markdown — legacy set, soldiers, seed, wallets, mnemonics, infra. */
function parseRecoveryMd(text: string, out: RecoveryEntry[]): number {
  let n = 0;
  const lines = text.split(/\r?\n/);

  // ── pass 1: WIF tables. Account context: section 1 = headcorner-legacy, ### @name = soldier.
  let section = 0;
  let soldier: string | null = null;
  for (const line of lines) {
    const h1 = /^##\s+(\d)\)/.exec(line);
    if (h1) { section = Number(h1[1]); soldier = null; continue; }
    const sh = SOLDIER_H.exec(line);
    if (sh && section === 2) { soldier = sh[1]; continue; }
    const wr = WIF_ROW.exec(line);
    if (wr) {
      const [, role, wif, pub] = wr;
      const acct = section === 1 ? "headcorner-legacy" : soldier;
      if (!acct) continue;
      out.push({
        kind: "steem-key", chain: "steem", account: acct, role,
        priv: wif, pub,
        status: section === 1 ? "rotated-out" : "unverified",
        source: "MASTER-KEYS-RECOVERY.md",
      });
      n++;
    }
  }

  // ── pass 2: code blocks → 96-hex seed (section 3) then 2 mnemonics (section 5).
  section = 0;
  const codeBlocks: { sec: number; body: string[] }[] = [];
  let cur: { sec: number; body: string[] } | null = null;
  for (const line of lines) {
    const h1 = /^##\s+(\d)\)/.exec(line);
    if (h1) { section = Number(h1[1]); continue; }
    if (/^```/.test(line.trim())) {
      if (cur) { codeBlocks.push(cur); cur = null; } else { cur = { sec: section, body: [] }; }
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) codeBlocks.push(cur);

  for (const cb of codeBlocks) {
    for (const b of cb.body) {
      const t = b.trim();
      if (cb.sec === 3 && SEED_HEX.test(t)) {
        out.push({
          kind: "mnemonic", chain: "sovereign", account: "sovereign-root", role: "seed",
          priv: t, pub: null, status: "verified", source: "MASTER-KEYS-RECOVERY.md",
        });
        n++;
      }
      if (cb.sec === 5 && MNEMONIC.test(t)) {
        const isFirstMnemonic = out.filter((e) => e.chain === "tron" && e.kind === "mnemonic").length === 0;
        out.push({
          kind: "mnemonic", chain: "tron", account: isFirstMnemonic ? "tron-sovereign" : "tron-legacy", role: "mnemonic",
          priv: t, pub: null, status: "imported", source: "MASTER-KEYS-RECOVERY.md",
        });
        n++;
      }
    }
  }

  // ── pass 3: fleet wallets (section 4) — EVM/TRON/SOL pks per account.
  section = 0;
  let wallet: string | null = null;
  let pendingPub: string | null = null; // address/addr line seen, waiting for its pk line
  for (const line of lines) {
    const h1 = /^##\s+(\d)\)/.exec(line);
    if (h1) { section = Number(h1[1]); wallet = null; pendingPub = null; continue; }
    const wh = WALLET_H.exec(line);
    if (wh && section === 4) { wallet = wh[1]; pendingPub = null; continue; }
    if (section !== 4 || !wallet) continue;

    const pk = PK_LINE.exec(line);
    if (pk && pendingPub) {
      const priv = pk[1].toLowerCase();
      if (pendingPub.startsWith("0x") && pendingPub.length === 42) {
        out.push({
          kind: "evm-key", chain: "ethereum", account: wallet, role: "wallet",
          priv, pub: evmAddress(priv), status: "verified", source: "MASTER-KEYS-RECOVERY.md",
        });
      } else {
        out.push({
          kind: "tron-key", chain: "tron", account: wallet, role: "wallet",
          priv, pub: tronAddress(priv), status: "verified", source: "MASTER-KEYS-RECOVERY.md",
        });
      }
      n++;
      pendingPub = null;
      continue;
    }
    const em = EVM_ADDR.exec(line);
    if (em) { pendingPub = "0x" + em[1]; continue; }
    const tm = TRON_ADDR.exec(line);
    if (tm) { pendingPub = tm[1]; continue; }
    const sm = SOL_ADDR.exec(line);
    if (sm) {
      // SOL pk line follows too — handled by PK_LINE on the next iteration (also 0x-prefixed in the file)
      pendingPub = sm[1];
      continue;
    }
  }

  // ── SOL pks: the file lists them as bare hex after the SOL address — second sweep for correctness.
  section = 0;
  wallet = null;
  let lastSol: string | null = null;
  for (const line of lines) {
    const h1 = /^##\s+(\d)\)/.exec(line);
    if (h1) { section = Number(h1[1]); wallet = null; lastSol = null; continue; }
    const wh = WALLET_H.exec(line);
    if (wh && section === 4) { wallet = wh[1]; lastSol = null; continue; }
    if (section !== 4 || !wallet) continue;
    const sm = SOL_ADDR.exec(line);
    if (sm) { lastSol = sm[1]; continue; }
    const bare = line.trim().match(/^- pk:\s*`([0-9a-f]{64})`\s*$/i);
    if (bare && lastSol && !out.some((e) => e.account === wallet && e.chain === "solana")) {
      out.push({
        kind: "sol-key", chain: "solana", account: wallet, role: "wallet",
        priv: bare[1].toLowerCase(), pub: solAddress(bare[1]), status: "verified", source: "MASTER-KEYS-RECOVERY.md",
      });
      n++;
      lastSol = null;
    }
  }

  // ── pass 4: infra tokens (section 6) — skip redacted GitHub rows (honest null).
  section = 0;
  for (const line of lines) {
    const h1 = /^##\s+(\d)\)/.exec(line);
    if (h1) { section = Number(h1[1]); continue; }
    if (section !== 6) continue;
    const ir = INFRA_ROW.exec(line);
    if (!ir) continue;
    const [, name, value] = ir;
    if (/\[REDACTED/i.test(value)) continue; // honest: redacted here → not importable from this source
    if (/SAOS_ADMIN/i.test(name)) {
      out.push({ kind: "token", chain: "infra", account: "saos-admin", role: "token", priv: value, pub: null, status: "imported", source: "MASTER-KEYS-RECOVERY.md" });
      n++;
    } else if (/vaultkey/i.test(name)) {
      out.push({ kind: "token", chain: "infra", account: "vault-114", role: "master-key", priv: value, pub: null, status: "imported", source: "MASTER-KEYS-RECOVERY.md" });
      n++;
    } else if (/key-broker/i.test(name)) {
      out.push({ kind: "token", chain: "infra", account: "key-broker", role: "token", priv: value, pub: null, status: "imported", source: "MASTER-KEYS-RECOVERY.md" });
      n++;
    } else if (/fleet seal pass|fleet-pass/i.test(name)) {
      out.push({ kind: "token", chain: "infra", account: "fleet-seal", role: "pass", priv: value, pub: null, status: "imported", source: "MASTER-KEYS-RECOVERY.md" });
      n++;
    }
  }
  return n;
}

/** Build the full recovery bundle from every surviving source. Throws if NOTHING survives. */
export function buildRecoveryBundle(): RecoveryBundle {
  const entries: RecoveryEntry[] = [];
  const nulls: string[] = [];
  const sources: { path: string; found: number }[] = [];

  // 1) current headcorner keys
  if (fs.existsSync(HEDEKOR_TXT)) {
    const n = parseHedekor(fs.readFileSync(HEDEKOR_TXT, "utf8"), entries);
    sources.push({ path: HEDEKOR_TXT.replace("/home/z/my-project/", ""), found: n });
  } else {
    nulls.push("upload/הדקור.txt לא נמצא — מפתחות-headcorner הנוכחיים לא ייובאו");
  }

  // 2) PAT
  if (fs.existsSync(PAT_TXT)) {
    const pat = fs.readFileSync(PAT_TXT, "utf8").trim();
    if (/^(ghp_|github_pat_)[A-Za-z0-9_]+$/.test(pat)) {
      entries.push({ kind: "token", chain: "github", account: "operator", role: "pat", priv: pat, pub: null, status: "imported", source: "upload/Roshcaregt.txt" });
      sources.push({ path: "upload/Roshcaregt.txt", found: 1 });
    } else {
      nulls.push("upload/Roshcaregt.txt קיים אך אינו בפורמט-PAT");
      sources.push({ path: "upload/Roshcaregt.txt", found: 0 });
    }
  } else {
    nulls.push("upload/Roshcaregt.txt לא נמצא — PAT לא ייובא");
  }

  // 3) master recovery md
  if (fs.existsSync(RECOVERY_MD)) {
    const n = parseRecoveryMd(fs.readFileSync(RECOVERY_MD, "utf8"), entries);
    sources.push({ path: RECOVERY_MD, found: n });
  } else {
    nulls.push(RECOVERY_MD + " לא נמצא — הסט-הישן, החיילים, הזרע והארנקים לא ייובאו");
  }

  // honest nulls that no surviving source can cover
  nulls.push("GITHUB_TOKEN (agent/.env) — ה-.env נמחק עם ה-lab והערך בקובץ-השחזור מצונזר → null אמיתי");
  nulls.push("ynet STEEM — מעולם לא הוחזק במכונה (operator-delegated, keys:{}) → null תיעודי");

  // dedup on (chain,account,role,pub) — first source wins (current keys before legacy)
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    const k = `${e.chain}|${e.account}|${e.role}|${e.pub || e.priv.slice(0, 16)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (deduped.length === 0) throw new Error("אף מקור-שחזור לא שרד — אין מה לייבא");
  return { entries: deduped, nulls, sources };
}
