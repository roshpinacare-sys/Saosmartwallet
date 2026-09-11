/**
 * SOVEREIGN GATE — r32 mechanical seal refresh ("הכספת נאטמת תחת כל מפתח-נוכחי").
 *
 * THE DISEASE (r32 root-cause): keySeals are written only at vault bootstrap.
 * When the fleet rotated headcorner's STEEM authorities on-chain (r16/r17 —
 * D1 roots), the vault correctly sealed the new key rows as verified entries
 * but the MASTER stayed sealed only under the OLD steem keys (now rotated-out)
 * plus the current hive keys. Result: an operator pasting a current steem key
 * passed the live chain proof yet had no seal to open the vault with —
 * "המפתח שלי עבד פעם והיום לא".
 *
 * THE CURE: every successful unlock re-proves, in the same call, which
 * headcorner steem/hive rows hold CURRENT live authority (fresh authority map,
 * raw-33-byte identity — prefix-proof) and seals the master under every one
 * that lacks a seal. After ONE login with any current key, EVERY current key
 * opens the vault — forever, mechanically, with gap-60 material consistency
 * (the sealed WIF must reproduce its own pub or the row is refused).
 */
import { db } from "@/lib/db";
import { openSecretWith } from "./crypto";
import { fetchChainAuthorityMap, pubRaw33, wifToChainPub } from "./key-id";
import { loadKeySeals, makeKeySeal, saveKeySeals, KeySeal } from "./key-seal";

export interface SealRefreshResult {
  added: number;
  addedRoles: string[]; // e.g. ["steem·owner", "steem·active"]
  currentSealed: number; // total seals that hold live authority after refresh
}

export async function refreshKeySeals(
  master: Buffer,
  prefetched?: Awaited<ReturnType<typeof fetchChainAuthorityMap>>,
): Promise<SealRefreshResult> {
  const rows = await db.vaultEntry.findMany({
    where: { kind: "steem-key", account: "headcorner", chain: { in: ["steem", "hive"] } },
  });
  const { map } = prefetched || (await fetchChainAuthorityMap());
  const seals = await loadKeySeals();

  const liveRaw = (pub: string | null, chain: string): string | null => {
    const raw = pub ? pubRaw33(pub) : null;
    if (!raw) return null;
    const ctl = map.get(raw) || [];
    return ctl.some((c) => c.account === "headcorner" && c.chain === chain) ? raw : null;
  };

  const sealRaws = new Set<string>();
  let currentSealed = 0;
  for (const s of seals) {
    const raw = liveRaw(s.pub, s.chain);
    if (raw) {
      sealRaws.add(raw);
      currentSealed++;
    }
  }

  const addedRoles: string[] = [];
  for (const e of rows) {
    if (!e.pub || (e.chain !== "steem" && e.chain !== "hive")) continue;
    const raw = liveRaw(e.pub, e.chain);
    if (!raw || sealRaws.has(raw)) continue;
    let wif: string;
    try {
      wif = openSecretWith(master, e);
    } catch {
      continue; // master mismatch for this row — skip honestly
    }
    // gap-60: the sealed material must reproduce its own pub — never seal a phantom
    try {
      if (wifToChainPub(wif) !== e.pub) continue;
    } catch {
      continue;
    }
    const seal: KeySeal = makeKeySeal(master.toString("hex"), wif, {
      pub: e.pub, chain: e.chain, account: "headcorner", role: e.role || "key",
    });
    seals.push(seal);
    sealRaws.add(raw);
    currentSealed++;
    addedRoles.push(`${e.chain}·${e.role}`);
  }

  if (addedRoles.length) await saveKeySeals(seals);
  return { added: addedRoles.length, addedRoles, currentSealed };
}
