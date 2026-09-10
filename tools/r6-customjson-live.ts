/** ROAST r6 — live proof of the new custom_json stream audit (read-only). */
import { auditCustomJsonStream } from "../src/lib/gate/harness/social";

async function main() {
  const audit = await auditCustomJsonStream();
  console.log("account:", audit.account);
  console.log("windowOps:", audit.windowOps, "span:", audit.spanFrom, "→", audit.spanTo);
  console.log("byId:", JSON.stringify(audit.byId));
  console.log("codenameOps:", audit.codenameOps, "leakIds:", audit.protocolLeakIds.join(","));
  console.log("originNote:", audit.originNote);
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
