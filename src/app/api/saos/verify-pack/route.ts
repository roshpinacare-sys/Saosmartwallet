import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "@/lib/saos/merkle";
import { canonicalDigest } from "@/lib/saos/canonical-json";

export const dynamic = "force-dynamic";

/**
 * verify-pack — the public proof surface: latest seal → merkle tree →
 * inclusion proof for every leaf → independent verification.
 * Anyone can verify without trusting us. (steem-main verify-pack discipline)
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

    // FIX(Roast-63 · H2): אין-עוד-כתיבה-ב-GET (היה-רישום-קבלה-בכל-סקר = הצפת-שרשרת).
    // FIX(Roast-63 · M12): במקום-זאת — **מאמתים-את-שרשרת-העדויות-עצמה** כאן
    // (verifyChain היה-מוגדר-ומעולם-לא-נקרא — השרשרת-יכלה-להיחבל-בלי-שאף-אחד-יבחין).
    // שחזור-ה-preimage: {kind, at, payload, prevDigest} — ה-"at" לא-נשמר-בפני-עצמו,
    // רק-createdAt (אותו-שעון-תהליך; ms-גבולי-עלול-להחליק) → שני-candidates-כנים.
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
        const d = await canonicalDigest({ kind: r.kind, at, payload, prevDigest: r.prevDigest });
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
      howToVerify: [
        "קח את sampleProof.path",
        "hash = leaf; לכל צעד: dir==='R' ? sha256(hash+sibling) : sha256(sibling+hash)",
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
