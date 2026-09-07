"use client";

/**
 * AuditPanel — live feed over the hash-chained audit log (layer 6).
 * GET /api/vault/audit?limit=50 (&type=&result=) with 10s polling, on-demand
 * integrity walk (?verify=1) and compliance report downloads (json/csv/pdf —
 * the pdf body arrives base64 and is decoded to a Blob client-side).
 * Every row is a real chain event; nothing is synthesized.
 */

import { motion } from "framer-motion";
import { Ban, CheckCircle2, FileText, Loader2, RefreshCw, ScrollText, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { ErrorNote, PanelHeader, Skeleton } from "@/components/terminal/primitives";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { auditReportBlob, fetchAuditReport, fetchAuditVerify, fmtRelMs, triggerDownload, useVaultAudit } from "@/hooks/use-vault";
import { cn } from "@/lib/utils";

const EVENT_TYPES = [
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
] as const;

const RESULT_ICON = {
  success: CheckCircle2,
  failure: XCircle,
  blocked: Ban,
} as const;

export function AuditPanel() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const audit = useVaultAudit({
    type: typeFilter === "all" ? undefined : typeFilter,
    result: resultFilter === "all" ? undefined : (resultFilter as "success" | "failure" | "blocked"),
    limit: 50,
  });

  const verify = useMutation({ mutationFn: fetchAuditVerify });
  const [reportBusy, setReportBusy] = useState<string | null>(null);

  const downloadReport = async (format: "json" | "csv" | "pdf") => {
    setReportBusy(format);
    try {
      const res = await fetchAuditReport(format);
      const stamp = new Date(res.report.generatedAt).toISOString().slice(0, 10);
      triggerDownload(`saos-audit-report-${stamp}.${format}`, auditReportBlob(format, res.report.body));
    } catch {
      /* the fetch helper throws; surface honestly */
      setReportBusy("error");
      setTimeout(() => setReportBusy(null), 1500);
      return;
    }
    setReportBusy(null);
  };

  return (
    <section className="glass flex flex-col overflow-hidden" aria-label="Audit chain">
      <PanelHeader
        title="Audit Chain"
        subtitle="hash-chained · tamper-evident"
        icon={<ScrollText className="h-4 w-4" />}
        accent="info"
        right={
          audit.data ? (
            <span
              className="num inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.14em]"
              style={{
                color: audit.data.integrityOk ? "var(--up)" : "var(--down)",
                borderColor: `color-mix(in srgb, ${audit.data.integrityOk ? "var(--up)" : "var(--down)"} 35%, transparent)`,
              }}
            >
              {audit.data.integrityOk ? <ShieldCheck className="h-3 w-3" aria-hidden /> : <ShieldX className="h-3 w-3" aria-hidden />}
              {audit.data.integrityOk ? "chain intact" : "tampered"}
            </span>
          ) : null
        }
      />

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[168px] text-[10px] uppercase tracking-[0.1em]" aria-label="filter by event type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all" className="text-[11px]">all types</SelectItem>
            {EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="num text-[11px]">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={resultFilter} onValueChange={setResultFilter}>
          <SelectTrigger className="h-8 w-[120px] text-[10px] uppercase tracking-[0.1em]" aria-label="filter by result">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[11px]">all results</SelectItem>
            <SelectItem value="success" className="text-[11px]">success</SelectItem>
            <SelectItem value="failure" className="text-[11px]">failure</SelectItem>
            <SelectItem value="blocked" className="text-[11px]">blocked</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-[10px] uppercase tracking-[0.12em]"
            disabled={verify.isPending}
            onClick={() => verify.mutate()}
          >
            {verify.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Verify
          </Button>
          {(["json", "csv", "pdf"] as const).map((f) => (
            <Button
              key={f}
              variant="ghost"
              size="sm"
              className="num h-8 gap-1 px-2 text-[10px] uppercase tracking-[0.1em]"
              disabled={reportBusy !== null}
              onClick={() => void downloadReport(f)}
              aria-label={`download ${f} report`}
            >
              {reportBusy === f ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} {f}
            </Button>
          ))}
        </div>
      </div>

      {/* verify banner */}
      {verify.data ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 border-b px-4 py-2 text-[11px]",
            verify.data.integrityOk ? "border-[var(--up)]/20 bg-[var(--up)]/[0.06] text-[var(--up)]" : "border-[var(--down)]/20 bg-[var(--down)]/[0.06] text-[var(--down)]",
          )}
        >
          {verify.data.integrityOk ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <ShieldX className="h-3.5 w-3.5" aria-hidden />}
          <span className="num">
            {verify.data.integrityOk
              ? `integrity walk OK — ${verify.data.eventsChecked} events verified`
              : `CHAIN TAMPERED — first bad seq #${verify.data.firstBadSeq ?? "?"} of ${verify.data.eventsChecked}`}
          </span>
        </div>
      ) : null}

      {/* feed */}
      {audit.isLoading ? (
        <div className="flex flex-col gap-2 p-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : audit.isError || !audit.data ? (
        <div>
          <ErrorNote message={audit.error instanceof Error ? audit.error.message : "audit feed unavailable"} />
          <div className="px-4 pb-4">
            <Button variant="secondary" size="sm" className="gap-1.5 text-[11px] uppercase tracking-wider" onClick={() => void audit.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        </div>
      ) : (
        <div className="scroll-thin max-h-[420px] min-h-[160px] overflow-y-auto p-2" role="feed" aria-label="audit events">
          {audit.data.events.length === 0 ? (
            <p className="num py-8 text-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              no events match the filter
            </p>
          ) : (
            <ul className="space-y-1">
              {audit.data.events.map((e, i) => {
                const Icon = RESULT_ICON[e.result];
                const iconColor = e.result === "success" ? "var(--up)" : e.result === "failure" ? "var(--down)" : "var(--warning)";
                return (
                  <motion.li
                    key={e.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3) }}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: iconColor }} aria-label={e.result} />
                    <span className="num shrink-0 rounded border border-[var(--border-subtle)] bg-white/[0.03] px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em] text-foreground/75">
                      {e.type}
                    </span>
                    <span className="num shrink-0 text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                      {fmtRelMs(e.timestamp)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--text-secondary)]" title={e.reason ?? ""}>
                      {e.reason || "—"}
                    </span>
                    <span className="num shrink-0 text-[8.5px] text-[var(--text-tertiary)]" title={`seq ${e.seq} · ${e.eventHash.slice(0, 16)}…`}>
                      #{e.seq}
                    </span>
                  </motion.li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {audit.data ? (
        <p className="num border-t border-[var(--border-subtle)] px-4 py-2 text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
          {audit.data.events.length} shown / {audit.data.total} total · head {audit.data.headHash ? `${audit.data.headHash.slice(0, 12)}…` : "—"} · 10s poll
        </p>
      ) : null}
    </section>
  );
}
