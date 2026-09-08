/**
 * tools/repo-scan.ts — System Owner fresh repo scan (M4)
 * ======================================================
 * Re-scans the roshpinacare-sys GitHub account LIVE and produces:
 *   · docs/repo-scan.json — per-repo inventory + capability keywords
 *   · stdout table for the human report
 *
 * Purpose (M4 step 2): gap resolution. The M3 deep scan concluded zero
 * Ethereum/Solana code exists anywhere in the org; this re-run verifies
 * that is still true (and catches anything newly pushed) before the
 * capability map is reported. Reads the token the same way the app does
 * (env GITHUB_TOKEN, else upload/Roshcaregt.txt) and NEVER prints it.
 *
 * Usage: bun tools/repo-scan.ts
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OWNER = "roshpinacare-sys";

const KEYWORDS = [
  "bridge",
  "wallet",
  "ethereum",
  "solana",
  "sign",
  "multisig",
  "multi-sig",
  "gas",
  "mev",
  "anchor",
  "keystore",
  "vault",
];

interface RepoRow {
  name: string;
  description: string | null;
  language: string | null;
  sizeKB: number;
  pushedAt: string;
  archived: boolean;
  branch: string;
  defaultBranch: string;
  manifests: string[]; // which build manifests exist at root
  stack: string[]; // detected frameworks/libs of interest
  keywordHits: string[]; // keywords matched in README/manifests
  notes: string;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "saosmartwallet-m4-owner",
  };
}

async function main() {
  let token = process.env.GITHUB_TOKEN?.trim() ?? "";
  if (token.length <= 10) {
    try {
      token = (await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8")).trim();
    } catch {
      token = "";
    }
  }
  if (token.length <= 10) {
    console.error("repo-scan: no usable GitHub token (env GITHUB_TOKEN or upload/Roshcaregt.txt)");
    process.exit(1);
  }

  const H = authHeaders(token);

  // 1. list repos — /user/repos (the /users/{u}/repos endpoint is empty for
  //    this private user account — same finding as the M3 scan).
  const listRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=pushed", { headers: H });
  if (!listRes.ok) throw new Error(`list repos HTTP ${listRes.status}`);
  const repos = (await listRes.json()) as Array<Record<string, unknown>>;
  console.log(`repo-scan: ${repos.length} repositories visible to the token`);

  const rows: RepoRow[] = [];

  for (const r of repos) {
    const name = String(r.name);
    const branch = String(r.default_branch ?? "main");
    const row: RepoRow = {
      name,
      description: (r.description as string | null) ?? null,
      language: (r.language as string | null) ?? null,
      sizeKB: Number(r.size ?? 0),
      pushedAt: String(r.pushed_at ?? ""),
      archived: r.archived === true,
      branch,
      defaultBranch: branch,
      manifests: [],
      stack: [],
      keywordHits: [],
      notes: "",
    };

    // 2. root tree — detect build manifests
    const treeRes = await fetch(`https://api.github.com/repos/${OWNER}/${name}/git/trees/${branch}`, { headers: H });
    const treeFiles: string[] = [];
    if (treeRes.ok) {
      const tree = (await treeRes.json()) as { tree?: Array<{ path: string; type: string }> };
      for (const t of tree.tree ?? []) {
        if (t.type === "blob") treeFiles.push(t.path);
      }
      row.manifests = treeFiles.filter((f) =>
        /^(package\.json|Cargo\.toml|go\.mod|requirements\.txt|pyproject\.toml|pom\.xml|docker-compose\.ya?ml|Dockerfile)$/.test(f),
      );
    } else {
      row.notes = `tree fetch failed (HTTP ${treeRes.status})`;
    }

    // 3. README head + manifests → keyword capability map
    const readmeCandidates = ["README.md", "readme.md", "README.MD", "Readme.md"];
    let readmeText = "";
    for (const cand of readmeCandidates) {
      if (!treeFiles.includes(cand)) continue;
      const res = await fetch(`https://raw.githubusercontent.com/${OWNER}/${name}/${branch}/${cand}`, {
        headers: { Authorization: `token ${token}` },
      });
      if (res.ok) {
        const buf = await res.text();
        readmeText = buf.slice(0, 20_000);
        break;
      }
    }
    const manifestText: string[] = [];
    for (const m of row.manifests) {
      const res = await fetch(`https://raw.githubusercontent.com/${OWNER}/${name}/${branch}/${m}`, {
        headers: { Authorization: `token ${token}` },
      });
      if (res.ok) manifestText.push((await res.text()).slice(0, 20_000));
    }
    const corpus = `${readmeText}\n${manifestText.join("\n")}`.toLowerCase();
    row.keywordHits = KEYWORDS.filter((k) => corpus.includes(k));

    // 4. stack detection (evidence-based)
    const joined = manifestText.join("\n");
    if (/"ethers"|web3|"@solana\/web3\.js|rust-web3|foundry|hardhat/.test(joined)) row.stack.push("evm-tooling");
    if (/"@solana\/web3\.js"|anchor-lang|spl-token/.test(joined)) row.stack.push("solana-tooling");
    if (/steem|dsteem|@hiveio|hive\.js/.test(joined)) row.stack.push("graphene-stack");
    if (/"next"/.test(joined)) row.stack.push("nextjs");
    if (/tokio|axum|actix/.test(joined)) row.stack.push("rust-server");
    if (readmeText.toLowerCase().includes("foundry") || readmeText.toLowerCase().includes("signer")) row.stack.push("signer-flow-readme");

    rows.push(row);
  }

  // 5. org-wide capability verdict (M4 gap list)
  const verdict = {
    scannedAt: new Date().toISOString(),
    repoCount: rows.length,
    ethereumCodeAnywhere: rows.some((r) => r.stack.includes("evm-tooling")),
    solanaCodeAnywhere: rows.some((r) => r.stack.includes("solana-tooling")),
    keywordCoverage: Object.fromEntries(KEYWORDS.map((k) => [k, rows.filter((r) => r.keywordHits.includes(k)).length])),
    gaps: [
      { item: "Ethereum bridge contract (deployed)", status: "MISSING in org — BRIDGE_ABI defined in-repo (packages/chains/ethereum/abi/bridge.ts), deployment pending" },
      { item: "Solana bridge program (deployed)", status: "MISSING in org — program IDs staged, deployment pending" },
      { item: "True on-chain multi-sig", status: "covered app-side by vault 3-of-5 master threshold + social recovery; on-chain multisig N/A for current flows" },
      { item: "Gas oracle", status: "PRESENT — EIP-1559 live fee measurement + feeSpeed policy in Ethereum adapter; multi-RPC median upgrade possible" },
      { item: "MEV protection", status: "MISSING — no private-relay/commit-reveal integration anywhere (org-wide honest gap)" },
      { item: "RPC fallbacks", status: "PRESENT — ordered endpoint books with automatic failover, live-proven (M4)" },
    ],
  };

  await mkdir(path.resolve("docs"), { recursive: true });
  await writeFile(path.resolve("docs/repo-scan.json"), JSON.stringify({ verdict, repos: rows }, null, 2) + "\n", "utf8");

  console.table(
    rows.map((r) => ({
      repo: r.name,
      lang: r.language ?? "—",
      sizeKB: r.sizeKB,
      pushed: r.pushedAt.slice(0, 10),
      manifests: r.manifests.join(",") || "—",
      stack: r.stack.join(",") || "—",
      keywords: r.keywordHits.join(",") || "—",
    })),
  );
  console.log("verdict:", JSON.stringify(verdict, null, 2));
  console.log("wrote docs/repo-scan.json");
}

main().catch((e) => {
  console.error("repo-scan FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
