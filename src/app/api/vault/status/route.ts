/**
 * GET /api/vault/status — secret-free vault snapshot (M2)
 * =======================================================
 * Returns the SovereignVault status: initialization/lock state, counts,
 * security score/findings, dead-man config and audit telemetry (chain head
 * hash + event count). integrityOk is the cheap lazy verdict — the deep
 * hash-chain walk lives at GET /api/vault/audit?verify=1.
 */

import { NextResponse } from "next/server";

import type { StatusResponse } from "@/lib/vault-contracts";
import { getVaultRuntime, mapVaultError } from "@/lib/vault-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rt = getVaultRuntime();
    await rt.ready;
    const status = await rt.vault.getStatus();
    const body: StatusResponse = { ok: true, status };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body } = mapVaultError(err);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
