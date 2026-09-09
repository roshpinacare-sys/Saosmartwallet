import { db } from "@/lib/db";
import { sealSecret, GateError } from "@/lib/gate/crypto";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { identifyKey } from "@/lib/gate/key-id";

export const runtime = "nodejs";

/** POST /api/gate/key — { key, save?: boolean, label?: string }
 *  Identify any key live; optionally save it encrypted into the vault. */
export async function POST(req: Request) {
  try {
    const session = await requireOperator();
    const { key, save, label } = await req.json();
    if (typeof key !== "string" || !key.trim()) throw new GateError("bad-input", "דרוש מפתח");
    const report = await identifyKey(String(key));

    let saved: { id: string; chain: string | null; account: string | null; role: string | null }[] = [];
    if (save) {
      if (!report.liveChecked && report.kind === "steem-wif")
        throw new GateError("chain-unreachable", "לא ניתן לאמת מול השרשרת — לא שומר מפתח לא-מאומת");
      const targets = report.controls.length
        ? report.controls
        : [{ chain: report.kind === "github-pat" ? "github" : null, account: null, role: report.kind === "github-pat" ? "token" : "wallet", pub: report.pubs[0] || null }];
      for (const t of targets) {
        const dup = await db.vaultEntry.findFirst({
          where: { kind: kindOf(report.kind), chain: t.chain, account: t.account, role: t.role, pub: t.pub },
        });
        if (dup) {
          saved.push({ id: dup.id, chain: dup.chain, account: dup.account, role: dup.role });
          continue;
        }
        const sealed = sealSecret(String(key));
        const row = await db.vaultEntry.create({
          data: {
            kind: kindOf(report.kind), chain: t.chain, account: t.account, role: t.role, pub: t.pub,
            status: report.controls.length ? "verified" : "imported",
            verifyNote: report.controls.length ? "אומת live בעת-הייבוא" : (label || "יובא על-ידי המפעיל"),
            source: "operator-input", verifiedAt: report.controls.length ? new Date() : null, ...sealed,
          },
        });
        saved.push({ id: row.id, chain: row.chain, account: row.account, role: row.role });
        await db.gateMessage.create({
          data: {
            fromKind: "system", fromName: "gate",
            body: `מפתח חדש נשמר מוצפן: ${t.chain || report.kind}${t.account ? " · " + t.account : ""}${t.role ? "@" + t.role : ""} (סוכן: ${session.name})`,
          },
        });
      }
    }
    // report never contains the private material
    return ok({ report, saved });
  } catch (e) {
    return fail(e);
  }
}

function kindOf(k: string): string {
  if (k === "steem-wif") return "steem-key";
  if (k === "evm-key") return "evm-key";
  if (k === "hex-priv") return "tron-key";
  if (k === "mnemonic") return "mnemonic";
  if (k === "github-pat") return "token";
  return "note";
}
