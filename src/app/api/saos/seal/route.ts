import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireOwner, ownerLockActive } from "@/lib/auth";
import { applyTx, genesisState, stateRootOf, type KernelTx } from "@/lib/saos/kernel";
import { buildMerkleTree } from "@/lib/saos/merkle";
import { canonicalDigest, canonicalize } from "@/lib/saos/canonical-json";
import { forgeReceipt } from "@/lib/saos/evidence";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/seal — run an anchoring pulse (פעימת-עגינה).
 * Full honest discipline:
 *   1. build kernel ops (stamps + harvest + relay demand)
 *   2. replay deterministically → stateRoot
 *   3. assemble merkle root over the batch leaves
 *   4. persist SealRecord + leaves + AnchorTx rows (honest statuses)
 *   5. chain an evidence receipt
 * Anchors here are ADVISORY (no signing keys in this sandbox) — statuses say so.
 */
export async function POST(req: NextRequest) {
  // FIX(Roast-63 · H2/H1): היה-כתיבה-גלויה-לשרשרת-ההוכחות (כל-מי-ברשת-יכול-היה-
  // לזייף-SealRecords). עכשיו: owner-בלבד + כיבוד-ownerLock (השומר-שלא-יקרה-שוב).
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: "owner-only (seal = מוטציית-שרשרת-הוכחות)" }, { status: 401 });
  if (await ownerLockActive()) return NextResponse.json({ ok: false, error: "ownerLock-פעיל — בטל-נעילה-ב-/api/guard כדי-להריץ-פעימת-עגינה" }, { status: 403 });
  try {
    let body: { stamps?: number; memo?: string } = {};
    try {
      body = await req.json();
    } catch {
      // no body — defaults
    }
    const stampCount = Math.min(24, Math.max(3, Number(body.stamps ?? 6)));

    // 1. kernel batch
    const txs: KernelTx[] = [];
    for (let i = 0; i < stampCount; i++) {
      txs.push({ op: "stamp", issuer: "foundry-console", nonce: `pulse-${Date.now()}-${i}` });
    }
    txs.push({ op: "harvest", issuer: "grid-98", nonce: `harvest-${Date.now()}`, amount: 42 });
    txs.push({ op: "relay", issuer: "foundry-console", nonce: `door-${Date.now()}`, to: "steem:headcorner" });
    txs.push({ op: "seal", issuer: "foundry-console", nonce: `seal-${Date.now()}` });

    // 2. deterministic replay
    let state = genesisState();
    for (const tx of txs) state = applyTx(state, tx);
    const stateRoot = await stateRootOf(state);

    // 3. leaves = every op digest (canonical) — the batch the root covers
    const leafPayloads = await Promise.all(
      txs.map(async (tx) => ({ tx, digest: await canonicalDigest(tx) }))
    );
    const tree = await buildMerkleTree(leafPayloads.map((l) => l.digest));
    const root = tree.root;

    // 4. persist — height is the platform's monotone seal sequence
    const lastSeal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
    // FIX(Roast-63 · L7): read-then-write-על-@unique — שתי-פעימות-מקבילות-זרקו-unique-
    // violation. ניסיון-חוזר-בודד-עם-קריאה-טרייה-מקטין-את-החלון-ל-אפס-מעשי.
    async function createSeal(height: number) {
      return db.sealRecord.create({
        data: {
          height,
          root,
          leavesCount: leafPayloads.length,
          stateRoot,
          gasUsed: state.gasUsed,
          note: body.memo ?? "פעימת עגינה מהמגדל",
          leaves: {
            create: leafPayloads.map((l, i) => ({
              index: i,
              kind: l.tx.op,
              payload: canonicalize(l.tx),
              digest: l.digest
            }))
          }
        }
      });
    }
    let seal;
    try {
      seal = await createSeal((lastSeal?.height ?? 0) + 1);
    } catch (e) {
      if (!(e instanceof Object && 'code' in e && (e as { code?: string }).code === 'P2002')) throw e;
      const retry = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
      seal = await createSeal((retry?.height ?? 0) + 1);
    }

    // honest anchor statuses — advisory mode, never fabricated
    const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
    const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
    // FIX(Roast-63 · M1): סטטוס-היסטורי-אחרון-מה-DB (לפני-הפעימה-הנוכחית) — המטריצה
    // נגזרת-מהנתונים, ואז-השורות-החדשות-נכתבות-ממנה
    const latestAnchors = await db.anchorTx.findMany({ orderBy: { createdAt: "desc" }, take: 24, select: { network: true, status: true } });
    const lastByNetwork: Record<string, string> = {};
    for (const a of latestAnchors) if (!(a.network in lastByNetwork)) lastByNetwork[a.network] = a.status;
    const matrix = anchoringMatrix(rcPct, tronEnergy, {
      steem: lastByNetwork["STEEM"] ?? null,
      blurt: lastByNetwork["BLURT"] ?? null,
      hive: lastByNetwork["HIVE"] ?? null,
    });
    const advisory =
      "advisory-mode: אין מפתחות חתימה בסנדבוקס — הפעימה מתועדת ומוכנה לשידור כשהכספת חוזרת";
    const anchorRows = matrix.map((m) => ({
      sealId: seal.id,
      network: m.network,
      kind: "weave",
      txid: null,
      status:
        m.network === "STEEM" || m.network === "BLURT"
          ? "pending"
          : m.network === "HIVE"
            ? "gated"
            : "transit",
      gate:
        m.network === "HIVE" && m.gate
          ? `${m.gate} · ${advisory}`
          : m.network === "TRON" && tronEnergy === 0
            ? `energy-0 · ${advisory}`
            : advisory,
      meta: JSON.stringify({ advisory, rcPct, tronEnergy })
    }));
    await db.anchorTx.createMany({ data: anchorRows });

    // 5. evidence receipt
    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "seal",
      { sealId: seal.id, height: seal.height, root, leaves: leafPayloads.length, stateRoot },
      prev?.digest ?? null
    );
    await db.evidenceReceipt.create({
      data: {
        kind: receipt.kind,
        digest: receipt.digest,
        prevDigest: receipt.prevDigest,
        payload: JSON.stringify(receipt.payload),
        sealId: seal.id
      }
    });
    await db.opLog.create({
      data: { op: "seal", detail: `height=${seal.height} root=${root.slice(0, 16)}…` }
    });

    return NextResponse.json({
      ok: true,
      seal: { id: seal.id, height: seal.height, root, stateRoot, leaves: leafPayloads.length, gasUsed: state.gasUsed },
      anchors: anchorRows.map((a) => ({ network: a.network, status: a.status, gate: a.gate })),
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "seal failed" },
      { status: 200 }
    );
  }
}
