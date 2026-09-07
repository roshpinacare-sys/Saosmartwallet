"use client";

/**
 * SigningDialog — the M2 signing gate (Flow 2 + Flow 3).
 * Phase A shows the operation summary with [Cancel] [Simulate] [Sign].
 *   · Simulate → POST /api/vault/simulate → honest dry-run panel.
 *   · Sign → POST /api/vault/sign with the step-up password and a broadcast
 *     toggle; an animated checklist walks policy → build → digest → sign →
 *     broadcast, then the result panel (txId + signature + digest).
 * 403 + PolicyDecision → red violation panel; 423 / uninitialized → inline
 * notice pointing at the VAULT tab. Passwords live in state only.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FlaskConical,
  Fingerprint,
  Loader2,
  LockKeyhole,
  ShieldAlert,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, useVaultSign, useVaultSimulate, useVaultStatus } from "@/hooks/use-vault";
import { cn } from "@/lib/utils";
import type { PolicyDecision, SignOrderRequest, SignOrderResponse, SimulationResult } from "@/lib/vault-contracts";

type Phase = "input" | "signing" | "violated" | "locked" | "error" | "signed";

const RISK_TONE: Record<string, string> = {
  low: "var(--up)",
  medium: "var(--warning)",
  high: "var(--down)",
  critical: "var(--down)",
};

function fmtSatsBySymbol(satoshis: string, symbol: string): string {
  const n = Number(satoshis);
  if (!Number.isFinite(n)) return `${satoshis} ${symbol}`;
  const scale = symbol === "TRX" || symbol === "SAOS" ? 1e6 : 1000;
  const v = n / scale;
  const decimals = scale === 1000 ? 3 : 6;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${symbol}`;
}

export function SigningDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  request: SignOrderRequest | null;
}) {
  const sign = useVaultSign();
  const sim = useVaultSimulate();
  const { data: statusData } = useVaultStatus();

  const [password, setPassword] = useState("");
  const [broadcast, setBroadcast] = useState(true);
  const [phase, setPhase] = useState<Phase>("input");
  const [violation, setViolation] = useState<PolicyDecision | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [signed, setSigned] = useState<SignOrderResponse | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  // reset the whole flow whenever the dialog opens for a different request
  const [lastKey, setLastKey] = useState<string | null>(null);
  const flowKey = open && request ? request.orderid + request.side + request.amount + request.price : null;
  if (flowKey !== lastKey) {
    setLastKey(flowKey);
    setPassword("");
    setBroadcast(true);
    setPhase("input");
    setViolation(null);
    setErrorMsg("");
    setSigned(null);
    setSimulation(null);
  }

  if (!request) return null;

  const vaultStatus = statusData?.status ?? null;
  const busy = sign.isPending || sim.isPending;

  const resetFlow = () => {
    setPhase("input");
    setViolation(null);
    setErrorMsg("");
  };

  const handleErr = (err: ApiError) => {
    if (err.code === "POLICY_DENIED" || (err.decision && !err.decision.allowed)) {
      setViolation(err.decision ?? null);
      setPhase("violated");
    } else if (err.code === "VAULT_LOCKED" || err.code === "VAULT_NOT_INITIALIZED") {
      setErrorMsg(err.message);
      setPhase("locked");
    } else {
      setErrorMsg(err.message);
      setPhase("error");
    }
  };

  const doSimulate = async () => {
    resetFlow();
    setSimulation(null);
    try {
      const res = await sim.mutateAsync({
        network: request.network,
        account: request.account,
        side: request.side,
        amount: request.amount,
        price: request.price,
        fillOrKill: request.fillOrKill,
        ttlSeconds: request.ttlSeconds,
      });
      setSimulation(res.simulation);
    } catch (err) {
      if (err instanceof ApiError) handleErr(err);
    }
  };

  const doSign = async () => {
    resetFlow();
    setPhase("signing");
    try {
      const res = await sign.mutateAsync({ ...request, password, broadcast });
      setSigned(res);
      setPhase("signed");
      toast.success(broadcast ? "order signed & broadcast" : "order signed (not broadcast)", {
        description: `tx ${res.txId.slice(0, 16)}… · ${res.byteLength} bytes`,
      });
    } catch (err) {
      if (err instanceof ApiError) handleErr(err);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`copied ${label}`);
    } catch {
      toast.error("clipboard unavailable");
    }
  };

  const checks: Array<{ label: string; state: "done" | "active" | "wait" }> = [
    { label: "Policy verified", state: "done" },
    { label: "Transaction built", state: "done" },
    { label: "Digest computed", state: "done" },
    { label: "Signing with vault key", state: sign.isPending ? "active" : phase === "signed" ? "done" : "wait" },
    {
      label: broadcast ? "Broadcasting" : "Broadcast skipped",
      state: phase === "signed" ? "done" : "wait",
    },
    { label: "Done", state: phase === "signed" ? "done" : "wait" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy || !o) onOpenChange(o); }}>
      <DialogContent className="glass scroll-thin max-h-[88vh] overflow-y-auto border-[var(--border-default)] sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em]">
            <Fingerprint className="h-4 w-4 text-[var(--up)]" aria-hidden />
            Signing Request
          </DialogTitle>
          <DialogDescription className="num text-[11px] text-[var(--text-tertiary)]">
            limit_order_create · policy-gated · sealed key material
          </DialogDescription>
        </DialogHeader>

        {/* operation summary grid */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-3">
          <div className="num grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] sm:grid-cols-3">
            <SummaryCell k="operation" v="limit_order_create" />
            <SummaryCell k="network" v={request.network.toUpperCase()} tone="var(--up)" />
            <SummaryCell
              k="side"
              v={request.side.toUpperCase()}
              tone={request.side === "buy" ? "var(--up)" : "var(--down)"}
            />
            <SummaryCell k="amount" v={`${request.amount} STEEM`} />
            <SummaryCell k="price" v={`${request.price} SBD`} />
            <SummaryCell k="vault" v={`${request.network} · ACTIVE role`} />
            <SummaryCell k="account" v={`@${request.account}`} />
            <SummaryCell k="orderid" v={String(request.orderid)} />
            <SummaryCell k="fill-or-kill" v={request.fillOrKill ? "YES" : "no"} />
            <SummaryCell
              k="expires"
              v={new Date(request.orderExpiration * 1000).toLocaleString("en-GB", { hour12: false })}
              className="col-span-2 sm:col-span-3"
            />
          </div>
        </div>

        {/* vault pre-notices */}
        {vaultStatus && !vaultStatus.initialized ? (
          <Notice tone="warning" icon={<LockKeyhole className="h-4 w-4" />}>
            Vault not initialized — set it up in the VAULT tab (7) before signing.
          </Notice>
        ) : vaultStatus && vaultStatus.locked ? (
          <Notice tone="warning" icon={<LockKeyhole className="h-4 w-4" />}>
            Vault is locked — the step-up password below unlocks it for this signature. Unlock permanently in the VAULT tab (7).
          </Notice>
        ) : null}

        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="space-y-4"
          >
            {/* ---------- phase: violation (Flow 3) ---------- */}
            {phase === "violated" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--down)]/40 bg-[var(--down)]/[0.07] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--down)]">
                      <ShieldAlert className="h-4 w-4" aria-hidden /> ⛔ Policy Violation
                    </p>
                    {violation ? (
                      <span
                        className="num rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.14em]"
                        style={{
                          color: RISK_TONE[violation.riskLevel] ?? "var(--down)",
                          borderColor: `color-mix(in srgb, ${RISK_TONE[violation.riskLevel] ?? "var(--down)"} 40%, transparent)`,
                        }}
                      >
                        risk · {violation.riskLevel}
                      </span>
                    ) : null}
                  </div>
                  {violation ? (
                    <div className="mt-3 space-y-2">
                      {violation.checks.filter((c) => !c.pass).map((c) => (
                        <div key={c.ruleId} className="rounded border border-[var(--down)]/25 bg-black/20 px-2.5 py-2">
                          <p className="num text-[10px] uppercase tracking-[0.14em] text-[var(--down)]">✗ {c.name}</p>
                          <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">{c.detail}</p>
                        </div>
                      ))}
                      {violation.reasons.length > 0 ? (
                        <ul className="space-y-1">
                          {violation.reasons.map((r, i) => (
                            <li key={i} className="text-[10.5px] leading-relaxed text-[var(--text-secondary)]">· {r}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="mt-2.5 text-[10px] text-[var(--text-tertiary)]">nothing was signed · nothing was broadcast · attempt audited</p>
                </div>
                <PhaseActions onBack={resetFlow} onCancel={() => onOpenChange(false)} backLabel="Back" />
              </div>
            ) : null}

            {/* ---------- phase: locked / generic error ---------- */}
            {phase === "locked" ? (
              <div className="space-y-3">
                <Notice tone="warning" icon={<LockKeyhole className="h-4 w-4" />}>
                  {errorMsg || "Vault locked."} Unlock in the VAULT tab (7), then retry the signature.
                </Notice>
                <PhaseActions onBack={resetFlow} onCancel={() => onOpenChange(false)} backLabel="Back" />
              </div>
            ) : null}

            {phase === "error" ? (
              <div className="space-y-3">
                <Notice tone="down" icon={<ShieldAlert className="h-4 w-4" />}>{errorMsg || "signing failed"}</Notice>
                <PhaseActions onBack={resetFlow} onCancel={() => onOpenChange(false)} backLabel="Back" />
              </div>
            ) : null}

            {/* ---------- phase: signing in progress ---------- */}
            {phase === "signing" ? (
              <div className="space-y-3">
                <Checklist checks={checks} />
                <p className="num text-center text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                  policy engine → serialization → sha256 digest → secp256k1 → {broadcast ? "gated broadcast" : "signed-only"}
                </p>
              </div>
            ) : null}

            {/* ---------- phase: signed (Flow 2 result) ---------- */}
            {phase === "signed" && signed ? (
              <div className="space-y-4">
                {/* checklist */}
                <Checklist checks={checks} />

                {/* result panel */}
                <div className="space-y-2.5 rounded-lg border border-[var(--up)]/25 bg-[var(--up)]/[0.05] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-[var(--up)]">
                      <Check className="h-3.5 w-3.5" aria-hidden /> signed {signed.broadcast ? "& broadcast" : "(signed only)"}
                    </p>
                    <span className="num text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{signed.byteLength} bytes · key {signed.publicKey.slice(0, 12)}…</span>
                  </div>
                  <HexRow
                    label="tx id"
                    value={signed.txId}
                    onCopy={() => void copy("tx id", signed.txId)}
                    href={signed.broadcast ? `https://steemscan.com/tx/${signed.txId}` : undefined}
                  />
                  <HexRow
                    label="signature"
                    value={signed.signatureHex.length > 64 ? `${signed.signatureHex.slice(0, 64)}…` : signed.signatureHex}
                    full={signed.signatureHex}
                    onCopy={() => void copy("signature", signed.signatureHex)}
                  />
                  <HexRow label="digest" value={signed.digestHex} onCopy={() => void copy("digest", signed.digestHex)} small />
                </div>
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" className="gap-1.5 text-[11px] uppercase tracking-wider" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                </div>
              </div>
            ) : null}

            {/* ---------- phase: input (Flow 2) ---------- */}
            {phase === "input" ? (
              <div className="space-y-4">
                {/* simulation result */}
                {simulation ? <SimulationPanel simulation={simulation} /> : null}

                {/* password + broadcast */}
                <div className="space-y-1.5">
                  <Label htmlFor="sign-pw" className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    Vault password · step-up
                  </Label>
                  <Input
                    id="sign-pw"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="master password"
                    className="num h-10 border-[var(--border-default)] bg-white/[0.03] font-mono text-[13px]"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] px-3 py-2.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Broadcast after signing</p>
                    <p className="text-[9px] text-[var(--text-tertiary)]">off = signed-only envelope, you relay it yourself</p>
                  </div>
                  <Switch checked={broadcast} onCheckedChange={setBroadcast} aria-label="broadcast after signing" />
                </div>

                {/* actions */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" className="text-[11px] uppercase tracking-wider" disabled={busy} onClick={() => onOpenChange(false)}>
                    <X className="h-3.5 w-3.5" /> Cancel
                  </Button>
                  <Button variant="secondary" size="sm" className="h-9 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em]" disabled={busy} onClick={() => void doSimulate()}>
                    {sim.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Simulate
                  </Button>
                  <Button
                    size="sm"
                    className="h-9 min-w-[170px] gap-1.5 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
                    style={{ background: "var(--gradient-success)" }}
                    disabled={busy || password.length === 0}
                    onClick={() => void doSign()}
                  >
                    {sign.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" />}
                    Sign with Password
                  </Button>
                </div>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Checklist({ checks }: { checks: Array<{ label: string; state: "done" | "active" | "wait" }> }) {
  return (
    <motion.div
      className="space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1 } } }}
    >
      {checks.map((c) => (
        <motion.div
          key={c.label}
          variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-2.5"
        >
          {c.state === "done" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--up)]" aria-hidden />
          ) : c.state === "active" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--info)]" aria-hidden />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--border-default)]" aria-hidden />
          )}
          <span
            className={cn(
              "text-[11px]",
              c.state === "wait" ? "text-[var(--text-tertiary)]" : "text-foreground/85",
            )}
          >
            {c.label}
          </span>
          {c.state === "done" ? <span className="num ml-auto text-[9px] uppercase tracking-[0.16em] text-[var(--up)]">✓</span> : null}
        </motion.div>
      ))}
    </motion.div>
  );
}

function SummaryCell({ k, v, tone, className }: { k: string; v: string; tone?: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{k}</p>
      <p className="truncate text-[11.5px] font-semibold" style={{ color: tone ?? "rgba(250,250,250,0.9)" }} title={v}>
        {v}
      </p>
    </div>
  );
}

function Notice({ tone, icon, children }: { tone: "warning" | "down"; icon: React.ReactNode; children: React.ReactNode }) {
  const color = tone === "warning" ? "var(--warning)" : "var(--down)";
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border p-3"
      style={{ borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, background: `color-mix(in srgb, ${color} 8%, transparent)` }}
    >
      <span className="mt-0.5 shrink-0" style={{ color }} aria-hidden>{icon}</span>
      <p className="text-[11px] leading-relaxed" style={{ color }}>{children}</p>
    </div>
  );
}

function PhaseActions({ onBack, onCancel, backLabel }: { onBack: () => void; onCancel: () => void; backLabel: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" className="gap-1.5 text-[11px] uppercase tracking-wider" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
      </Button>
      <Button variant="ghost" size="sm" className="text-[11px] uppercase tracking-wider" onClick={onCancel}>
        <X className="h-3.5 w-3.5" /> Cancel
      </Button>
    </div>
  );
}

function SimulationPanel({ simulation }: { simulation: SimulationResult }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-3 rounded-lg border border-[var(--info)]/25 bg-[var(--info)]/[0.04] p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-[var(--info)]">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden /> simulation · nothing signed
        </p>
        <span
          className="num rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.14em]"
          style={{
            color: simulation.success ? "var(--up)" : "var(--down)",
            borderColor: `color-mix(in srgb, ${simulation.success ? "var(--up)" : "var(--down)"} 35%, transparent)`,
          }}
        >
          {simulation.success ? "PASS" : "FAIL"}
        </span>
      </div>

      {simulation.expectedOutcome.balanceChanges.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Balance changes</p>
          {simulation.expectedOutcome.balanceChanges.map((c, i) => (
            <div key={i} className="num flex items-center justify-between text-[11.5px]">
              <span style={{ color: c.direction === "debit" ? "var(--down)" : "var(--up)" }}>
                {c.direction === "debit" ? "−" : "+"} {fmtSatsBySymbol(c.satoshis, c.asset)}
              </span>
              <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{c.direction}</span>
            </div>
          ))}
        </div>
      ) : null}

      {simulation.risks.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Risks</p>
          {simulation.risks.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              <span
                className="num mt-0.5 shrink-0 rounded border px-1 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em]"
                style={{
                  color: RISK_TONE[r.severity],
                  borderColor: `color-mix(in srgb, ${RISK_TONE[r.severity]} 35%, transparent)`,
                }}
              >
                {r.severity}
              </span>
              <p className="text-[10.5px] leading-relaxed text-[var(--text-secondary)]">{r.description}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="num flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] pt-2 text-[10px] text-[var(--text-tertiary)]">
        <span>
          RC estimate{" "}
          <span className="text-foreground/85">
            {simulation.estimatedResourcePercent !== null ? `${simulation.estimatedResourcePercent.toFixed(2)}%` : "—"}
          </span>
        </span>
        <span>
          fee <span className="text-foreground/85">{fmtSatsBySymbol(simulation.estimatedFeeSatoshis, "STEEM")}</span>
        </span>
        {simulation.decision ? (
          <span>
            policy{" "}
            <span style={{ color: simulation.decision.allowed ? "var(--up)" : "var(--down)" }}>
              {simulation.decision.allowed ? "ALLOW" : "DENY"} · {simulation.decision.riskLevel}
            </span>
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

function HexRow({
  label, value, onCopy, href, full, small,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  href?: string;
  full?: string;
  small?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{label}</p>
        <div className="flex items-center gap-1">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-[var(--info)] transition-colors hover:text-[var(--up)]"
              aria-label={`open ${label} in explorer`}
            >
              explorer <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onCopy}
            className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--up)]"
            aria-label={`copy ${label}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>
      <p className={cn("hex-string", small && "text-[10px]")} title={full ?? value}>{value}</p>
    </div>
  );
}
