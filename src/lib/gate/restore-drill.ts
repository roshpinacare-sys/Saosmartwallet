/**
 * SOVEREIGN GATE — r37: THE RESTORE DRILL ("תרגיל-שחזור כל-המפתחות").
 *
 * The operator's decree: the vault must PROVE — not claim — that every key
 * it holds can be restored when needed. The drill opens the master, then
 * opens EVERY VaultEntry ciphertext, one by one, and counts what actually
 * decrypts. A ciphertext that fails GCM is a real, named failure — never
 * averaged away.
 *
 * On pass it also writes the sealed insurance snapshot (gitignored, sealed
 * under the master itself) and persists the summary into GateConfig.
 * Nothing secret ever leaves this module: the summary carries ids, labels
 * and booleans only.
 */
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { requireMaster, openSecretWith } from "./crypto";
import { writeEncryptedBackup, BackupResult } from "./backup";
import { loadKeySeals } from "./key-seal";

export interface DrillFailure {
  id: string;
  label: string; // kind · chain · account · role (public metadata only)
  error: string; // the GCM/network-neutral failure message
}

export interface DrillResult {
  at: string;
  total: number;
  restored: number;
  failed: number;
  /** r37: honest-null rows (zero-byte ciphertext BY DESIGN — e.g. r11 placeholders).
   *  They hold no key, so there is nothing to restore from them; the roles they
   *  occupy must be covered by a verified entry elsewhere in the vault. */
  placeholders: number;
  failures: DrillFailure[];
  seals: { count: number; operatorPrimary: boolean; roles: string[] };
  backup: BackupResult | null;
  verdict: "pass" | "fail";
  meaning: string;
}

/** A human label built from public metadata only. */
function labelOf(e: { kind: string; chain: string | null; account: string | null; role: string | null }): string {
  return [e.kind, e.chain, e.account, e.role].filter(Boolean).join(" · ");
}

export async function runRestoreDrill(withBackup = true): Promise<DrillResult> {
  const master = requireMaster();
  const rows = await db.vaultEntry.findMany({ orderBy: [{ chain: "asc" }, { account: "asc" }, { role: "asc" }] });

  const failures: DrillFailure[] = [];
  const placeholderRows: DrillFailure[] = [];
  let restored = 0;
  for (const e of rows) {
    if (!e.encPriv || e.encPriv.length === 0) {
      // honest-null placeholder — zero-byte ciphertext by design (r11): not a decryption failure
      placeholderRows.push({ id: e.id, label: labelOf(e), error: "רשומת-מצב פנויה (ללא חומר-מפתח במתכנן)" });
      continue;
    }
    try {
      const priv = openSecretWith(master, e);
      if (!priv || priv.length < 8) throw new Error("פענוח חזר ריק");
      restored++;
    } catch (err) {
      failures.push({ id: e.id, label: labelOf(e), error: String((err as Error).message || err).slice(0, 160) });
    }
  }

  const seals = await loadKeySeals();
  // operatorPrimary = the master is sealed under a key that is a VERIFIED current
  // owner/active control-key of the operator account (metadata-only check —
  // the live on-chain authority itself is proven by /api/gate/key-authority)
  const controlPubs = new Set(
    rows.filter((e) => e.account === "headcorner" && e.chain && ["steem", "hive"].includes(e.chain) && ["owner", "active"].includes(e.role ?? "") && e.status === "verified" && e.pub)
      .map((e) => e.pub as string),
  );
  const operatorPrimary = seals.some((s) => s.pub && controlPubs.has(s.pub));

  // sealed insurance snapshot — only on a healthy drill (a failing drill must
  // not overwrite the last good snapshot with one that bakes the failure in)
  let backup: BackupResult | null = null;
  if (withBackup && failures.length === 0) {
    try { backup = await writeEncryptedBackup(); } catch { backup = null; }
  }

  // off-DB manifest (backups/ is gitignored; no key material inside — ids only)
  try {
    const dir = "/home/z/my-project/backups";
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `restore-drill-${Date.now()}.json`),
      JSON.stringify({ at: new Date().toISOString(), total: rows.length, restored, failed: failures.length, placeholders: placeholderRows.length, failures }, null, 2),
      { mode: 0o600 },
    );
  } catch { /* best-effort */ }

  const total = rows.length;
  const placeholders = placeholderRows.length;
  const verdict: "pass" | "fail" = failures.length === 0 && restored > 0 ? "pass" : "fail";
  const meaning = verdict === "pass"
    ? `תרגיל-שחזור: כל ${restored} הסודות האטומים בכספת נפתחו בפועל מול מפתח-האב — יכולת-השחזור המלאה מוכחת מכנית${placeholders ? ` · ${placeholders} רשומות-מצב פנויות (ללא חומר-מפתח, כהלכת-r11)` : ""}${backup ? " · גיבוי-אטום נכתב" : ""}${operatorPrimary ? " · המפתח-האב אטום תחת מפתח-שליטה מאומת של המפעיל" : ""}.`
    : `תרגיל-שחזור נכשל: ${restored}/${total} נפתחו · ${failures.length} הצפנות לא נפתחו (${failures.slice(0, 3).map((f) => f.label).join(", ")}) — זו אזעקה אמת: חומר-מפתח פגום בכספת.`;

  const result: DrillResult = {
    at: new Date().toISOString(),
    total, restored, failed: failures.length, placeholders, failures: [...failures, ...placeholderRows], seals: { count: seals.length, operatorPrimary, roles: seals.map((s) => s.role) },
    backup, verdict, meaning,
  };
  await db.gateConfig.update({ where: { id: "gate" }, data: { lastRestoreDrill: JSON.stringify(result) } }).catch(() => {});
  return result;
}
