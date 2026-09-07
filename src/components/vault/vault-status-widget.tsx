"use client";

/**
 * VaultStatusWidget — live, secret-free snapshot of the Sovereign Key Vault.
 * Everything on screen comes from GET /api/vault/status (15s poll):
 * security score (animated), lock LED, hierarchy counts, last signing/backup,
 * audit-chain integrity badge, auto-lock countdown and findings.
 * compact → single glass card; full → richer sections. NO mock data.
 */

import { motion } from "framer-motion";
import { KeyRound, Loader2, Lock, RefreshCw, ShieldCheck, Unlock, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AnimatedNumber } from "@/components/terminal/motion-bits";
import { ErrorNote, PanelHeader, Skeleton, StatCell } from "@/components/terminal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VaultSetupWizard } from "@/components/vault/vault-setup-wizard";
import { fmtRelMs, useVaultLock, useVaultStatus, useVaultUnlock } from "@/hooks/use-vault";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function VaultLed({ locked, initialized }: { locked: boolean; initialized: boolean }) {
  const tone = !initialized ? "var(--down)" : locked ? "var(--warning)" : "var(--up)";
  const label = !initialized ? "NOT INITIALIZED" : locked ? "LOCKED" : "UNLOCKED";
  return (
    <span
      className="num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.16em]"
      style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 10%, transparent)`, color: tone }}
      role="status"
      aria-label={`vault ${label}`}
    >
      <span
        className={cn("inline-block h-2 w-2 rounded-full", !initialized || !locked ? "led-live" : "")}
        style={{ background: tone }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function scoreTone(score: number): string {
  if (score >= 80) return "var(--up)";
  if (score >= 50) return "var(--warning)";
  return "var(--down)";
}

function ScoreBar({ score, className }: { score: number; className?: string }) {
  const tone = scoreTone(score);
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-white/[0.06]", className)} role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="security score">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.max(2, Math.min(100, score))}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${tone} 55%, transparent), ${tone})`, boxShadow: `0 0 12px -2px ${tone}` }}
      />
    </div>
  );
}

/** mm:ss until the unlocked session auto-locks; ticks once per second. */
function useAutoLock(locksAt: number | null | undefined, locked: boolean | undefined): string {
  const [now, setNow] = useState<number>(() => Date.now());
  const qc = useQueryClient();
  useEffect(() => {
    if (locked || !locksAt) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= locksAt) void qc.invalidateQueries({ queryKey: ["vault", "status"] });
    }, 1000);
    return () => clearInterval(id);
  }, [locksAt, locked, qc]);
  if (locked || !locksAt) return "";
  const rem = Math.max(0, locksAt - now);
  const m = Math.floor(rem / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function FindingRow({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warning)]" aria-hidden />
      <span className="min-w-0">{text}</span>
    </li>
  );
}

function UnlockForm({ onSubmit, pending }: { onSubmit: (password: string) => void; pending: boolean }) {
  const [pw, setPw] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pw || pending) return;
        onSubmit(pw);
        setPw("");
      }}
    >
      <Input
        type="password"
        autoComplete="off"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="master password"
        aria-label="master password"
        className="num h-9 flex-1 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
      />
      <Button
        type="submit"
        size="sm"
        disabled={!pw || pending}
        className="h-9 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
        style={{ background: "var(--gradient-success)" }}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
        Unlock
      </Button>
    </form>
  );
}

/** Prominent first-boot CTA (also used by the compact variant). */
function InitCta({ onOpen, tall }: { onOpen: () => void; tall?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/[0.07] p-4",
        tall && "sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--warning)]">Vault not initialized</p>
          <p className="mt-0.5 max-w-md text-[11px] leading-relaxed text-[var(--text-secondary)]">
            Derive the master key, provision the network / soldier / purpose vaults and arm the policy engine. Argon2id, ~1–2s.
          </p>
        </div>
      </div>
      <Button
        size="sm"
        onClick={onOpen}
        className="h-9 shrink-0 gap-1.5 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
        style={{ background: "var(--gradient-success)" }}
      >
        <Zap className="h-3.5 w-3.5" /> Initialize Vault
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Widget                                                              */
/* ------------------------------------------------------------------ */

export function VaultStatusWidget({ compact = false, onOpenWizard }: { compact?: boolean; onOpenWizard?: () => void }) {
  const { data, isLoading, isError, error, refetch, isRefetching } = useVaultStatus();
  const unlock = useVaultUnlock();
  const lock = useVaultLock();
  const [wizardOpen, setWizardOpen] = useState(false);
  const openWizard = () => {
    if (onOpenWizard) onOpenWizard();
    else setWizardOpen(true);
  };

  const status = data?.status ?? null;
  const countdown = useAutoLock(status?.autoLocksAt, status?.locked);
  const initialized = status?.initialized ?? false;

  if (isLoading) {
    return (
      <div className="glass overflow-hidden" aria-busy="true" aria-label="Loading vault status">
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div className="glass overflow-hidden">
        <PanelHeader title="Vault Status" subtitle="sovereign key vault" icon={<ShieldCheck className="h-4 w-4" />} />
        <ErrorNote message={error instanceof Error ? error.message : "vault status unavailable"} />
        <div className="px-4 pb-4">
          <Button variant="secondary" size="sm" className="gap-1.5 text-[11px] uppercase tracking-wider" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const findings = compact ? status.securityFindings.slice(0, 3) : status.securityFindings;

  /* ---------------- compact ---------------- */
  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        className="glass glow-card overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--up)]" aria-hidden />
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/90">Sovereign Vault</p>
          </div>
          <VaultLed locked={status.locked} initialized={initialized} />
        </div>
        <div className="space-y-3 p-4">
          {!initialized ? (
            <InitCta onOpen={openWizard} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Security score</p>
                  <p className="num mt-0.5 text-xl font-bold" style={{ color: scoreTone(status.securityScore) }}>
                    <AnimatedNumber value={status.securityScore} format={(n) => String(Math.round(n))} />
                    <span className="text-[12px] opacity-60">/100</span>
                  </p>
                  <ScoreBar score={status.securityScore} className="mt-1.5" />
                </div>
                <StatCell
                  label={status.locked ? "Auto-lock" : "Keys active"}
                  value={status.locked ? "—" : `${status.counts.activeKeys}/${status.counts.keys}`}
                  sub={status.locked ? "locked" : countdown ? `locks in ${countdown}` : "no session"}
                />
                <StatCell label="Networks" value={String(status.counts.networks)} sub={status.networks.join(" · ") || "—"} />
                <StatCell
                  label="Audit chain"
                  value={status.auditIntegrityOk ? "✓ intact" : "✗ tampered"}
                  sub={`${status.auditEventCount} events`}
                  className={status.auditIntegrityOk ? "" : "text-[var(--down)]"}
                />
              </div>
              {status.locked ? (
                <UnlockForm onSubmit={(pw) => unlock.mutate({ password: pw })} pending={unlock.isPending} />
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 w-full gap-1.5 text-[10px] uppercase tracking-[0.14em]"
                  onClick={() => lock.mutate({})}
                  disabled={lock.isPending}
                >
                  {lock.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />} Lock vault
                </Button>
              )}
            </>
          )}
        </div>
        <VaultSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
      </motion.div>
    );
  }

  /* ---------------- full ---------------- */
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="glass overflow-hidden"
      aria-label="Vault status"
    >
      <PanelHeader
        title="Vault Status"
        subtitle="sovereign key vault · M2"
        icon={<ShieldCheck className="h-4 w-4" />}
        right={<VaultLed locked={status.locked} initialized={initialized} />}
      />
      <div className="space-y-4 p-5">
        {!initialized ? (
          <InitCta onOpen={openWizard} tall />
        ) : (
          <>
            {/* score + session + audit */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-3.5">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Security score</p>
                <p className="num mt-1 text-3xl font-bold leading-none" style={{ color: scoreTone(status.securityScore) }}>
                  <AnimatedNumber value={status.securityScore} format={(n) => String(Math.round(n))} />
                  <span className="text-sm opacity-60">/100</span>
                </p>
                <ScoreBar score={status.securityScore} className="mt-2.5" />
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-3.5">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Session</p>
                {status.locked ? (
                  <p className="num mt-1 text-3xl font-bold leading-none text-[var(--warning)]">
                    <Lock className="mb-1 mr-1.5 inline h-5 w-5" aria-hidden />
                    LOCKED
                  </p>
                ) : (
                  <p className="num mt-1 text-3xl font-bold leading-none text-[var(--up)]">{countdown || "—:—"}</p>
                )}
                <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
                  {status.locked ? `auto-lock after ${status.autoLockSeconds}s idle` : "until auto-lock · unlock by password"}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-3.5">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Audit chain</p>
                <p
                  className="num mt-1 flex items-center gap-1.5 text-lg font-bold leading-none"
                  style={{ color: status.auditIntegrityOk ? "var(--up)" : "var(--down)" }}
                >
                  {status.auditIntegrityOk ? "✓ chain intact" : "✗ tampered"}
                </p>
                <p className="num mt-2 text-[10px] text-[var(--text-tertiary)]">{status.auditEventCount} events · head {status.auditHeadHash ? `${status.auditHeadHash.slice(0, 10)}…` : "—"}</p>
              </div>
            </div>

            {/* hierarchy counts */}
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3.5 sm:grid-cols-6">
              <StatCell label="Networks" value={String(status.counts.networks)} />
              <StatCell label="Soldiers" value={String(status.counts.soldiers)} />
              <StatCell label="Purposes" value={String(status.counts.purposes)} />
              <StatCell label="Keys" value={`${status.counts.activeKeys}/${status.counts.keys}`} sub="active/total" />
              <StatCell label="Guardians" value={String(status.counts.guardians)} />
              <StatCell label="Dead-man" value={status.deadManSwitch?.enabled ? "ARMED" : "off"} sub={status.deadManSwitch?.enabled ? `${status.deadManSwitch.inactiveDays}d window` : undefined} />
            </div>

            {/* timeline */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              <span>
                last signing <span className="num text-foreground/80">{fmtRelMs(status.lastSigningAt)}</span>
              </span>
              <span>
                last backup <span className="num text-foreground/80">{fmtRelMs(status.lastBackupAt)}</span>
              </span>
              <span>
                created <span className="num text-foreground/80">{fmtRelMs(status.createdAt)}</span>
              </span>
            </div>

            {/* findings */}
            {findings.length > 0 ? (
              <div className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/[0.05] p-3.5">
                <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-[var(--warning)]">Security findings</p>
                <ul className="space-y-1.5">
                  {findings.map((f, i) => (
                    <FindingRow key={i} text={f} />
                  ))}
                </ul>
              </div>
            ) : null}

            {/* actions */}
            <div>
              {status.locked ? (
                <UnlockForm onSubmit={(pw) => unlock.mutate({ password: pw })} pending={unlock.isPending} />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-1.5 text-[11px] text-[var(--up)]">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden /> unlocked — signing operations permitted
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em]"
                    onClick={() => lock.mutate({})}
                    disabled={lock.isPending}
                  >
                    {lock.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />} Lock
                  </Button>
                </div>
              )}
              {isRefetching ? <p className="num mt-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">syncing…</p> : null}
            </div>
          </>
        )}
      </div>
      <VaultSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </motion.section>
  );
}
