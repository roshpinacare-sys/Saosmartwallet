/**
 * SOVEREIGN GATE — key-seals: the SAME master key sealed under each proven
 * control-key. Iron rule from the passphrase-loss incident (2026-09-09):
 * the operator passphrase is NEVER a single point of failure again — any
 * key that currently controls headcorner on-chain can open the vault.
 *
 * KEK = scrypt(keyString, per-seal salt) — a 256-bit WIF makes this
 * cryptographically unbreakable; GCM tag rejects any wrong key instantly.
 */
import crypto from "crypto";
import { db } from "@/lib/db";
import { deriveKek, sealWith, openWith, Seal } from "./crypto";

export interface KeySeal {
  pub: string;
  chain: string;
  account: string;
  role: string;
  kdfSalt: string;
  encMaster: string;
  sealIv: string;
  sealTag: string;
  addedAt: string;
}

export function makeKeySeal(masterHex: string, key: string, identity: { pub: string; chain: string; account: string; role: string }): KeySeal {
  const salt = crypto.randomBytes(16).toString("hex");
  const kek = deriveKek(key, salt);
  const seal: Seal = sealWith(kek, masterHex);
  return {
    pub: identity.pub, chain: identity.chain, account: identity.account, role: identity.role,
    kdfSalt: salt, encMaster: seal.ct, sealIv: seal.iv, sealTag: seal.tag,
    addedAt: new Date().toISOString(),
  };
}

export async function loadKeySeals(): Promise<KeySeal[]> {
  const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
  if (!cfg?.keySeals) return [];
  try {
    const arr = JSON.parse(cfg.keySeals);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveKeySeals(seals: KeySeal[]): Promise<void> {
  await db.gateConfig.update({ where: { id: "gate" }, data: { keySeals: JSON.stringify(seals) } });
}

export function openMasterWithKey(key: string, seal: KeySeal): string {
  return openWith(deriveKek(key, seal.kdfSalt), { ct: seal.encMaster, iv: seal.sealIv, tag: seal.sealTag });
}
