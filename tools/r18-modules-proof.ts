/** r18 — live proof of the fixed chain.pulse (honest retry) + fleet.presence (clamp-proof shape). */
import { MODULES } from "@/lib/gate/harness/modules";
async function main() {
  const pulse = MODULES.find((m) => m.id === "chain.pulse");
  const presence = MODULES.find((m) => m.id === "fleet.presence");
  if (!pulse || !presence) throw new Error("module missing");
  const ctx = { agentName: "r18-proof", runId: "r18-proof" };
  const pr = (await pulse.exec({}, ctx)) as { rails: Array<{ rail: string; ok: boolean; retried?: boolean; delta?: number }>; meaning: string };
  console.log("PULSE:", pr.meaning, "| retried flags:", pr.rails.map((r) => `${r.rail}:${r.retried ? "yes" : "no"}`).join(" "));
  const fe = (await presence.exec({}, ctx)) as { meaning: string; rails: Array<{ rail: string; reachable: boolean; count: number; accounts: unknown[] }> };
  console.log("PRESENCE:", fe.meaning);
  const raw = JSON.stringify(fe);
  console.log("PRESENCE bytes:", raw.length, "| rails:", fe.rails.map((r) => `${r.rail}:${r.reachable ? `${r.count}accts` : "unreachable"}`).join(" "));
  // the clamp budget in loop.ts:
  if (raw.length > 4000) console.log("WARN: still large — checker clamp may cut rails");
}
main().catch((e) => { console.error("PROOF FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
