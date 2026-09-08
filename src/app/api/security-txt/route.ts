/**
 * GET /api/security-txt — RFC 9116 security.txt
 * ==============================================
 * The standardized place where security researchers look for how to report
 * vulnerabilities in this system. Served at /.well-known/security.txt via a
 * rewrite in next.config.ts (the dot-folder is not routable in App Router).
 *
 * Zero-mock: every field is a REAL, reachable channel —
 *  · Contact  → this repo's GitHub security advisory flow (private by design)
 *  · Policy   → docs/security.md in this repo (threat model + disclosure)
 *  · Expires  → 90-day rollover, recomputed on each security-affecting push
 */

export const dynamic = "force-static";

const REPO = "https://github.com/roshpinacare-sys/Saosmartwallet";
// 90 days from the fix-round (2026-09-08); must be rolled on security-affecting pushes.
const EXPIRES = "2026-12-07T00:00:00.000Z";

export function GET() {
  const body = [
    `Contact: ${REPO}/security/advisories/new`,
    `Contact: ${REPO}/issues`,
    `Expires: ${EXPIRES}`,
    `Preferred-Languages: he, en, zh`,
    `Canonical: ${REPO}/.well-known/security.txt`,
    `Policy: ${REPO}/blob/main/docs/security.md`,
  ].join("\n");

  return new Response(`${body}\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
