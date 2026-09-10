import { NextResponse } from "next/server";
import { kernelSelftest } from "@/lib/saos/kernel";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await kernelSelftest();

    // FIX(Roast-63 · H2): GET-קריאה-בלבד — היה-רושם-קבלה-לשרשרת-העדויות-בכל-סקר
    // (GET-עם-side-effect = אפשרות-הצפת-שרשרת-החש-בלופ-פשוט). ה-selftest עצמו
    // דטרמיניסטי — אין-ערך-עדות-בכל-חזרה.
    return NextResponse.json({ ok: result.ok, result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "selftest failed" },
      { status: 200 }
    );
  }
}
