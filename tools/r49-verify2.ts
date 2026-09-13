import { githubToken } from "../src/lib/github-token";
async function main() {
  const token = await githubToken();
  const r = await fetch(`https://api.github.com/repos/roshpinacare-sys/adsmarket/contents/fact-sheet.md?ref=main`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "r49v" }, signal: AbortSignal.timeout(30_000) });
  const j = (await r.json()) as { sha: string; content: string };
  const text = Buffer.from(j.content, "base64").toString("utf8");
  const added = "The 7 rented public networks, named so anyone can verify the count: **STEEM · HIVE · BLURT** (Graphene) · **TRON** (TVM) · **ETHEREUM · SOLANA** (EVM/SVM) · **XRPL**, each with a live receipt in sections 3, 10.19 and 10.30.";
  console.log("added sentence present:", text.includes(added));
  console.log("sha now:", j.sha.slice(0, 8), "· chars:", text.length);
  const bad = [[/[\u0590-\u05FF]/, "hebrew"], [/—/, "em-dash"], [/[“”‘’]/, "smart-quotes"], [/!/, "exclamation"]];
  for (const [re, n] of bad) if ((re as RegExp).test(text)) console.log("CONTRACT FAIL:", n);
  console.log("contract re-checked on fetched file");
}
main().catch(e => { console.log("FATAL:", e.message); process.exit(1); });
