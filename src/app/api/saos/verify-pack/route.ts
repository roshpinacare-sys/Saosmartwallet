import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "@/lib/saos/merkle";
import { canonicalDigest } from "@/lib/saos/canonical-json";
import { receiptPreimage } from "@/lib/saos/evidence";

export const dynamic = "force-dynamic";

/**
 * verify-pack — the public proof surface: latest seal → merkle tree →
 * inclusion proof for every leaf → independent verification.
 * Anyone can verify without trusting us. (steem-main verify-pack discipline)
 *
 * FIX(Roast-64-a · F2): ההוכחה עודכנה לסכמה-המופרדת-דומיינים (RFC-6962-style):
 * leaf = sha256(0x00‖leaf) · node = sha256(0x01‖L‖R) · root = sha256(0x02‖u32le(count)‖top).
 * הוכחות-שורשים-ישנות-שנחתמו-בסכמה-הקודמת לא יאומתו עוד (rootMatches=false כנה)
 * — פעימת-עגינה חדשה מייצרת root-מאומת-תחת-הסכמה-החדשה.
 */
export async function GET() {
  try {
    const seal = await db.sealRecord.findFirst({
      orderBy: { createdAt: "desc" },
      include: { leaves: true }
    });

    if (!seal || seal.leaves.length === 0) {
      return NextResponse.json({
        ok: true,
        empty: true,
        message: "אין חותם עדיין — צור חותם ראשון דרך POST /api/saos/seal"
      });
    }

    const leaves = [...seal.leaves].sort((a, b) => a.index - b.index).map((l) => l.digest);
    const tree = await buildMerkleTree(leaves);
    const rootMatches = tree.root === seal.root;

    // prove + verify EVERY leaf — full independent verification
    interface ProofResult { index: number; leaf: string; verified: boolean; }
    const proofs: ProofResult[] = [];
    for (let i = 0; i < tree.leaves.length; i++) {
      const p = await merkleProof(tree, i);
      const verified = await verifyMerkleProof(p);
      proofs.push({ index: i, leaf: p.leaf.slice(0, 20) + "…", verified });
    }
    const allVerified = proofs.every((p) => p.verified);

    // FIX(Roast-63 · H2): אין-עוד-כתיבה-ב-GET (היה-רישום-קבלה-בכל-סריקה = הצפת-שרשרת).
    // FIX(Roast-63 · M12): במקום-זאת — **מאמתים-את-שרשרת-העדויות-עצמה** כאן.
    // FIX(Roast-64-a · F4): ה-preimage כולל את גבול-האמת (truth) — דרך receiptPreimage,
    // מקור-האמת-היחיד של forge/verify. truth לא נשמר-ב-DB — האימות-מה-DB מניח את
    // ברירת-המחדל-הכנה (NONE/0); קבלה-שנוצרה-עם-truth-אחר לא תעבור אימות (fail-closed).
    // ה-"at" לא-נשמר-בפני-עצמו, רק-createdAt (אותו-שעון-תהליך; ms-גבולי-עלול-
    // להחליק) → שני-candidates-כנים.
    const receipts = await db.evidenceReceipt.findMany({ orderBy: { createdAt: "asc" } });
    let prevDigest: string | null = null;
    let chainOk = true;
    let chainBrokenAt: number | null = null;
    for (let i = 0; i < receipts.length; i++) {
      const r = receipts[i]!;
      const payload = JSON.parse(r.payload) as Record<string, unknown>;
      const cands = [
        r.createdAt.toISOString(),
        new Date(Math.floor(r.createdAt.getTime() / 1000) * 1000).toISOString(),
      ];
      let matched: string | null = null;
      for (const at of cands) {
        const d = await canonicalDigest(receiptPreimage({ kind: r.kind, at, payload, prevDigest: r.prevDigest }));
        if (d === r.digest) { matched = d; break; }
      }
      if (matched === null || r.prevDigest !== prevDigest) {
        chainOk = false; chainBrokenAt = i; break;
      }
      prevDigest = r.digest;
    }
    const chainCheck = { ok: chainOk, brokenAt: chainBrokenAt };

    return NextResponse.json({
      ok: true,
      seal: {
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        createdAt: seal.createdAt
      },
      tree: { leaves: leaves.length, levels: tree.levels.length, root: tree.root },
      rootMatches,
      allVerified,
      proofs,
      sampleProof: await merkleProof(tree, 0),
      evidenceChain: { receipts: receipts.length, ok: chainCheck.ok, brokenAt: chainCheck.brokenAt },
      // FIX(Roast-64-a · F2): כנות-לשורשים-ישנים — root-שנחתם-בסכמה-הקודמת לא יאומת
      ...(rootMatches ? {} : { legacyRootNote: "root-זה נחתם בסכמה-הקודמת (ללא הפרדת-דומיינים ואיגוד-מספר-עלים) — הרץ פעימת-עגינה חדשה לשורש-מאומת-תחת-הסכמה-הנוכחית" }),
      howToVerify: [
        "קח את sampleProof.path",
        "hash = sha256(0x00 || leafBytes) — עלה מגובש בהפרדת-דומיין",
        "לכל צעד: dir==='R' ? sha256(0x01 || hash || sibling) : sha256(0x01 || sibling || hash)",
        "בסוף: root = sha256(0x02 || uint32le(leafCount) || hash) — מספר-העלים אגוד-בשורש (anti-CVE-2012-2459)",
        "השווה ל-root — שוויון = העלה כלול בחותם, בלי לסמוך עלינו"
      ]
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "verify-pack failed" },
      { status: 200 }
    );
  }
}
