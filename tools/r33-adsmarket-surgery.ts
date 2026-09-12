/**
 * r33 — Adsmarket surgery (single atomic commit via git data API).
 * 1. DELETE internal operator reports (broadcasts, SAOS-*, docs/reports,
 *    roast, strategy, ops guides) — the command bridge stays home.
 * 2. DELETE Hebrew marketing duplicates that have English twins
 *    (articles 01-07 he, identity-api.md, Hebrew HTML pages).
 * 3. UPSERT English marketing files from staging (ads-pack, brand, articles).
 * 4. Hebrew landing pages become tiny English redirect stubs (links survive).
 * The PAT never leaves this process; nothing is printed but counts+paths.
 */
import fs from "fs";

const H = { Authorization: `Bearer ${fs.readFileSync("/tmp/gh_token_hidden", "utf8")}`, Accept: "application/vnd.github+json" };
const REPO = "repos/roshpinacare-sys/Adsmarket";
const api = async (p: string, init?: RequestInit) => {
  const r = await fetch(`https://api.github.com/${p}`, { headers: H, ...init });
  if (!r.ok) throw new Error(`${p} → ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
};

const staging = "/home/z/my-project/tmp-analysis/ads-en-staging";
const UPSERT: Record<string, string> = {
  "content/ads/ads-pack.md": `${staging}/content/ads/ads-pack.md`,
  "brand.md": `${staging}/brand.md`,
  "content/articles/en/02-why-everyone-claims-and-nobody-proves.md": `${staging}/content/articles/en/02-why-everyone-claims-and-nobody-proves.md`,
  "content/articles/en/04-the-machine-that-admits-mistakes.md": `${staging}/content/articles/en/04-the-machine-that-admits-mistakes.md`,
  "content/articles/en/05-your-2017-account-is-worth-more.md": `${staging}/content/articles/en/05-your-2017-account-is-worth-more.md`,
  "content/articles/en/06-the-machine-that-healed-itself.md": `${staging}/content/articles/en/06-the-machine-that-healed-itself.md`,
  "faq.md": `${staging}/faq.md`,
  "glossary.md": `${staging}/glossary.md`,
  "ecosystem.md": `${staging}/ecosystem.md`,
  "pitch.md": `${staging}/pitch.md`,
  "compare.md": `${staging}/compare.md`,
  "disclosure-policy.md": `${staging}/disclosure-policy.md`,
  "press/press-kit.md": `${staging}/press/press-kit.md`,
  "content/email/drip-3.md": `${staging}/content/email/drip-3.md`,
  "content/video/scripts.md": `${staging}/content/video/scripts.md`,
  "social.md": `${staging}/social.md`,
};
const DELETE = [
  // internal operator reports — never belong in the marketing repo
  "docs/reports/CLAIMS-AUDIT-2026-09-12.md", "docs/reports/CLAIMS-AUDIT-PREVIEW-2026-09-12.md",
  "docs/reports/SAOS-DAILY-REPORT-2026-09-11-ADSMARKET.md", "docs/reports/SAOS-DAILY-REPORT-2026-09-11.md",
  "docs/reports/SAOS-PULSE-2026-09-11-H16-COMPLETE.md", "docs/reports/SAOS-PULSE-2026-09-11-H16-SIX-OF-SIX.md",
  "docs/reports/SAOS-PULSE-2026-09-11-H17-REPEAT.md", "docs/reports/SAOS-PULSE-2026-09-11-H18-THIRD-CYCLE.md",
  "docs/reports/SAOS-PULSE-2026-09-11-H19-FOURTH-CYCLE.md", "docs/reports/SAOS-PULSE-2026-09-11-H20-FULL-MATRIX-CONSOLIDATION-2.md",
  "docs/reports/SAOS-PULSE-2026-09-11-H20-FULL-MATRIX-CONSOLIDATION.md", "docs/reports/SAOS-PULSE-2026-09-11-H21-SIXTH-CYCLE.md",
  "docs/reports/SAOS-PULSE-2026-09-11-H22-H23-AUTOMATION.md", "docs/reports/SAOS-PULSE-2026-09-11-H24-EIGHTH-CYCLE.md",
  "docs/reports/SAOS-PULSE-2026-09-12-CLAIMS-AUDIT-R2.md", "docs/reports/SAOS-PULSE-2026-09-12-CLAIMS-AUDIT-R3.md",
  "docs/reports/SAOS-PULSE-2026-09-12-CLAIMS-AUDIT-R6.md", "docs/reports/SAOS-PULSE-2026-09-12-CONVERSION-VERDICT-H28.md",
  "docs/reports/SAOS-PULSE-2026-09-12-H25-NINTH-CYCLE.md", "docs/reports/SAOS-PULSE-2026-09-12-H26-TENTH-CYCLE.md",
  "docs/reports/SAOS-PULSE-2026-09-12-H27-ELEVENTH-CYCLE.md", "docs/reports/SAOS-PULSE-2026-09-12-R10-VAULT-SELF-HEAL.md",
  "docs/reports/SAOS-PULSE-2026-09-12-R8-EIGHTH-AUDIT.md", "docs/reports/SAOS-PULSE-2026-09-12-R9-ZERO-BREAKTHROUGH.md",
  "docs/reports/SAOS-STRATEGY-2026-09-11-ADSMARKET.md", "docs/reports/TOKEN-DOSSIER-2026-09-12-V77.md",
  "SAOS-DAILY-REPORT-2026-09-11-ADSMARKET.md", "SAOS-DAILY-REPORT-2026-09-11-FOUNDRY.md", "SAOS-DAILY-REPORT-2026-09-11.md",
  "SAOS-PULSE-2026-09-11-H16-COMPLETE.md", "SAOS-PULSE-2026-09-11-H16-SIX-OF-SIX.md", "SAOS-PULSE-2026-09-11-H17-REPEAT.md",
  "SAOS-PULSE-2026-09-11-H18-THIRD-CYCLE.md", "SAOS-PULSE-2026-09-11-H19-FOURTH-CYCLE.md", "SAOS-PULSE-2026-09-11-H20-FULL-MATRIX-CONSOLIDATION-2.md",
  "SAOS-PULSE-2026-09-11-H20-FULL-MATRIX-CONSOLIDATION.md", "SAOS-PULSE-2026-09-11-H21-SIXTH-CYCLE.md", "SAOS-PULSE-2026-09-11-H22-H23-AUTOMATION.md",
  "SAOS-BRIEFING-2026-09-11-ROAST-80.md", "SAOS-BRIEFING-2026-09-11-ROAST-84.md", "SAOS-COIN-DOSSIER-2026-09-12-V77.md",
  "2026-09-11-roast-78-addendum.md",
  "strategy/SAOS-MASTER-PLAN-2026-09-11.md", "guides/00-master-operations.md", "guides/01-content-production-workflow.md",
  "content/OPS-DOCTRINE.md", "content/README.md",
  "roast/2026-09-10-kit-selfroast.md", "roast/2026-09-10-network-audit.md", "roast/2026-09-10-truth-gaps.md",
  // Hebrew marketing with English twins
  "content/articles/01-ma-ze-saos.md", "content/articles/02-lama-meshakrim-lanu.md", "content/articles/03-ha-notarion-be-agorot.md",
  "content/articles/04-ha-mehona-shemodaah-betaut.md", "content/articles/05-ha-heshbon-hayashan-shelahem.md",
  "content/articles/06-ha-mehona-she-helima-etzma.md", "content/articles/07-key-guardianship.md",
  "content/products/identity-api.md",
];
const REDIRECT = [
  ["index.html", "index-en.html"],
  ["onepager.html", "onepager-en.html"],
  ["content/explainer/index.html", "en.html"],
];

async function main() {
  const repo = await api(REPO);
  const ref = await api(`${REPO}/git/ref/heads/main`);
  const baseCommitSha = ref.object.sha as string;
  const base = await api(`${REPO}/git/commits/${baseCommitSha}`);
  const baseTreeSha = base.tree.sha;

  const nodes: Record<string, unknown>[] = [];
  for (const p of DELETE) nodes.push({ path: p, mode: "100644", type: "blob", sha: null }); // deletion
  for (const [p, to] of REDIRECT) {
    nodes.push({
      path: p, mode: "100644", type: "blob",
      content: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>SAOS</title><meta http-equiv="refresh" content="0; url='${to}'"><link rel="canonical" href="${to}"></head><body>English version: <a href="${to}">${to}</a></body></html>`,
    });
  }
  for (const [p, src] of Object.entries(UPSERT)) {
    const c = fs.readFileSync(src, "utf8");
    if (/[\u0590-\u05FF]/.test(c)) throw new Error(`staging file still has Hebrew: ${p}`);
    nodes.push({ path: p, mode: "100644", type: "blob", content: c });
  }

  const tree = await api(`${REPO}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseTreeSha, tree: nodes }) });
  const commit = await api(`${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "r33 content overhaul: English-only marketing surface. Removed internal operator reports (broadcasts, daily/pulse/briefing, roast, strategy, ops guides) and Hebrew duplicates with English twins; ads-pack, brand and articles 02/04/05/06 now live in English; Hebrew landing pages redirect to their English versions. The command bridge stays home; the shop window speaks English.",
      tree: tree.sha, parents: [baseCommitSha],
    }),
  });
  await api(`${REPO}/git/refs/heads/main`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  console.log(`surgery commit: ${commit.sha} · deleted=${DELETE.length} upserted=${Object.keys(UPSERT).length} redirected=${REDIRECT.length}`);
}
main().catch((e) => { console.error("surgery failed:", (e as Error).message); process.exit(1); });
