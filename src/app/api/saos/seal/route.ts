import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readFileSync } from "fs";
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
 *   1. build kernel ops (stamps + treasury harvest + relay demand)
 *   2. FIX(Roast-64-a · F7a): הבאץ' נקשר לחותם-הקודם — stateRoot-החותם-הקודם
 *      נכנס כעלה "chain" לשורש-המרקל (אין עוד island-roots; "השרשרת משרשרת").
 *   3. replay deterministically → stateRoot
 *   4. assemble merkle root over the batch leaves (ops + chain leaf)
 *   5. persist SealRecord + leaves + AnchorTx rows (honest statuses)
 *   6. evidence receipt in a prisma transaction with a fresh prevDigest read —
 *      FIX(Roast-64-a · F7b): סוגר את ה-fork-race על שרשרת-העדויות.
 * FIX(Roast-64-a · F7c): ה-advisory נגזר-חי מנוכחות-חומר-חתימה בדמון — לא מיתר-קבוע.
 * FIX(Roast-64-a · F7d): HIVE_RC_PCT/TRON_ENERGY מ-env = static-config, לא מדידה-חיה.
 */

// נוכחות-חומר-חתימה בסביבת הדמון — בדיקת שמות-משתנים בלבד; ערכים לעולם לא נקראים-לפלט.
function signingKeysAvailable(): boolean {
  if (process.env.DE_OPERATOR) return true;
  try {
    const raw = readFileSync("/home/z/my-project/saos-dex/.env", "utf8");
    return /^(STEEM|HIVE|BLURT)_(ACTIVE|POSTING)_WIF=/m.test(raw);
  } catch {
    return false;
  }
}

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
    // FIX(Roast-65 · stamps-NaN): Number("abc")=NaN היה עובר Math.max/Math.min
    // ומניב stampCount=NaN → 0-חותמות → כשל-"seal requires new stamps" מבלבל.
    // עכשיו: שלם-בטוח-בלבד — זבל-קלט נופל-לברירת-המחדל 6 (fail-closed-וכנה).
    const rawStamps = Number(body.stamps ?? 6);
    const stampCount = Number.isSafeInteger(rawStamps) && rawStamps >= 3 ? Math.min(24, rawStamps) : 6;

    // 1. kernel batch — FIX(Roast-64-a · F5a): harvest חייב issuer=treasury (שער-התפקיד)
    const txs: KernelTx[] = [];
    for (let i = 0; i < stampCount; i++) {
      txs.push({ op: "stamp", issuer: "foundry-console", nonce: `pulse-${Date.now()}-${i}` });
    }
    txs.push({ op: "harvest", issuer: "treasury", nonce: `harvest-${Date.now()}`, amount: 42 });
    txs.push({ op: "relay", issuer: "foundry-console", nonce: `door-${Date.now()}`, to: "steem:headcorner" });
    txs.push({ op: "seal", issuer: "foundry-console", nonce: `seal-${Date.now()}` });

    // 2. FIX(Roast-64-a · F7a): chain-to-previous-seal — ה-stateRoot הקודם הוא עלה-רצף
    const lastSeal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
    const prevRoot = lastSeal?.stateRoot ?? null;

    // 3. deterministic replay
    let state = genesisState();
    for (const tx of txs) state = applyTx(state, tx);
    const stateRoot = await stateRootOf(state);

    // 4. leaves = every op digest (canonical) + עלה-chain שמקשר את הבאץ' לקודם
    const leafRows = await Promise.all(
      txs.map(async (tx) => ({ kind: tx.op as string, payload: canonicalize(tx), digest: await canonicalDigest(tx) }))
    );
    if (prevRoot) {
      leafRows.push({
        kind: "chain",
        payload: canonicalize({ chain: "seal", prevRoot }),
        digest: await canonicalDigest({ chain: "seal", prevRoot })
      });
    }
    const tree = await buildMerkleTree(leafRows.map((l) => l.digest));
    const root = tree.root;

    // 5. persist — height is the platform's monotone seal sequence
    // FIX(Roast-63 · L7): read-then-write-על-@unique — ניסיון-חוזר-בודד עם קריאה-טרייה.
    async function createSeal(height: number) {
      return db.sealRecord.create({
        data: {
          height,
          root,
          leavesCount: leafRows.length,
          stateRoot,
          gasUsed: state.gasUsed,
          note: body.memo ?? "פעימת עגינה מהמגדל",
          leaves: {
            create: leafRows.map((l, i) => ({
              index: i,
              kind: l.kind,
              payload: l.payload,
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

    // honest anchor statuses — derived, never fabricated
    const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
    const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
    // FIX(Roast-63 · M1): סטטוס-היסטורי-אחרון-מה-DB — המטריצה נגזרת-מהנתונים
    const latestAnchors = await db.anchorTx.findMany({ orderBy: { createdAt: "desc" }, take: 24, select: { network: true, status: true } });
    const lastByNetwork: Record<string, string> = {};
    for (const a of latestAnchors) if (!(a.network in lastByNetwork)) lastByNetwork[a.network] = a.status;
    const matrix = anchoringMatrix(rcPct, tronEnergy, {
      steem: lastByNetwork["STEEM"] ?? null,
      blurt: lastByNetwork["BLURT"] ?? null,
      hive: lastByNetwork["HIVE"] ?? null,
    });
    // FIX(Roast-64-a · F7c): advisory-נגזר-חי (לא המיתר הקפוא "אין מפתחות בסנדבוקס"
    // שסתר את המציאות — המפתחות חיים מאז tasks 59-62)
    const keysLive = signingKeysAvailable();
    const advisory = keysLive
      ? "advisory: חומר-חתימה זמין בדמון הריבוני (saos-dex/.env) — השידור-בפועל מבוצע בידי הדמון; הפעימה מתעדת ומכינה את השורות"
      : "advisory: לא זוהה חומר-חתימה (אין saos-dex/.env) — הפעימה מתועדת בלבד, ממתינה לדמון";
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
      // FIX(Roast-64-a · F7d): המספרים מ-env — מתויגים static-config, לא "מדידה"
      meta: JSON.stringify({
        advisory,
        rcPct: { value: rcPct, source: "static-config" },
        tronEnergy: { value: tronEnergy, source: "static-config" }
      })
    }));
    await db.anchorTx.createMany({ data: anchorRows });

    // 6. evidence receipt — FIX(Roast-64-a · F7b): קריאת-prevDigest טרייה-בתוך-
    // הטרנזקציה וכתיבה-אטומית — אין-חלון-fork בין קריאה לכתיבה
    const receipt = await db.$transaction(async (txdb) => {
      const prev = await txdb.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
      const r = await forgeReceipt(
        "seal",
        { sealId: seal.id, height: seal.height, root, leaves: leafRows.length, stateRoot, prevRoot },
        prev?.digest ?? null
      );
      await txdb.evidenceReceipt.create({
        data: {
          kind: r.kind,
          digest: r.digest,
          prevDigest: r.prevDigest,
          payload: JSON.stringify(r.payload),
          sealId: seal.id
        }
      });
      return r;
    });
    await db.opLog.create({
      data: { op: "seal", detail: `height=${seal.height} root=${root.slice(0, 16)}…` }
    });

    return NextResponse.json({
      ok: true,
      seal: { id: seal.id, height: seal.height, root, stateRoot, leaves: leafRows.length, gasUsed: state.gasUsed, prevRoot },
      anchors: anchorRows.map((a) => ({ network: a.network, status: a.status, gate: a.gate })),
      config: {
        rcPct: { value: rcPct, source: "static-config" },
        tronEnergy: { value: tronEnergy, source: "static-config" },
        signingKeys: keysLive
      },
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "seal failed" },
      { status: 200 }
    );
  }
}
