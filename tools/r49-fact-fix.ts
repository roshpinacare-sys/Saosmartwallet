/**
 * r49 — claims audit fix on the private adsmarket fact-sheet.
 * Three additive refreshes per the disclosure policy, each backed by a
 * live measurement taken 2026-09-13 ~16:30Z:
 *   §1  the "7 public networks" headline gets its explicit named list
 *   §2  throughput/ceiling refreshed to the current live bench (09-12)
 *   §8  fleet count clarified: commander + 12 soldiers, 12/12 above floor live
 * Fail-closed: every target string must exist exactly once, else abort.
 * Token from the GitGate vault only; nothing secret printed.
 */
import { githubToken } from "../src/lib/github-token";

const REPO = "roshpinacare-sys/adsmarket";
const FILE = "fact-sheet.md";

const EDITS: { old: string; new: string }[] = [
  {
    old: "> Full scan of the 12 repos · verification date: 2026-09-13 06:30Z (v3.35 · additive merge over v3.34: §10.58)",
    new: "> Full scan of the 12 repos · verification date: 2026-09-13 06:30Z (v3.36 · additive claims refresh over v3.35, audited live 2026-09-13 ~16:30Z: §1 named network list · §2 current bench · §8 live fleet re-measure)",
  },
  {
    old: "**SAOS is a sovereign operating system: a deterministic state machine (SAOS-NET) whose security is rented from 7 public networks, with a structurally-enforced economic engine, an autonomous agent fleet, and products (wallet, notary, DEX) that pay for everyone.**",
    new: "**SAOS is a sovereign operating system: a deterministic state machine (SAOS-NET) whose security is rented from 7 public networks, with a structurally-enforced economic engine, an autonomous agent fleet, and products (wallet, notary, DEX) that pay for everyone.**\n\nThe 7 rented public networks, named so anyone can verify the count: **STEEM · HIVE · BLURT** (Graphene) · **TRON** (TVM) · **ETHEREUM · SOLANA** (EVM/SVM) · **XRPL**, each with a live receipt in sections 3, 10.19 and 10.30.",
  },
  {
    old: "| Mechanism throughput | **32,603 tx/s**, 65,238 real archive transactions in 2,001ms (measured 2026-09-07) |",
    new: "| Mechanism throughput | **722,251 tx/s** (measured 2026-09-12: kernel applyTx replay of real archive txs on cloned state; earlier bench: 32,603 tx/s on 2026-09-07) |",
  },
  {
    old: "| Mechanism ceiling | ~2.82 billion tx/day (theoretical, always labeled as such) |",
    new: "| Mechanism ceiling | ~62.4 billion tx/day at the measured 2026-09-12 bench rate (extrapolated mechanism ceiling, always labeled as such; the sustained-live trade rate is economy/budget-bound and reported separately) |",
  },
  {
    old: "- **13/13 soldiers live on Steem** (get_accounts verified 2026-09-08): @headcorner + 11 members + @powerspan",
    new: "- **13 accounts on Steem, live** (get_accounts verified 2026-09-08): the commander @headcorner + 12 soldiers (11 members + @powerspan). Live re-measure 2026-09-13: **12/12 soldiers above the RC floor (>10%)** on the public fleet dashboard (the soldier roster tracks the 12 non-commander accounts; the commander is verified separately by the identity-anchor verifier)",
  },
];

async function main() {
  const token = await githubToken();
  if (!token) { console.log("NO TOKEN"); process.exit(2); }
  const gh = (path: string, init?: RequestInit) =>
    fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "r49-claims-fix",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });

  // 1. fetch current
  const r = await gh(`/repos/${REPO}/contents/${FILE}?ref=main`);
  if (!r.ok) { console.log("FETCH FAILED:", r.status); process.exit(2); }
  const j = (await r.json()) as { sha: string; content: string; encoding: string };
  if (j.encoding !== "base64") { console.log("unexpected encoding"); process.exit(2); }
  let text = Buffer.from(j.content, "base64").toString("utf8");
  console.log("fetched:", text.length, "chars · sha", j.sha.slice(0, 8));

  // 2. fail-closed edits: each old string exactly once, each new string absent
  for (const [i, e] of EDITS.entries()) {
    const c = text.split(e.old).length - 1;
    if (c !== 1) { console.log(`EDIT ${i + 1} ABORT: old string count=${c}`); process.exit(2); }
    if (text.includes(e.new)) { console.log(`EDIT ${i + 1} ABORT: new already present`); process.exit(2); }
  }
  for (const e of EDITS) text = text.replace(e.old, e.new);
  console.log("edits applied:", EDITS.length, "· new length:", text.length);

  // 3. language contract on the new content: zero hebrew / em-dash / smart quotes / exclamation
  const bad = [
    [/[\u0590-\u05FF]/, "hebrew"], [/—/, "em-dash"], [/[“”‘’]/, "smart-quotes"], [/!/, "exclamation"],
  ];
  for (const [re, name] of bad) {
    if (re.test(text)) { console.log(`LANGUAGE CONTRACT FAIL: ${name} present`); process.exit(2); }
  }

  // 4. commit
  const put = await gh(`/repos/${REPO}/contents/${FILE}`, {
    method: "PUT",
    body: JSON.stringify({
      message: "claims audit r49: three additive refreshes backed by live measurements (2026-09-13 ~16:30Z): section 1 named the 7 rented public networks (STEEM HIVE BLURT TRON ETHEREUM SOLANA XRPL, each with receipts); section 2 throughput refreshed to the current live bench 722251 tx/s measured 2026-09-12 (kernel applyTx replay, real archive txs) with the extrapolated ceiling relabeled honestly; section 8 fleet count clarified (commander + 12 soldiers) with the live 12/12 above-RC-floor re-measure of 2026-09-13; language contract kept (no hebrew, no em-dash, no smart quotes, no exclamations)",
      content: Buffer.from(text, "utf8").toString("base64"),
      sha: j.sha,
      branch: "main",
    }),
  });
  if (!put.ok) { console.log("PUT FAILED:", put.status, (await put.text()).slice(0, 300)); process.exit(2); }
  const pj = (await put.json()) as { commit: { sha: string } };
  console.log("COMMITTED:", pj.commit.sha.slice(0, 8));

  // 5. round-trip verify
  const v = await gh(`/repos/${REPO}/contents/${FILE}?ref=main`);
  const vj = (await v.json()) as { sha: string; content: string; encoding: string };
  const vtext = Buffer.from(vj.content, "base64").toString("utf8");
  let ok = true;
  for (const [i, e] of EDITS.entries()) {
    const present = vtext.includes(e.new) && !vtext.includes(e.old);
    console.log(`verify edit ${i + 1}: ${present ? "OK" : "MISSING"}`);
    if (!present) ok = false;
  }
  console.log(ok ? "ROUND-TRIP VERIFIED" : "ROUND-TRIP FAILED");
  process.exit(ok ? 0 : 2);
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
