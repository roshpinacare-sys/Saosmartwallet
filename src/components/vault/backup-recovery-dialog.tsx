"use client";

/**
 * BackupRecoveryDialog — layer 5 surfaces (M2).
 *   Backup   → POST /api/vault/backup (optional Shamir sharding) → .vault
 *              download + copyable shard rows + client-side air-gapped QR
 *              frames in the engine's own `SAOSVAULT|1|i/n|chunk` format.
 *   Restore  → paste/drop a package + password OR shards → PUT /api/vault/backup.
 *   Social   → contacts + threshold → POST /api/vault/social-recovery →
 *              shares for distribution + recovery-package download.
 *   Dead-Man → PUT /api/vault/deadman + live overdue status.
 * Passwords and share material never leave component state / the request body.
 */

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileWarning,
  HeartPulse,
  Loader2,
  Plus,
  QrCode,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/terminal/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtRelMs, triggerDownload, useVaultBackup, useVaultDeadMan, useVaultRestore, useVaultSocialRecovery, useVaultStatus } from "@/hooks/use-vault";
import { cn } from "@/lib/utils";
import type { BackupPackage, CreateBackupResponse } from "@/lib/vault-contracts";

type ContactMethodLocal = "email" | "phone" | "on_chain" | "in_person";
type TrustLocal = "high" | "medium" | "low";

interface ContactRow {
  name: string;
  contactMethod: ContactMethodLocal;
  contactInfo: string;
  publicKey: string;
  trustLevel: TrustLocal;
}

interface ShardRow {
  index: string;
  data: string;
}

const emptyContact = (): ContactRow => ({ name: "", contactMethod: "email", contactInfo: "", publicKey: "", trustLevel: "high" });

export function BackupRecoveryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass scroll-thin max-h-[90vh] overflow-y-auto border-[var(--border-default)] sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em]">
            <Save className="h-4 w-4 text-[var(--saos)]" aria-hidden />
            Backup &amp; Recovery
          </DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--text-tertiary)]">
            encrypted packages · Shamir shards · social recovery · dead-man switch
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="backup">
          <TabsList className="grid h-9 w-full grid-cols-4 bg-white/[0.04] p-1">
            {[
              { v: "backup", label: "Backup" },
              { v: "restore", label: "Restore" },
              { v: "social", label: "Social" },
              { v: "deadman", label: "Dead-Man" },
            ].map((t) => (
              <TabsTrigger key={t.v} value={t.v} className="rounded-md text-[10px] font-bold uppercase tracking-[0.12em] data-[state=active]:bg-[var(--saos)]/15 data-[state=active]:text-[var(--saos)]">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="backup" className="mt-4"><BackupTab /></TabsContent>
          <TabsContent value="restore" className="mt-4"><RestoreTab /></TabsContent>
          <TabsContent value="social" className="mt-4"><SocialTab /></TabsContent>
          <TabsContent value="deadman" className="mt-4"><DeadManTab /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{label}</Label>
      {children}
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-black/20 px-2.5 py-1.5">
      <span className="num shrink-0 text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{label}</span>
      <span className="num min-w-0 flex-1 truncate text-[10.5px] text-foreground/80" title={value}>{value}</span>
      <button type="button" onClick={onCopy} className="shrink-0 text-[var(--text-tertiary)] transition-colors hover:text-[var(--up)]" aria-label={`copy ${label}`}>
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      toast(`copied ${label}`);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      toast.error("clipboard unavailable");
    }
  };
  return { copied, copy };
}

async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast(`copied ${label}`);
  } catch {
    toast.error("clipboard unavailable");
  }
}

/* ------------------------------------------------------------------ */
/* Backup tab                                                          */
/* ------------------------------------------------------------------ */

function BackupTab() {
  const backup = useVaultBackup();
  const { copy } = useCopy();
  const [pw, setPw] = useState("");
  const [threshold, setThreshold] = useState("0");
  const [total, setTotal] = useState("0");
  const [pkg, setPkg] = useState<CreateBackupResponse | null>(null);
  const [frames, setFrames] = useState<string[] | null>(null);
  const [qrBusy, setQrBusy] = useState(false);

  const sharded = (Number(threshold) || 0) > 0 && (Number(total) || 0) > 0;

  const doCreate = async () => {
    setPkg(null);
    setFrames(null);
    try {
      const res = await backup.mutateAsync({
        password: pw,
        shardThreshold: sharded ? Math.min(Number(threshold) || 0, Number(total) || 0) : 0,
        shardTotal: sharded ? Number(total) || 0 : 0,
      });
      setPkg(res);
      const pkgWithShards = { ...res.backup, shards: res.shards.length > 0 ? res.shards : res.backup.shards };
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(`saos-vault-backup-${stamp}.vault`, new Blob([JSON.stringify(pkgWithShards, null, 2)], { type: "application/json" }));
      toast.success(".vault package downloaded — store it offline");
    } catch {
      /* toasted by the hook */
    }
  };

  const doQr = async () => {
    if (!pkg || qrBusy) return;
    setQrBusy(true);
    try {
      const { toDataURL } = await import("qrcode");
      const json = JSON.stringify({ ...pkg.backup, shards: pkg.shards.length > 0 ? pkg.shards : pkg.backup.shards });
      const chunks: string[] = [];
      for (let i = 0; i < json.length; i += 800) chunks.push(json.slice(i, i + 800));
      const out: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        out.push(
          await toDataURL(`SAOSVAULT|1|${i + 1}/${chunks.length}|${chunks[i]}`, {
            margin: 1,
            width: 180,
            errorCorrectionLevel: "L",
          }),
        );
      }
      setFrames(out);
    } catch {
      toast.error("QR generation failed");
    } finally {
      setQrBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Backup password">
          <Input
            type="password"
            autoComplete="off"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="seal the package"
            className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
          />
        </Field>
        <Field label="Shard threshold · 0 = off">
          <Input
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^\d]/g, ""))}
            className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
          />
        </Field>
        <Field label="Shard total">
          <Input
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, ""))}
            className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
          />
        </Field>
      </div>

      <Button
        className="h-10 w-full gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
        style={{ background: "var(--gradient-saos)" }}
        disabled={!pw || backup.isPending}
        onClick={() => void doCreate()}
      >
        {backup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Create & download .vault
      </Button>

      {pkg ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-3">
          <div className="num rounded-lg border border-[var(--up)]/25 bg-[var(--up)]/[0.05] px-3 py-2 text-[10.5px] text-[var(--up)]">
            ✓ package {pkg.backup.metadata.checksum.slice(0, 16)}… · {pkg.backup.metadata.vaultCount} vaults · {pkg.backup.metadata.keyCount} keys ·{" "}
            {pkg.shards.length > 0 ? `${pkg.backup.sharding?.threshold ?? "?"}-of-${pkg.backup.sharding?.total ?? "?"} sharded` : "unsharded"}
          </div>

          {pkg.shards.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Shamir shares · distribute separately</p>
              {pkg.shards.map((s) => (
                <CopyRow key={s.index} label={`share #${s.index}`} value={s.data} onCopy={() => void copy(`share ${s.index}`, s.data)} />
              ))}
            </div>
          ) : null}

          <div>
            <Button variant="secondary" size="sm" className="gap-1.5 text-[10px] uppercase tracking-[0.14em]" disabled={qrBusy} onClick={() => void doQr()}>
              {qrBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />} Air-gapped QR
            </Button>
            {frames ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 space-y-2">
                <p className="num text-[10px] text-[var(--text-tertiary)]">
                  {frames.length} frames · format SAOSVAULT|1|i/n|chunk (≤800 chars, same as BackupManager.createAirGappedBackup) — print, never screenshot
                </p>
                <div className="scroll-thin grid max-h-72 grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-black/20 p-3 sm:grid-cols-4">
                  {frames.map((src, i) => (
                    <img key={i} src={src} alt={`QR frame ${i + 1} of ${frames.length}`} className="w-full rounded bg-white p-1" />
                  ))}
                </div>
              </motion.div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Restore tab                                                         */
/* ------------------------------------------------------------------ */

function RestoreTab() {
  const restore = useVaultRestore();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<BackupPackage | null>(null);
  const [parseError, setParseError] = useState("");
  const [mode, setMode] = useState<"password" | "shards">("password");
  const [pw, setPw] = useState("");
  const [shards, setShards] = useState<ShardRow[]>([{ index: "1", data: "" }]);

  const tryParse = (text: string) => {
    setRaw(text);
    setParseError("");
    setParsed(null);
    if (!text.trim()) return;
    try {
      const obj = JSON.parse(text) as Partial<BackupPackage>;
      if (obj.format !== "saos-vault-backup") {
        setParseError("not a saos-vault-backup package");
        return;
      }
      setParsed(obj as BackupPackage);
      if (obj.sharding) {
        setMode("shards");
        setShards((obj.shards ?? []).slice(0, 8).map((s) => ({ index: String(s.index), data: s.data })));
        if ((obj.shards ?? []).length === 0) setShards([{ index: "1", data: "" }, { index: "2", data: "" }]);
      }
    } catch {
      setParseError("invalid JSON");
    }
  };

  const doRestore = async () => {
    if (!parsed) return;
    try {
      await restore.mutateAsync({
        backup: parsed,
        password: mode === "password" ? pw : undefined,
        shards:
          mode === "shards"
            ? shards.filter((s) => s.data.trim()).map((s) => ({ index: Number(s.index) || 1, data: s.data.trim() }))
            : undefined,
      });
      toast.success("vault restored from package", { description: "status refreshed" });
    } catch {
      /* toasted by the hook */
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Package JSON · paste or load a .vault file">
        <Textarea
          value={raw}
          onChange={(e) => tryParse(e.target.value)}
          rows={5}
          placeholder='{"format":"saos-vault-backup", …}'
          className="scroll-thin num border-[var(--border-default)] bg-white/[0.03] font-mono text-[10.5px]"
        />
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".vault,.json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then(tryParse);
            }}
          />
          <Button variant="secondary" size="sm" className="gap-1.5 text-[10px] uppercase tracking-[0.14em]" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Load file
          </Button>
          {parseError ? (
            <span className="flex items-center gap-1 text-[10px] text-[var(--down)]">
              <FileWarning className="h-3 w-3" aria-hidden /> {parseError}
            </span>
          ) : null}
          {parsed ? (
            <span className="num flex items-center gap-1 text-[10px] text-[var(--up)]">
              <Check className="h-3 w-3" aria-hidden /> valid package · {parsed.metadata?.vaultCount ?? "?"} vaults
              {parsed.sharding ? ` · ${parsed.sharding.threshold}-of-${parsed.sharding.total} sharded` : ""}
            </span>
          ) : null}
        </div>
      </Field>

      {parsed ? (
        <>
          <div className="flex gap-2" role="radiogroup" aria-label="credential mode">
            {(["password", "shards"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "num rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors",
                  mode === m ? "border-[var(--up)]/45 bg-[var(--up)]/10 text-[var(--up)]" : "border-[var(--border-default)] text-[var(--text-tertiary)]",
                )}
              >
                {m === "password" ? "password" : "shamir shards"}
              </button>
            ))}
          </div>

          {mode === "password" ? (
            <Field label="Backup password">
              <Input
                type="password"
                autoComplete="off"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
              />
            </Field>
          ) : (
            <div className="space-y-2">
              <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Shards · enough to meet the threshold</p>
              {shards.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={s.index}
                    onChange={(e) => setShards(shards.map((r, j) => (j === i ? { ...r, index: e.target.value.replace(/[^\d]/g, "") } : r)))}
                    className="num h-8 w-14 shrink-0 border-[var(--border-default)] bg-white/[0.03] font-mono text-[11px]"
                    aria-label={`shard ${i + 1} index`}
                  />
                  <Input
                    value={s.data}
                    onChange={(e) => setShards(shards.map((r, j) => (j === i ? { ...r, data: e.target.value } : r)))}
                    placeholder="base64 share"
                    className="num h-8 border-[var(--border-default)] bg-white/[0.03] font-mono text-[11px]"
                    aria-label={`shard ${i + 1} data`}
                  />
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" onClick={() => setShards(shards.filter((_, j) => j !== i))} aria-label={`remove shard ${i + 1}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="gap-1.5 text-[10px] uppercase tracking-[0.14em]" onClick={() => setShards([...shards, { index: String(shards.length + 1), data: "" }])}>
                <Plus className="h-3 w-3" /> Add shard
              </Button>
            </div>
          )}

          <Button
            className="h-10 w-full gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
            style={{ background: "var(--gradient-saos)" }}
            disabled={restore.isPending || (mode === "password" ? !pw : shards.every((s) => !s.data.trim()))}
            onClick={() => void doRestore()}
          >
            {restore.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Restore vault (fresh state only)
          </Button>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Social tab                                                          */
/* ------------------------------------------------------------------ */

function SocialTab() {
  const social = useVaultSocialRecovery();
  const { copy } = useCopy();
  const [contacts, setContacts] = useState<ContactRow[]>([emptyContact(), emptyContact(), emptyContact()]);
  const [threshold, setThreshold] = useState("2");
  const [pw, setPw] = useState("");
  const [shares, setShares] = useState<Array<{ contactId: string; share: { index: number; data: string } }> | null>(null);
  const [pkgSaved, setPkgSaved] = useState(false);

  const doSetup = async () => {
    setShares(null);
    setPkgSaved(false);
    try {
      const res = await social.mutateAsync({
        contacts: contacts
          .filter((c) => c.name.trim())
          .map((c, i) => ({
            id: `contact-${i + 1}-${c.name.trim().toLowerCase().replace(/\s+/g, "-")}`,
            name: c.name.trim(),
            contactMethod: c.contactMethod,
            contactInfo: c.contactInfo.trim(),
            publicKey: c.publicKey.trim(),
            trustLevel: c.trustLevel,
            lastVerified: Date.now(),
          })),
        threshold: Math.max(1, Number(threshold) || 1),
        password: pw,
      });
      setShares(res.shares);
      // Optional extra field — BackupManager.setupSocialRecovery returns the
      // recovery package; the gateway includes it when available.
      const extra = res as typeof res & { recoveryPackage?: unknown };
      if (extra.recoveryPackage) {
        const stamp = new Date().toISOString().slice(0, 10);
        triggerDownload(
          `saos-recovery-package-${stamp}.recovery`,
          new Blob([JSON.stringify(extra.recoveryPackage, null, 2)], { type: "application/json" }),
        );
        setPkgSaved(true);
      }
    } catch {
      /* toasted by the hook */
    }
  };

  const validContacts = contacts.filter((c) => c.name.trim());

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Contacts · shamir shareholders</p>
        {contacts.map((c, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-2.5 sm:grid-cols-[1fr_auto_1fr_1fr_auto]">
            <Input
              value={c.name}
              onChange={(e) => setContacts(contacts.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
              placeholder="name"
              className="h-8 border-[var(--border-default)] bg-white/[0.03] text-[11px]"
              aria-label={`contact ${i + 1} name`}
            />
            <Select value={c.contactMethod} onValueChange={(v) => setContacts(contacts.map((r, j) => (j === i ? { ...r, contactMethod: v as ContactMethodLocal } : r)))}>
              <SelectTrigger className="h-8 w-[110px] text-[10px]" aria-label={`contact ${i + 1} method`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email" className="text-[11px]">email</SelectItem>
                <SelectItem value="phone" className="text-[11px]">phone</SelectItem>
                <SelectItem value="on_chain" className="text-[11px]">on-chain</SelectItem>
                <SelectItem value="in_person" className="text-[11px]">in person</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={c.contactInfo}
              onChange={(e) => setContacts(contacts.map((r, j) => (j === i ? { ...r, contactInfo: e.target.value } : r)))}
              placeholder="handle / address"
              className="num h-8 border-[var(--border-default)] bg-white/[0.03] font-mono text-[11px]"
              aria-label={`contact ${i + 1} info`}
            />
            <Input
              value={c.publicKey}
              onChange={(e) => setContacts(contacts.map((r, j) => (j === i ? { ...r, publicKey: e.target.value } : r)))}
              placeholder="public key"
              className="num h-8 border-[var(--border-default)] bg-white/[0.03] font-mono text-[11px]"
              aria-label={`contact ${i + 1} public key`}
            />
            <div className="flex items-center gap-1.5">
              <Select value={c.trustLevel} onValueChange={(v) => setContacts(contacts.map((r, j) => (j === i ? { ...r, trustLevel: v as TrustLocal } : r)))}>
                <SelectTrigger className="h-8 w-[86px] text-[10px]" aria-label={`contact ${i + 1} trust`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high" className="text-[11px]">high</SelectItem>
                  <SelectItem value="medium" className="text-[11px]">medium</SelectItem>
                  <SelectItem value="low" className="text-[11px]">low</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setContacts(contacts.filter((_, j) => j !== i))} aria-label={`remove contact ${i + 1}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="gap-1.5 text-[10px] uppercase tracking-[0.14em]" onClick={() => setContacts([...contacts, emptyContact()])}>
          <Plus className="h-3 w-3" /> Add contact
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <Field label="Threshold · t">
          <Input
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^\d]/g, ""))}
            className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
          />
        </Field>
        <Field label="Vault password · step-up">
          <Input
            type="password"
            autoComplete="off"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
          />
        </Field>
      </div>

      <Button
        className="h-10 w-full gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
        style={{ background: "var(--gradient-saos)" }}
        disabled={!pw || validContacts.length < Math.max(1, Number(threshold) || 1) || social.isPending}
        onClick={() => void doSetup()}
      >
        {social.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
        Split recovery key ({Math.max(1, Number(threshold) || 1)}-of-{validContacts.length})
      </Button>

      {shares ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Shares · hand one to each contact</p>
            {shares.map((s) => (
              <CopyRow key={s.contactId} label={s.contactId} value={s.share.data} onCopy={() => void copy(s.contactId, s.share.data)} />
            ))}
          </div>
          {pkgSaved ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning)]/[0.07] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
              <p className="text-[11px] leading-relaxed text-[var(--warning)]">
                Recovery package downloaded as .recovery — <span className="font-bold">store it together with your backup</span>. Shares alone cannot
                restore the vault; the package is required.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/[0.06] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
              <p className="text-[11px] leading-relaxed text-[var(--warning)]/90">
                Keep the shares safe — reassembly needs {threshold} of them plus the recovery package (Backup &amp; Recovery).
              </p>
            </div>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dead-man tab                                                        */
/* ------------------------------------------------------------------ */

function DeadManTab() {
  const deadman = useVaultDeadMan();
  const { data: statusData, isLoading } = useVaultStatus();
  const cfg = statusData?.status.deadManSwitch ?? null;

  const [enabled, setEnabled] = useState(cfg?.enabled ?? false);
  const [days, setDays] = useState(cfg ? String(cfg.inactiveDays) : "30");
  const [rows, setRows] = useState<Array<{ name: string; account: string; sharePercent: string }>>(
    cfg?.beneficiaries.length ? cfg.beneficiaries.map((b) => ({ name: b.name, account: b.account, sharePercent: String(b.sharePercent) })) : [{ name: "", account: "", sharePercent: "100" }],
  );
  const [pw, setPw] = useState("");

  const percentSum = rows.reduce((acc, r) => acc + (Number(r.sharePercent) || 0), 0);
  const overdue = cfg ? cfg.enabled && Date.now() - cfg.lastHeartbeat > cfg.inactiveDays * 86_400_000 : false;

  const doSave = async () => {
    try {
      await deadman.mutateAsync({
        enabled,
        inactiveDays: Math.max(1, Number(days) || 1),
        beneficiaries: rows
          .filter((r) => r.account.trim())
          .map((r) => ({ name: r.name.trim() || r.account.trim(), account: r.account.trim(), sharePercent: Number(r.sharePercent) || 0 })),
        password: pw,
      });
      toast.success("dead-man switch updated", { description: "heartbeat refreshed · deadman_updated audited" });
    } catch {
      /* toasted by the hook */
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2.5" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* current status */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <HeartPulse className={cn("h-4 w-4", cfg?.enabled ? (overdue ? "text-[var(--down)]" : "text-[var(--up)]") : "text-[var(--text-tertiary)]")} aria-hidden />
          <div>
            <p className="text-[11px] font-semibold text-foreground/90">
              {cfg?.enabled ? "armed" : "disarmed"}{" "}
              {overdue ? (
                <span className="num ml-1 rounded-full border border-[var(--down)]/40 bg-[var(--down)]/10 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.14em] text-[var(--down)]">OVERDUE</span>
              ) : null}
            </p>
            <p className="num text-[10px] text-[var(--text-tertiary)]">
              last heartbeat {fmtRelMs(cfg?.lastHeartbeat ?? null)} · window {cfg?.inactiveDays ?? "—"}d
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="dead-man switch enabled" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <Field label="Inactive days">
          <Input
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))}
            className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
          />
        </Field>
        <Field label="Vault password · step-up">
          <Input
            type="password"
            autoComplete="off"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="num h-9 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Beneficiaries</p>
          <p className="num text-[10px]" style={{ color: percentSum === 100 ? "var(--up)" : "var(--warning)" }}>
            Σ {percentSum}% {percentSum === 100 ? "✓" : "· should total 100"}
          </p>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_72px_auto] gap-2">
            <Input
              value={r.name}
              onChange={(e) => setRows(rows.map((row, j) => (j === i ? { ...row, name: e.target.value } : row)))}
              placeholder="name"
              className="h-8 border-[var(--border-default)] bg-white/[0.03] text-[11px]"
              aria-label={`beneficiary ${i + 1} name`}
            />
            <Input
              value={r.account}
              onChange={(e) => setRows(rows.map((row, j) => (j === i ? { ...row, account: e.target.value } : row)))}
              placeholder="account"
              className="num h-8 border-[var(--border-default)] bg-white/[0.03] font-mono text-[11px]"
              aria-label={`beneficiary ${i + 1} account`}
            />
            <Input
              value={r.sharePercent}
              onChange={(e) => setRows(rows.map((row, j) => (j === i ? { ...row, sharePercent: e.target.value.replace(/[^\d]/g, "") } : row)))}
              placeholder="%"
              className="num h-8 border-[var(--border-default)] bg-white/[0.03] font-mono text-[11px]"
              aria-label={`beneficiary ${i + 1} share percent`}
            />
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`remove beneficiary ${i + 1}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="gap-1.5 text-[10px] uppercase tracking-[0.14em]" onClick={() => setRows([...rows, { name: "", account: "", sharePercent: "0" }])}>
          <Plus className="h-3 w-3" /> Add beneficiary
        </Button>
      </div>

      <Button
        className="h-10 w-full gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
        style={{ background: "var(--gradient-saos)" }}
        disabled={!pw || deadman.isPending}
        onClick={() => void doSave()}
      >
        {deadman.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save dead-man configuration
      </Button>
    </div>
  );
}
