"use client";

/**
 * VaultConsole — the VAULT tab layout.
 * VaultStatusWidget (full) + action row (Setup Wizard / Policy / Backup &
 * Recovery) + a two-column grid: AuditPanel next to the key manager and the
 * vault-hierarchy overview. Every number comes from the /api/vault/* routes.
 */

import { motion } from "framer-motion";
import {
  KeyRound,
  Landmark,
  Loader2,
  Network,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CHAIN_TONE, ErrorNote, PanelHeader, Skeleton } from "@/components/terminal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AuditPanel } from "@/components/vault/audit-panel";
import { BackupRecoveryDialog } from "@/components/vault/backup-recovery-dialog";
import { PolicyManagementDialog } from "@/components/vault/policy-management-dialog";
import { VaultSetupWizard } from "@/components/vault/vault-setup-wizard";
import { VaultStatusWidget } from "@/components/vault/vault-status-widget";
import { useVaultImportKeys, useVaultKeys, useVaultRevokeKey, useVaultStatus } from "@/hooks/use-vault";
import { cn } from "@/lib/utils";
import type { ImportKeyMode, NetworkId } from "@/lib/vault-contracts";
import type { KeyRole } from "../../../packages/core/src/types";

const NETWORKS: NetworkId[] = ["steem", "hive", "tron", "blurt", "saos-net"];
const ROLES: KeyRole[] = ["owner", "active", "posting", "memo"];
const PURPOSES = ["trading", "bridging", "governance", "treasury"] as const;

export function VaultConsole() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <VaultStatusWidget onOpenWizard={() => setWizardOpen(true)} />

      {/* actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
        className="flex flex-wrap gap-2"
      >
        <Button variant="secondary" size="sm" className="h-9 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em]" onClick={() => setWizardOpen(true)}>
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--up)]" /> Setup Wizard
        </Button>
        <Button variant="secondary" size="sm" className="h-9 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em]" onClick={() => setPolicyOpen(true)}>
          <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--info)]" /> Policy Engine
        </Button>
        <Button variant="secondary" size="sm" className="h-9 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em]" onClick={() => setBackupOpen(true)}>
          <Landmark className="h-3.5 w-3.5 text-[var(--saos)]" /> Backup &amp; Recovery
        </Button>
      </motion.div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AuditPanel />
        <div className="flex flex-col gap-4">
          <VaultKeysCard />
          <HierarchyCard />
        </div>
      </div>

      <VaultSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
      <PolicyManagementDialog open={policyOpen} onOpenChange={setPolicyOpen} />
      <BackupRecoveryDialog open={backupOpen} onOpenChange={setBackupOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key manager                                                         */
/* ------------------------------------------------------------------ */

function netTone(network: string): string {
  return CHAIN_TONE[network] ?? "var(--text-tertiary)";
}

function VaultKeysCard() {
  const keys = useVaultKeys();
  const importKey = useVaultImportKeys();
  const revoke = useVaultRevokeKey();

  const [network, setNetwork] = useState<NetworkId>("steem");
  const [roles, setRoles] = useState<KeyRole[]>(["active"]);
  const [mode, setMode] = useState<ImportKeyMode>("derive");
  const [account, setAccount] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [wif, setWif] = useState("");
  const [storage, setStorage] = useState<"hot" | "cold">("hot");
  const [password, setPassword] = useState("");

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokePw, setRevokePw] = useState("");

  const doImport = async () => {
    try {
      const res = await importKey.mutateAsync({
        mode,
        network,
        roles,
        storage,
        password,
        ...(mode === "derive" ? { account: account.trim(), masterPassword } : { wif }),
      });
      toast.success(`imported ${res.imported} key${res.imported === 1 ? "" : "s"}`, { description: `network ${network}` });
      setMasterPassword("");
      setWif("");
      setPassword("");
    } catch {
      /* toasted by the hook */
    }
  };

  const doRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revoke.mutateAsync({ keyId: revokeTarget, password: revokePw });
      toast.success("key revoked", { description: revokeTarget.slice(0, 16) });
      setRevokeTarget(null);
      setRevokePw("");
    } catch {
      /* toasted by the hook */
    }
  };

  return (
    <section className="glass overflow-hidden" aria-label="Vault keys">
      <PanelHeader
        title="Key Manager"
        subtitle="sealed key material · metadata only"
        icon={<KeyRound className="h-4 w-4" />}
        accent="saos"
        right={keys.data ? <span className="num text-[10px] text-[var(--text-tertiary)]">{keys.data.keys.length} keys</span> : null}
      />

      <div className="p-4">
        {keys.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : keys.isError || !keys.data ? (
          <ErrorNote message={keys.error instanceof Error ? keys.error.message : "key list unavailable"} />
        ) : keys.data.keys.length === 0 ? (
          <p className="num py-6 text-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            no keys sealed yet — import below
          </p>
        ) : (
          <ul className="scroll-thin mb-4 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {keys.data.keys.map((k) => (
              <li key={k.keyId} className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="num text-[11px] font-bold" style={{ color: netTone(k.network) }}>
                    {k.network.toUpperCase()}
                  </span>
                  {k.role ? (
                    <span className="num rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-foreground/75">
                      {k.role}
                    </span>
                  ) : null}
                  <span className="num text-[10.5px] text-foreground/80">{k.account ? `@${k.account}` : k.label}</span>
                  <span className="num text-[10px] text-[var(--text-tertiary)]" title={k.publicKey ?? undefined}>
                    {k.publicKey ? `${k.publicKey.slice(0, 14)}…` : "pub —"}
                  </span>
                  <span className="num rounded-full border border-[var(--border-default)] px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                    {k.storage}
                  </span>
                  <span
                    className={cn(
                      "num rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em]",
                      k.status === "active" ? "border-[var(--up)]/35 bg-[var(--up)]/10 text-[var(--up)]" : "border-[var(--down)]/35 bg-[var(--down)]/10 text-[var(--down)]",
                    )}
                  >
                    {k.status}
                  </span>
                  {k.status === "active" ? (
                    <button
                      type="button"
                      className="ml-auto text-[var(--text-tertiary)] transition-colors hover:text-[var(--down)]"
                      aria-label={`revoke key ${k.keyId}`}
                      onClick={() => setRevokeTarget(k.keyId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {revokeTarget === k.keyId ? (
                  <div className="mt-2 flex gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      value={revokePw}
                      onChange={(e) => setRevokePw(e.target.value)}
                      placeholder="vault password to confirm revoke"
                      className="num h-8 flex-1 border-[var(--border-default)] bg-white/[0.03] font-mono text-[11px]"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 gap-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--down)]"
                      disabled={!revokePw || revoke.isPending}
                      onClick={() => void doRevoke()}
                    >
                      {revoke.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Revoke
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px]" onClick={() => setRevokeTarget(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* import mini-form */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3.5">
          <p className="mb-3 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            <Plus className="h-3 w-3" aria-hidden /> import / derive key
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Network">
              <Select value={network} onValueChange={(v) => setNetwork(v as NetworkId)}>
                <SelectTrigger className="h-9 text-[11px]" aria-label="network">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NETWORKS.map((n) => (
                    <SelectItem key={n} value={n} className="num text-[11px]">
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Mode">
              <Select value={mode} onValueChange={(v) => setMode(v as ImportKeyMode)}>
                <SelectTrigger className="h-9 text-[11px]" aria-label="import mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="derive" className="text-[11px]">derive from master password</SelectItem>
                  <SelectItem value="wif" className="text-[11px]">import existing WIF</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {mode === "derive" ? (
              <>
                <Field label="Account">
                  <Input
                    value={account}
                    onChange={(e) => setAccount(e.target.value.toLowerCase())}
                    placeholder="steem-account"
                    autoComplete="off"
                    className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
                  />
                </Field>
                <Field label="Account master password">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={masterPassword}
                    onChange={(e) => setMasterPassword(e.target.value)}
                    className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
                  />
                </Field>
              </>
            ) : (
              <Field label="WIF (private key)">
                <Input
                  type="password"
                  autoComplete="off"
                  value={wif}
                  onChange={(e) => setWif(e.target.value)}
                  className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
                />
              </Field>
            )}

            <Field label="Storage">
              <Select value={storage} onValueChange={(v) => setStorage(v as "hot" | "cold")}>
                <SelectTrigger className="h-9 text-[11px]" aria-label="storage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot" className="text-[11px]">hot</SelectItem>
                  <SelectItem value="cold" className="text-[11px]">cold</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Vault password · step-up">
              <Input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2.5" role="group" aria-label="key roles">
              {ROLES.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
                    className="h-3.5 w-3.5 accent-[var(--up)]"
                  />
                  {r}
                </label>
              ))}
            </div>
            <Button
              size="sm"
              className="ml-auto h-9 gap-1.5 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
              style={{ background: "var(--gradient-saos)" }}
              disabled={importKey.isPending || !password || (mode === "derive" ? !account || !masterPassword : !wif)}
              onClick={() => void doImport()}
            >
              {importKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Seal key
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{label}</Label>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hierarchy overview                                                  */
/* ------------------------------------------------------------------ */

function HierarchyCard() {
  const { data, isLoading, isError, error } = useVaultStatus();
  const status = data?.status ?? null;

  return (
    <section className="glass overflow-hidden" aria-label="Vault hierarchy">
      <PanelHeader
        title="Hierarchy Overview"
        subtitle="master · networks · soldiers · purposes"
        icon={<Network className="h-4 w-4" />}
        accent="warning"
      />
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : isError || !status ? (
          <ErrorNote message={error instanceof Error ? error.message : "status unavailable"} />
        ) : !status.initialized ? (
          <p className="num py-6 text-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            hierarchy materializes at initialization
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 rounded-lg border border-[var(--up)]/25 bg-[var(--up)]/[0.04] px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--up)]" aria-hidden />
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold text-foreground/90">Master vault · ed25519 · multi-sig</p>
                <p className="num text-[10px] text-[var(--text-tertiary)]">
                  {status.counts.guardians} guardians · 3-of-5 threshold · root of trust
                </p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                <Network className="h-3 w-3" aria-hidden /> network vaults · {status.counts.networks}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {status.networks.map((n) => (
                  <span
                    key={n}
                    className="num rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]"
                    style={{
                      color: netTone(n),
                      borderColor: `color-mix(in srgb, ${netTone(n)} 35%, transparent)`,
                      background: `color-mix(in srgb, ${netTone(n)} 8%, transparent)`,
                    }}
                    title={n === "blurt" ? "ships offline by default config" : undefined}
                  >
                    {n}
                    {n === "blurt" ? " · offline" : ""}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                <Users className="h-3 w-3" aria-hidden /> soldier fleet · {status.counts.soldiers}
              </p>
              <p className="num text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
                saos-soldier-01…{String(status.counts.soldiers).padStart(2, "0")} · first 5 TRADER · trade ✓ vote ✓ comment ✓ transfer ✗
              </p>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                <Landmark className="h-3 w-3" aria-hidden /> purpose vaults · {status.counts.purposes}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PURPOSES.map((p) => (
                  <span key={p} className="num rounded-full border border-[var(--border-default)] bg-white/[0.03] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
