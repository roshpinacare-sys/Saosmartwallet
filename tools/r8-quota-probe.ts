/* ROAST r8 — tiny brain probe: is the zai quota alive right now? */
import { brainChat, parseBrain } from "../src/lib/gate/harness/brain";
const t0 = Date.now();
try {
  const r = await brainChat(parseBrain("zai:default"), [{ role: "user", content: 'Reply ONLY the JSON {"alive":true}' }], { maxTokens: 20, temperature: 0 });
  console.log("PROBE-OK", JSON.stringify(r.content.slice(0, 60)), "ms=", Date.now() - t0);
} catch (e) {
  console.log("PROBE-FAIL", String(e instanceof Error ? e.message : e).slice(0, 200), "ms=", Date.now() - t0);
  process.exit(2);
}
