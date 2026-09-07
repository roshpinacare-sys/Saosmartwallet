"use client";

/**
 * VaultSetupWizard — first-boot initialization (M2 spec flow).
 * 6 steps: Welcome → Master Password (strength meter) → Recovery Options →
 * Network Vaults preview → Soldiers preview → Initialize (Argon2id ~1–2s).
 * Step 6 calls POST /api/vault/init and, when the encrypted-backup option was
 * chosen, immediately POSTs /api/vault/backup and downloads the .vault file.
 * All previews mirror the engine's own defaults (packages/core vault.ts) —
 * nothing is invented.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  FileDown,
  Loader2,
  Lock,
  QrCode,
  Rocket,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { triggerDownload, useVaultBackup, useVaultInit } from "@/hooks/use-vault";
import { cn } from "@/lib/utils";
import type { VaultStatus } from "@/lib/vault-contracts";

const STEP_LABELS = ["Welcome", "Password", "Recovery", "Networks", "Soldiers", "Complete"] as const;

/* ------------------------------------------------------------------ */
/* Password strength                                                   */
/* ------------------------------------------------------------------ */

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "123456", "1234567", "12345678",
  "123456789", "1234567890", "qwerty", "qwerty123", "111111", "000000", "12345", "12345678910",
  "abc123", "abcdef", "letmein", "monkey", "dragon", "football", "iloveyou", "admin", "welcome",
  "login", "starwars", "master", "hello", "freedom", "whatever", "trustno1", "batman",
  "passw0rd", "asdfgh", "654321", "555555", "7777777", "88888888", "princess", "sunshine",
  "shadow", "superman", "michael", "ninja", "samsung", "azerty", "sovereign", "saos", "vault",
  "steem123", "hive123", "blockchain", "crypto", "bitcoin", "satoshi",
]);

interface PasswordChecks {
  length12: boolean;
  mixedCase: boolean;
  numbers: boolean;
  special: boolean;
  notCommon: boolean;
}

function passwordChecks(pw: string): PasswordChecks {
  const low = pw.toLowerCase();
  return {
    length12: pw.length >= 12,
    mixedCase: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    numbers: /\d/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
    notCommon: pw.length > 0 && !COMMON_PASSWORDS.has(low) && !/^(?:012|123|234|345|456|567|678|789|abc|bcd|cde|def)+$/.test(low),
  };
}

function strengthScore(c: PasswordChecks): number {
  return [c.length12, c.mixedCase, c.numbers, c.special, c.notCommon].filter(Boolean).length * 20;
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-[11px]" style={{ color: ok ? "var(--up)" : "var(--text-tertiary)" }}>
      <span
        className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", ok ? "border-[var(--up)]/50 bg-[var(--up)]/10" : "border-[var(--border-default)]")}
        aria-hidden
      >
        {ok ? <Check className="h-2.5 w-2.5" /> : <span className="h-1 w-1 rounded-full bg-current opacity-50" />}
      </span>
      {label}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Static previews — mirror of packages/core/src/vault/vault.ts defaults */
/* ------------------------------------------------------------------ */

const NETWORK_PREVIEW = [
  {
    id: "steem", name: "STEEM", tone: "var(--up)",
    roles: "owner · active · posting · memo",
    ops: "transfer · vote · comment · limit_order_create · limit_order_cancel · custom_json · delegate_vesting_shares · witness_vote",
    limit: "10,000.000 STEEM", offline: false,
  },
  {
    id: "hive", name: "HIVE", tone: "var(--warning)",
    roles: "owner · active · posting · memo",
    ops: "transfer · vote · comment · limit_order_create · limit_order_cancel · custom_json · delegate_vesting_shares · witness_vote",
    limit: "10,000.000 HIVE", offline: false,
  },
  {
    id: "tron", name: "TRON", tone: "var(--down)",
    roles: "owner",
    ops: "transfer · trigger_smart_contract",
    limit: "100,000.000 TRX", offline: false,
  },
  {
    id: "blurt", name: "BLURT", tone: "var(--info)",
    roles: "owner · active · posting · memo",
    ops: "transfer · vote · comment",
    limit: "10,000.000 BLURT", offline: true,
  },
  {
    id: "saos-net", name: "SAOS-NET", tone: "var(--saos)",
    roles: "owner · active · posting",
    ops: "transfer · vote · custom_json",
    limit: "100.000 SAOS", offline: false,
  },
] as const;

const SOLDIER_COUNT = 13;
const TRADER_COUNT = 5;

function soldierName(i: number): string {
  return `saos-soldier-${String(i + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Wizard                                                              */
/* ------------------------------------------------------------------ */

export function VaultSetupWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const init = useVaultInit();
  const backup = useVaultBackup();

  const [step, setStep] = useState(1);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [choices, setChoices] = useState({ backupFile: true, recoveryPhrase: false, social: false, airGapped: false });
  const [initStatus, setInitStatus] = useState<VaultStatus | null>(null);
  const [backupDone, setBackupDone] = useState(false);

  // fresh wizard on every open (adjust-during-render — no effects)
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setStep(1);
      setPassword("");
      setConfirm("");
      setChoices({ backupFile: true, recoveryPhrase: false, social: false, airGapped: false });
      setInitStatus(null);
      setBackupDone(false);
    }
  }

  const checks = passwordChecks(password);
  const score = strengthScore(checks);
  const passwordValid = Object.values(checks).every(Boolean) && password === confirm && password.length > 0;
  const recoveryChosen = Object.values(choices).some(Boolean);
  const deriving = init.isPending || backup.isPending;

  const scoreColor = score >= 80 ? "var(--up)" : score >= 40 ? "var(--warning)" : "var(--down)";

  const handleInitialize = async () => {
    try {
      const res = await init.mutateAsync({ password, soldierCount: SOLDIER_COUNT, traderSoldiers: TRADER_COUNT });
      setInitStatus(res.status);
      if (choices.backupFile) {
        const b = await backup.mutateAsync({ password, shardThreshold: 0, shardTotal: 0 });
        const stamp = new Date().toISOString().slice(0, 10);
        triggerDownload(
          `saos-vault-backup-${stamp}.vault`,
          new Blob([JSON.stringify(b.backup, null, 2)], { type: "application/json" }),
        );
        setBackupDone(true);
        toast.success("encrypted backup downloaded — store it offline");
      }
    } catch {
      /* the hook already toasted the ApiError message */
    }
  };

  const canContinue =
    step === 2 ? passwordValid
    : step === 3 ? recoveryChosen
    : true;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!deriving || !o) onOpenChange(o); }}>
      <DialogContent className="glass scroll-thin max-h-[92vh] overflow-y-auto border-[var(--border-default)] sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em]">
            <ShieldCheck className="h-4 w-4 text-[var(--up)]" aria-hidden />
            Sovereign Key Vault — Setup
          </DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--text-tertiary)]">
            Step {Math.min(step, 6)} of 6 · {STEP_LABELS[Math.min(step, 6) - 1]}
          </DialogDescription>
        </DialogHeader>

        {/* step indicator */}
        <div className="space-y-2" aria-hidden>
          <div className="flex items-center gap-1.5">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const done = initStatus ? n <= 6 : n < step;
              const active = !initStatus && n === step;
              return (
                <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span
                    className={cn(
                      "num flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold transition-colors",
                      done && "border-[var(--up)]/50 bg-[var(--up)]/15 text-[var(--up)]",
                      active && "border-[var(--up)] bg-[var(--up)]/25 text-[var(--up)]",
                      !done && !active && "border-[var(--border-default)] text-[var(--text-tertiary)]",
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className={cn("hidden truncate text-[8px] uppercase tracking-[0.14em] sm:block", active ? "text-[var(--up)]" : "text-[var(--text-tertiary)]")}>{label}</span>
                </div>
              );
            })}
          </div>
          <Progress value={((initStatus ? 6 : step) / 6) * 100} className="h-1 bg-white/[0.06]" />
        </div>

        {/* step body */}
        <div className="min-h-[280px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={step + (initStatus ? "-done" : "")}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="space-y-4"
            >
              {step === 1 && !initStatus ? <StepWelcome /> : null}
              {step === 2 && !initStatus ? (
                <StepPassword password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} checks={checks} score={score} scoreColor={scoreColor} />
              ) : null}
              {step === 3 && !initStatus ? <StepRecovery choices={choices} setChoices={setChoices} /> : null}
              {step === 4 && !initStatus ? <StepNetworks /> : null}
              {step === 5 && !initStatus ? <StepSoldiers /> : null}
              {initStatus ? (
                <StepComplete
                  status={initStatus}
                  backupDone={backupDone}
                  choices={choices}
                  deriving={deriving}
                  onClose={() => onOpenChange(false)}
                />
              ) : step === 6 ? (
                <StepCompletePre choices={choices} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* footer */}
        {!initStatus ? (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-[11px] uppercase tracking-wider"
              disabled={step === 1 || deriving}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            {step < 6 ? (
              <Button
                size="sm"
                disabled={!canContinue}
                className="h-9 gap-1.5 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
                style={{ background: "var(--gradient-success)" }}
                onClick={() => setStep((s) => Math.min(6, s + 1))}
              >
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={deriving}
                className="h-9 min-w-[220px] gap-1.5 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
                style={{ background: "var(--gradient-success)" }}
                onClick={() => void handleInitialize()}
              >
                {deriving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deriving master key…
                  </>
                ) : (
                  <>
                    <Rocket className="h-3.5 w-3.5" /> Initialize Vault
                  </>
                )}
              </Button>
            )}
          </div>
        ) : null}

        {step === 6 && !initStatus ? (
          <p className="num text-center text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            argon2id · 64 MiB · t=3 — derivation takes ~1–2s server-side
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function StepWelcome() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--up)]/25 bg-[var(--up)]/[0.05] p-4">
        <p className="text-[13px] font-bold leading-relaxed text-foreground">
          This is not just a wallet. It is the custodial core of your sovereign operation.
        </p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
          The Sovereign Key Vault derives and seals every key your fleet uses across five networks, and
          policy-gates each signature through an immutable rule engine. Keys are never stored in
          plaintext, never leave the vault unencrypted, and every action lands on a hash-chained audit trail.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {[
          "Argon2id master key — 64 MiB memory-hard derivation",
          "AES-256-GCM / ChaCha20-Poly1305 sealed key material",
          "1 master · 5 network · 13 soldier · 4 purpose vaults",
          "Policy engine + hash-chained audit on every signature",
        ].map((t) => (
          <li key={t} className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--up)]" aria-hidden />
            {t}
          </li>
        ))}
      </ul>
      <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        The master password is the only way to unlock the vault. There is no reset — without it, and
        without a backup or recovery shares, the vault stays sealed forever. Choose it accordingly.
      </p>
    </div>
  );
}

function StepPassword({
  password, confirm, setPassword, setConfirm, checks, score, scoreColor,
}: {
  password: string;
  confirm: string;
  setPassword: (v: string) => void;
  setConfirm: (v: string) => void;
  checks: PasswordChecks;
  score: number;
  scoreColor: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="wiz-pw" className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Master password</Label>
        <Input
          id="wiz-pw"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="min 12 chars · upper+lower · numbers · special"
          className="num h-10 border-[var(--border-default)] bg-white/[0.03] font-mono text-[13px]"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wiz-pw2" className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Confirm password</Label>
        <Input
          id="wiz-pw2"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="repeat exactly"
          className="num h-10 border-[var(--border-default)] bg-white/[0.03] font-mono text-[13px]"
        />
        {confirm.length > 0 && confirm !== password ? (
          <p className="flex items-center gap-1.5 text-[10px] text-[var(--down)]">
            <CircleAlert className="h-3 w-3" aria-hidden /> passwords do not match
          </p>
        ) : null}
      </div>
      <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3.5">
        <div className="flex items-center justify-between">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Strength</p>
          <p className="num text-[11px] font-bold" style={{ color: scoreColor }}>{score}%</p>
        </div>
        <Progress value={score} className="h-2 bg-white/[0.06]" aria-label="password strength" />
        <ul className="grid gap-1.5 sm:grid-cols-2">
          <CheckItem ok={checks.length12} label="12+ characters" />
          <CheckItem ok={checks.mixedCase} label="Upper + lower case" />
          <CheckItem ok={checks.numbers} label="Contains numbers" />
          <CheckItem ok={checks.special} label="Special characters" />
          <CheckItem ok={checks.notCommon} label="Not a common password" />
        </ul>
      </div>
    </div>
  );
}

const RECOVERY_OPTIONS = [
  {
    key: "backupFile" as const,
    icon: FileDown,
    title: "Encrypted Backup File",
    desc: "Password-sealed .vault package — restore on any machine with the password alone.",
  },
  {
    key: "recoveryPhrase" as const,
    icon: Lock,
    title: "Recovery Phrase",
    desc: "A human-readable master share, displayed once after setup. Store it offline, never photographed.",
  },
  {
    key: "social" as const,
    icon: Users,
    title: "Social Recovery",
    desc: "Shamir-split the recovery key among trusted contacts — a threshold reassembles it.",
  },
  {
    key: "airGapped" as const,
    icon: QrCode,
    title: "Air-Gapped QR",
    desc: "The sealed package as SAOSVAULT QR frames — printable, scannable cold storage.",
  },
];

function StepRecovery({
  choices, setChoices,
}: {
  choices: { backupFile: boolean; recoveryPhrase: boolean; social: boolean; airGapped: boolean };
  setChoices: (c: { backupFile: boolean; recoveryPhrase: boolean; social: boolean; airGapped: boolean }) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
        Pick at least one recovery path. The backup file is generated immediately after initialization;
        the other paths are completed in Backup &amp; Recovery — this step records intent.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {RECOVERY_OPTIONS.map((opt) => {
          const selected = choices[opt.key];
          const Icon = opt.icon;
          return (
            <button
              key={opt.key}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => setChoices({ ...choices, [opt.key]: !selected })}
              className={cn(
                "glow-card rounded-lg border p-3.5 text-left transition-colors",
                selected ? "border-[var(--up)]/45 bg-[var(--up)]/[0.06]" : "border-[var(--border-subtle)] bg-white/[0.02] hover:border-[var(--border-default)]",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4", selected ? "text-[var(--up)]" : "text-[var(--text-tertiary)]")} aria-hidden />
                <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-foreground/90">{opt.title}</span>
                <span
                  className={cn(
                    "num ml-auto flex h-4 w-4 items-center justify-center rounded-full border",
                    selected ? "border-[var(--up)]/60 bg-[var(--up)]/15 text-[var(--up)]" : "border-[var(--border-default)]",
                  )}
                  aria-hidden
                >
                  {selected ? <Check className="h-2.5 w-2.5" /> : null}
                </span>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">{opt.desc}</p>
            </button>
          );
        })}
      </div>
      {!Object.values(choices).some(Boolean) ? (
        <p className="flex items-center gap-1.5 text-[10px] text-[var(--warning)]">
          <CircleAlert className="h-3 w-3" aria-hidden /> select at least one recovery option
        </p>
      ) : null}
    </div>
  );
}

function StepNetworks() {
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
        Five network vaults are provisioned at init with the engine defaults below. BLURT ships
        offline. Roles, operations and daily ceilings can be reconfigured later.
      </p>
      <div className="space-y-2">
        {NETWORK_PREVIEW.map((n) => (
          <div key={n.id} className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <span className="num text-[12px] font-bold" style={{ color: n.tone }}>{n.name}</span>
              <span
                className="num rounded-full border px-1.5 py-0.5 text-[8px] font-bold tracking-[0.14em]"
                style={{
                  color: n.offline ? "var(--down)" : "var(--up)",
                  borderColor: n.offline ? "color-mix(in srgb, var(--down) 35%, transparent)" : "color-mix(in srgb, var(--up) 35%, transparent)",
                  background: n.offline ? "color-mix(in srgb, var(--down) 10%, transparent)" : "color-mix(in srgb, var(--up) 10%, transparent)",
                }}
              >
                {n.offline ? "OFFLINE" : "ACTIVE"}
              </span>
              <span className="num ml-auto text-[11px] text-foreground/80">{n.limit}</span>
              <span className="hidden text-[8px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] sm:block">/ day</span>
            </div>
            <p className="mt-1.5 text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">roles · {n.roles}</p>
            <p className="mt-1 truncate text-[10px] text-[var(--text-tertiary)]" title={n.ops}>ops · {n.ops}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepSoldiers() {
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
        A fleet of {SOLDIER_COUNT} soldier vaults is provisioned. The first {TRADER_COUNT} are traders;
        voting and commenting are enabled; transfers are disabled for every soldier. Permissions are
        read-only here — configure them later from the console.
      </p>
      <div className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {Array.from({ length: SOLDIER_COUNT }, (_, i) => {
          const trader = i < TRADER_COUNT;
          return (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2">
              <span className="num text-[11px] text-foreground/85">{soldierName(i)}</span>
              {trader ? (
                <span className="num rounded-full border border-[var(--up)]/35 bg-[var(--up)]/10 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.14em] text-[var(--up)]">TRADER</span>
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                <PermChip ok={trader} label="trade" />
                <PermChip ok label="vote" />
                <PermChip ok label="comment" />
                <PermChip ok={false} label="transfer" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PermChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "num rounded border px-1 py-0.5 text-[8px] uppercase tracking-[0.1em]",
        ok ? "border-[var(--up)]/30 bg-[var(--up)]/[0.08] text-[var(--up)]" : "border-[var(--border-subtle)] text-[var(--text-tertiary)] line-through",
      )}
      title={`${label}: ${ok ? "allowed" : "denied"}`}
    >
      {label}
    </span>
  );
}

function StepCompletePre({ choices }: { choices: { backupFile: boolean; recoveryPhrase: boolean; social: boolean; airGapped: boolean } }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
        Everything is configured. Initialization will: derive the Argon2id master key, provision the
        master / network / soldier / purpose vaults, install the default policy rule set and open the
        audit chain genesis.
      </p>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
        <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Recovery intent</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {RECOVERY_OPTIONS.filter((o) => choices[o.key]).map((o) => (
            <span key={o.key} className="num rounded-full border border-[var(--up)]/35 bg-[var(--up)]/10 px-2 py-0.5 text-[9px] font-bold tracking-[0.12em] text-[var(--up)]">
              {o.title}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepComplete({
  status, backupDone, choices, deriving, onClose,
}: {
  status: VaultStatus;
  backupDone: boolean;
  choices: { backupFile: boolean; recoveryPhrase: boolean; social: boolean; airGapped: boolean };
  deriving: boolean;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[var(--up)]">
        <ShieldCheck className="h-5 w-5" aria-hidden />
        <p className="text-[13px] font-bold uppercase tracking-[0.18em]">Vault initialized</p>
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3.5">
        <div className="flex items-center justify-between">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Security score</p>
          <p className="num text-[13px] font-bold" style={{ color: status.securityScore >= 80 ? "var(--up)" : status.securityScore >= 50 ? "var(--warning)" : "var(--down)" }}>
            {status.securityScore}/100
          </p>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={status.securityScore} aria-valuemin={0} aria-valuemax={100}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(2, status.securityScore)}%` }}
            transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
            className="h-full rounded-full"
            style={{ background: "var(--gradient-success)" }}
          />
        </div>
        <div className="num mt-3 grid grid-cols-3 gap-2 text-[11px] text-[var(--text-secondary)]">
          <span>{status.counts.networks} networks</span>
          <span>{status.counts.soldiers} soldiers</span>
          <span>{status.counts.purposes} purposes</span>
        </div>
      </div>

      {backupDone ? (
        <p className="flex items-center gap-2 rounded-lg border border-[var(--up)]/30 bg-[var(--up)]/[0.06] px-3 py-2.5 text-[11px] text-[var(--up)]">
          <FileDown className="h-4 w-4 shrink-0" aria-hidden />
          encrypted .vault package downloaded — store it offline before continuing
        </p>
      ) : null}

      {choices.recoveryPhrase || choices.social || choices.airGapped ? (
        <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/[0.06] p-3">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--warning)]">Complete recovery setup</p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
            {choices.recoveryPhrase ? "Recovery phrase · " : ""}
            {choices.social ? "Social recovery contacts · " : ""}
            {choices.airGapped ? "Air-gapped QR frames · " : ""}
            finish these in Backup &amp; Recovery from the vault console.
          </p>
        </div>
      ) : null}

      {status.securityFindings.length > 0 ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Recommendations</p>
          <ul className="mt-2 space-y-1.5">
            {status.securityFindings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--info)]" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {deriving ? (
        <Button disabled className="h-9 w-full gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white" style={{ background: "var(--gradient-success)" }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deriving master key…
        </Button>
      ) : (
        <Button
          className="h-10 w-full gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-white hover:opacity-90"
          style={{ background: "var(--gradient-success)" }}
          onClick={onClose}
        >
          Go to Dashboard <ArrowRight className="h-4 w-4" />
        </Button>
      )}
      <p className="num text-center text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        password kept in memory only · never persisted by the UI
      </p>
    </div>
  );
}
