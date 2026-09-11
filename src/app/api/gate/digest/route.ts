import { fail, ok } from "@/lib/gate/http";
import { getBroadcastDigest } from "@/lib/gate/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gate/digest — THE COMPREHENSION PLANE (r25) + THE FRONT-DOOR PLANE (r26).
 * The vault reads the mutual broadcasts/ channel: per-repo latest broadcast
 * content is hashed (sha256), echoes of our own report are identified,
 * partner voices are classified (report/question/request/alert/response) with
 * their headline + extracted asks, and a draft-only suggested response is built.
 * r26 adds: our own broadcasts/ is scanned as a DOOR (any file not authored by
 * us is an incoming voice — the platform's response landed there), and our repo
 * ROOT is scanned for partner reports that bypassed the channel (root voices).
 * Bounded (~1 content call per repo + ≤2 listings on the same 10-min cadence),
 * every repo fails honestly and independently; hashes + headlines only — no raw
 * dump, no secrets. The vault DRAFTS an answer, it never auto-sends one.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const digest = await getBroadcastDigest(force);
    return ok(digest);
  } catch (e) {
    return fail(e);
  }
}
