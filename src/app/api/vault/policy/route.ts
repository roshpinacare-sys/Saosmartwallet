export const runtime = "nodejs";

/**
 * /api/vault/policy — the policy rule surface (M2)
 * ================================================
 * GET — the persisted PolicyRuleSet plus the compiled-in static rule catalog
 *       (static rules live in code and cannot be edited, only satisfied).
 * PUT — replaces the dynamic/contextual/composite rule data (unlocked
 *       session required) and audits policy_updated.
 *
 * ROAST r4: the docstring CLAIMED "unlocked session required" while the route
 * itself verified NOTHING — an unauthenticated caller could rewrite the whole
 * policy rule set the moment the vault exists. Mutations are now gated behind
 * the sovereign operator session (same gate as the fleet's reveal/run),
 * fail-closed: no session ⇒ 401 BEFORE any vault work.
 */

import { NextResponse } from "next/server";

import { STATIC_RULES, VaultError, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import type { PolicyResponse, PolicyRuleSet, UpdatePolicyRequest, UpdatePolicyResponse } from "@/lib/vault-contracts";
import { requireOperator } from "@/lib/gate/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rt = getVaultRuntime();
    await rt.ready;
    const state = rt.vault.getState();
    if (state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
    }
    const res: PolicyResponse = {
      ok: true,
      rules: state.policies,
      staticRules: STATIC_RULES.map((r) => ({ id: r.id, name: r.name, description: r.description })),
    };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body } = mapVaultError(err);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(req: Request) {
  // Fail-closed operator gate — ROAST r4: this route checked nothing at all.
  const gate = await requireOperator().then(
    () => null,
    (e: Error) => NextResponse.json({ ok: false, error: e.message }, { status: 401, headers: { "Cache-Control": "no-store" } }),
  );
  if (gate) return gate;

  let body: UpdatePolicyRequest;
  try {
    body = (await req.json()) as UpdatePolicyRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const rules: PolicyRuleSet | null = body?.rules ?? null;
    if (
      rules === null ||
      typeof rules !== "object" ||
      !Array.isArray(rules.dynamic) ||
      !Array.isArray(rules.contextual) ||
      !Array.isArray(rules.composite)
    ) {
      throw new VaultError("VALIDATION", "rules must carry dynamic, contextual and composite arrays");
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const next = await rt.vault.updatePolicies(rules);

    await rt.audit.log({
      type: "policy_updated",
      actor: { vaultId: "master" },
      target: {
        vaultId: "master",
        detail: { dynamic: next.dynamic.length, contextual: next.contextual.length, composite: next.composite.length },
      },
      result: "success",
      vaultInstanceId: getInstanceId(),
    });

    const res: UpdatePolicyResponse = { ok: true, rules: next };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body } = mapVaultError(err);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
