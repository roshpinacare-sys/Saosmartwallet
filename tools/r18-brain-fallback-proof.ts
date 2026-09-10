/**
 * r18 — mechanical proof of the vault-locked brain fallback.
 * Fresh process = no master in memory (vault locked, no operator session).
 * brainChat(nvidia:…) MUST fall back to zai and record it honestly in the
 * model string — the NIM key stays sealed, employment stays alive.
 */
import { brainChat, parseBrain } from "@/lib/gate/harness/brain";
import { masterReady } from "@/lib/gate/crypto";
async function main() {
  console.log("vaultLockedInThisProcess:", !masterReady());
  const spec = parseBrain("nvidia:openai/gpt-oss-20b");
  const r = await brainChat(spec, [
    { role: "user", content: "ענה במילה אחת בדיוק: חי" },
  ], { maxTokens: 30 });
  console.log("model:", r.model);
  console.log("content:", r.content.slice(0, 60));
  if (r.model !== "zai (nvidia-fallback:vault-locked)") throw new Error("fallback did not record itself honestly");
  if (!r.content.trim()) throw new Error("empty content");
  console.log("PROOF OK — nvidia spec served by zai while vault locked, recorded honestly");
}
main().catch((e) => { console.error("PROOF FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
