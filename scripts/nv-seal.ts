/**
 * nv-seal — phase 2 of the intake: seal ONLY the operator-approved candidates.
 * take = the NEW (non-dup) candidates from the scan report:
 *   · 1 new NVIDIA NIM key (the 2nd nvapi in nvidia.txt was already sealed)
 *   · 2 GitHub PATs (one anchors to roshpinacare-sys — the old-projects org)
 *   · 4 EVM/hex private keys (treasury)
 *   · 3 real mnemonics (the 2 English-sentence false-positives are SKIPPED)
 * All were live-verified during scan (nvidia/pat/evm/hex) or honest "imported".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3000";
const UP = "/home/z/my-project/upload";

const TAKE = [
  "0c479591", // nvidia-api (new — pool #4)
  "23490e72", // github-pat ghp_ (roshpinacare-sys)
  "e409e054", // github-pat fine-grained
  "b8ebfbe7", // hex-priv
  "cdfd3a1a", // hex-priv
  "6ab1cd42", // evm-key
  "070f4802", // hex-priv
  "4bb323e6", // mnemonic (12w)
  "02e112f6", // mnemonic (12w)
  "bba7e11e", // mnemonic (long)
];

interface UnlockResp { ok: boolean; token?: string }
interface SealResp { ok: boolean; created?: number; sealed?: { hash: string; id: string; chain: string | null; account: string | null; role: string | null; status: string }[]; items?: { hash: string; kind: string; dupOf?: string | null }[]; note?: string; error?: string }

async function unlock(): Promise<string> {
  const dk = readFileSync(join(UP, "הדקור.txt"), "utf8");
  const cands: string[] = [];
  for (const line of dk.split(/\r?\n/)) {
    const m = line.match(/^\s*(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/i);
    if (m) cands.push(m[2]);
  }
  for (const key of cands) {
    try {
      const res = await fetch(`${BASE}/api/gate/unlock-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }), signal: AbortSignal.timeout(45_000),
      });
      const j = (await res.json()) as UnlockResp;
      if (res.ok && j.ok && j.token) return j.token;
    } catch { /* next */ }
  }
  console.log("UNLOCK FAILED");
  process.exit(2);
}

async function main() {
  const token = await unlock();
  const text = readFileSync(join(UP, "nvidia.txt"), "utf8") + "\n" +
    readFileSync(join(UP, "nvid.evm.txt"), "utf8") + "\n" +
    readFileSync(join(UP, "Roshcaregt.txt"), "utf8") + "\n" +
    readFileSync(join(UP, "קונמי.txt"), "utf8") + "\n" +
    readFileSync(join(UP, "הד.txt"), "utf8");
  const res = await fetch(`${BASE}/api/gate/keys-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-gate-token": token },
    body: JSON.stringify({ mode: "seal", text, take: TAKE }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = (await res.json()) as SealResp;
  if (!j.ok) { console.log("SEAL FAILED:", j.error ?? res.status); process.exit(3); }
  console.log(`SEAL OK — created ${j.created}`);
  for (const s of j.sealed ?? []) {
    console.log(`  ${s.hash} → id=${s.id.slice(0, 8)}… ${s.chain ?? "-"}/${s.account ?? "-"}/${s.role ?? "-"} status=${s.status}`);
  }
  console.log(`note: ${j.note ?? ""}`);
}
main().catch((e) => { console.log("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
