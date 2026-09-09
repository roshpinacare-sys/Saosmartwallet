import { db } from "@/lib/db";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError } from "@/lib/gate/crypto";
import { MODULES, moduleManifest } from "@/lib/gate/harness/modules";
import { BRAIN_CATALOG } from "@/lib/gate/harness/brain";

export const runtime = "nodejs";

/**
 * GET /api/gate/modules — the armory: every harness module an agent can be
 * armed with, plus the live brain catalog and NVIDIA key posture.
 */
export async function GET() {
  try {
    await requireOperator();
    const nvSealed = Boolean(await db.vaultEntry.findFirst({ where: { chain: "nvidia", kind: "token" } }));
    const nvidia = {
      keySealed: nvSealed || Boolean(process.env.NVIDIA_API_KEY?.trim()),
      source: nvSealed ? "vault" : process.env.NVIDIA_API_KEY ? "env→vault-on-first-use" : "missing",
    };
    return ok({
      modules: moduleManifest(),
      brains: BRAIN_CATALOG,
      nvidia,
      counts: { modules: MODULES.length },
    });
  } catch (e) {
    return fail(e);
  }
}
