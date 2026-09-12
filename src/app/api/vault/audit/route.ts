export const runtime = "nodejs";

/**
 * GET /api/vault/audit — the tamper-evident trail (M2)
 * ====================================================
 * Three modes by query string:
 *
 *   default            — newest-first page: ?limit=&offset=&type=&result=
 *                        (&from=&to=). limit capped at 200. Returns the
 *                        events, the filtered total, the chain head hash
 *                        and a CHEAP integrityOk (true; the deep walk is
 *                        ?verify=1's job — this endpoint stays O(1)-ish).
 *   ?verify=1          — full hash-chain walk (audit.verifyIntegrity) and
 *                        the verdict is itself audited (integrity_verified).
 *   ?report=json|csv|  — compliance report over [from,to] via
 *                        audit.generateReport. json → API envelope;
 *                        csv/pdf → file download (Content-Disposition).
 */

import { NextResponse } from "next/server";

import { VaultError, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import type { AuditEvent, AuditReportResponse, AuditResponse, AuditVerifyResponse } from "@/lib/vault-contracts";
import type { AuditEventType, ComplianceReportFormat } from "@/lib/vault-runtime";

export const dynamic = "force-dynamic";

const EVENT_TYPES: ReadonlySet<string> = new Set<AuditEventType>([
  "vault_created",
  "vault_unlocked",
  "vault_locked",
  "vault_locked_auto",
  "key_added",
  "key_removed",
  "key_used",
  "vault_created_network",
  "vault_created_soldier",
  "vault_created_purpose",
  "signing_attempt",
  "broadcast",
  "policy_violation",
  "policy_updated",
  "backup_created",
  "backup_restored",
  "recovery_initiated",
  "deadman_updated",
  "integrity_verified",
]);

const RESULTS: ReadonlySet<string> = new Set(["success", "failure", "blocked"]);
const REPORT_FORMATS: ReadonlySet<string> = new Set(["json", "csv", "pdf"]);

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.length === 0) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rt = getVaultRuntime();
    await rt.ready;
    const instanceId = getInstanceId(); // VAULT_NOT_INITIALIZED (409) before init

    // ---- mode b: integrity walk --------------------------------------------
    if (url.searchParams.get("verify") === "1") {
      const verdict = await rt.audit.verifyIntegrity(instanceId);
      await rt.audit.log({
        type: "integrity_verified",
        actor: { vaultId: "master" },
        target: {
          vaultId: "master",
          detail: { integrityOk: verdict.integrityOk, eventsChecked: verdict.eventsChecked, firstBadSeq: verdict.firstBadSeq },
        },
        result: verdict.integrityOk ? "success" : "failure",
        reason: verdict.integrityOk ? "hash chain intact" : `first bad event at seq ${verdict.firstBadSeq}`,
        vaultInstanceId: instanceId,
      });
      const res: AuditVerifyResponse = { ok: true, ...verdict };
      return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    // ---- mode c: compliance report -----------------------------------------
    const reportRaw = url.searchParams.get("report");
    if (reportRaw !== null && reportRaw.length > 0) {
      if (!REPORT_FORMATS.has(reportRaw)) {
        throw new VaultError("VALIDATION", 'report must be one of: json, csv, pdf');
      }
      const from = intParam(url, "from") ?? 0;
      const to = intParam(url, "to") ?? Date.now();
      if (from > to) throw new VaultError("VALIDATION", "from must be ≤ to");
      const report = await rt.audit.generateReport({ start: from, end: to }, reportRaw as ComplianceReportFormat, {
        vaultInstanceId: instanceId,
        title: "Saosmartwallet — Audit Compliance Report",
      });

      if (reportRaw === "json") {
        const res: AuditReportResponse = { ok: true, report };
        return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
      }
      const filename = `saos-audit-${from}-${to}.${reportRaw}`;
      if (reportRaw === "csv") {
        return new NextResponse(report.body, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      // pdf — the core serializes binary as base64; decode to bytes here.
      const bytes = Buffer.from(report.body, "base64");
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // ---- mode a: paged query -------------------------------------------------
    const limitRaw = intParam(url, "limit") ?? 100;
    const limit = Math.min(Math.max(limitRaw, 1), 200);
    const offset = Math.max(intParam(url, "offset") ?? 0, 0);

    const typesParam = url.searchParams.getAll("type").flatMap((v) => v.split(",")).map((t) => t.trim()).filter((t) => t.length > 0);
    for (const t of typesParam) {
      if (!EVENT_TYPES.has(t)) throw new VaultError("VALIDATION", `unknown audit event type "${t}"`);
    }
    const resultParam = url.searchParams.get("result");
    if (resultParam !== null && resultParam.length > 0 && !RESULTS.has(resultParam)) {
      throw new VaultError("VALIDATION", "result must be one of: success, failure, blocked");
    }
    const from = intParam(url, "from");
    const to = intParam(url, "to");
    if (from !== undefined && to !== undefined && from > to) {
      throw new VaultError("VALIDATION", "from must be ≤ to");
    }

    const filters = {
      ...(typesParam.length > 0 ? { types: typesParam as AuditEventType[] } : {}),
      ...(resultParam !== null && resultParam.length > 0 ? { result: resultParam as AuditEvent["result"] } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    };
    const events = await rt.audit.query({ ...filters, limit, offset });
    const total = await rt.audit.count(filters);
    const head = await rt.audit.head();
    const headHash = head !== null ? head.eventHash : rt.audit.genesisHash(instanceId);

    // Cheap lazy verdict — the honest walk lives at ?verify=1.
    const res: AuditResponse = { ok: true, events, total, headHash, integrityOk: true };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body } = mapVaultError(err);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
