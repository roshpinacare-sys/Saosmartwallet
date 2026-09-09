/**
 * SOVEREIGN GATE — encrypted local backup ("ביטוח-אבדן").
 * Writes a GCM-sealed snapshot of the whole vault (GateConfig + entries)
 * into /home/z/my-project/backups/ (gitignored) — sealed under the MASTER
 * key itself, so it opens only from an unlocked vault. gitignore keeps it
 * out of the repo; the DB copy committed to git is ciphertext-only.
 */
import fs from "fs";
import path from "path";

import { db } from "@/lib/db";
import { sealWith, requireMaster } from "./crypto";

const BACKUP_DIR = "/home/z/my-project/backups";

export interface BackupResult {
  file: string;
  bytes: number;
  entries: number;
  at: string;
}

export async function writeEncryptedBackup(): Promise<BackupResult> {
  requireMaster();
  const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
  if (!cfg) throw new Error("gate config missing");
  const entries = await db.vaultEntry.findMany();
  const snapshot = {
    at: new Date().toISOString(),
    gateConfig: {
      initialized: cfg.initialized, kdfSalt: cfg.kdfSalt, encMaster: cfg.encMaster,
      sealIv: cfg.sealIv, sealTag: cfg.sealTag, hint: cfg.hint, keySeals: cfg.keySeals,
    },
    entries,
  };
  const seal = sealWith(requireMaster(), JSON.stringify(snapshot));
  const payload = JSON.stringify({ magic: "SAOS-GATE-BACKUP-1", ...seal });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `gate-vault-${Date.now()}.enc`);
  fs.writeFileSync(file, payload, { mode: 0o600 });
  return { file, bytes: Buffer.byteLength(payload), entries: entries.length, at: snapshot.at };
}
