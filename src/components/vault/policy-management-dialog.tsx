"use client";

/**
 * PolicyManagementDialog — inspect + tune the policy engine (layer 3).
 * Static rules are compiled-in (badged, read-only). Dynamic / contextual /
 * composite rules are staged locally, then saved with PUT /api/vault/policy.
 * The approve-large-transfer STEEM threshold is edited in STEEM (satoshi
 * backing ÷1000, 3 decimals) and converted back on save. Every save is
 * audited server-side as policy_updated.
 */

import { motion } from "framer-motion";
import { Loader2, Lock, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { ErrorNote, Skeleton } from "@/components/terminal/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useVaultPolicy, useVaultUpdatePolicy } from "@/hooks/use-vault";
import { cn } from "@/lib/utils";
import type { PolicyRuleSet } from "@/lib/vault-contracts";

export function PolicyManagementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading, isError, error, refetch } = useVaultPolicy();
  const updatePolicy = useVaultUpdatePolicy();

  // staged draft + editable threshold inputs (staged = nothing changes until Save)
  const [draft, setDraft] = useState<PolicyRuleSet | null>(null);
  const [lastRules, setLastRules] = useState<PolicyRuleSet | null>(null);
  const [largeSteem, setLargeSteem] = useState("");
  const [rateLimit, setRateLimit] = useState("");

  if (data && data.rules !== lastRules) {
    setLastRules(data.rules);
    setDraft(structuredClone(data.rules));
    const large = data.rules.dynamic.find((r) => r.id === "approve-large-transfer");
    setLargeSteem(large?.amountThreshold?.STEEM ? (Number(large.amountThreshold.STEEM) / 1000).toFixed(3) : "");
    const rate = data.rules.contextual.find((r) => r.id === "rate-limit-hourly");
    setRateLimit(rate?.maxOperationsPerHour !== undefined ? String(rate.maxOperationsPerHour) : "");
  }

  const setRuleEnabled = (kind: "dynamic" | "contextual" | "composite", id: string, enabled: boolean) => {
    if (!draft) return;
    const next = structuredClone(draft);
    const rule = next[kind].find((r) => r.id === id);
    if (rule) rule.enabled = enabled;
    setDraft(next);
  };

  // final staged rules = draft + the two numeric inputs converted back to wire units
  const finalRules: PolicyRuleSet | null = (() => {
    if (!draft) return null;
    const next = structuredClone(draft);
    const large = next.dynamic.find((r) => r.id === "approve-large-transfer");
    if (large && large.amountThreshold) {
      const v = Number(largeSteem);
      if (Number.isFinite(v) && v >= 0) large.amountThreshold = { ...large.amountThreshold, STEEM: String(Math.round(v * 1000)) };
    }
    const rate = next.contextual.find((r) => r.id === "rate-limit-hourly");
    if (rate) {
      const v = Number(rateLimit);
      if (Number.isFinite(v) && v >= 0) rate.maxOperationsPerHour = Math.round(v);
    }
    return next;
  })();

  const dirty = finalRules !== null && lastRules !== null && JSON.stringify(finalRules) !== JSON.stringify(lastRules);

  const save = () => {
    if (!finalRules || !dirty || updatePolicy.isPending) return;
    updatePolicy.mutate({ rules: finalRules });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!updatePolicy.isPending || !o) onOpenChange(o); }}>
      <DialogContent className="glass scroll-thin max-h-[88vh] overflow-y-auto border-[var(--border-default)] sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em]">
            <SlidersHorizontal className="h-4 w-4 text-[var(--info)]" aria-hidden />
            Policy Engine
          </DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--text-tertiary)]">
            dynamic · contextual · composite rule data — changes are staged until saved · policy_updated audited
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2.5" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : isError || !data ? (
          <ErrorNote message={error instanceof Error ? error.message : "policy unavailable"} />
        ) : (
          <div className="space-y-5">
            {/* static — compiled in */}
            <section>
              <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Static rules · compiled-in · cannot be disabled</p>
              <div className="space-y-1.5">
                {data.staticRules.map((r) => (
                  <div key={r.id} className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2.5">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-semibold text-foreground/90">
                        {r.name}{" "}
                        <span className="num ml-1 rounded border border-[var(--border-default)] px-1 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                          compiled-in
                        </span>
                      </p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--text-tertiary)]">{r.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* dynamic */}
            {draft ? (
              <section>
                <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Dynamic rules · amount gates & step-up</p>
                <div className="space-y-2">
                  {draft.dynamic.map((rule) => (
                    <RuleCard
                      key={rule.id}
                      id={rule.id}
                      name={rule.name}
                      enabled={rule.enabled}
                      onToggle={(v) => setRuleEnabled("dynamic", rule.id, v)}
                    >
                      {rule.id === "approve-large-transfer" ? (
                        <div className="flex items-end gap-2">
                          <div className="w-36">
                            <Label htmlFor="policy-large-steem" className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                              STEEM threshold
                            </Label>
                            <Input
                              id="policy-large-steem"
                              inputMode="decimal"
                              value={largeSteem}
                              onChange={(e) => setLargeSteem(e.target.value.replace(/[^\d.]/g, ""))}
                              className="num mt-1 h-8 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
                            />
                          </div>
                          <p className="num pb-1.5 text-[10px] text-[var(--text-tertiary)]">
                            STEEM · backing {Math.round((Number(largeSteem) || 0) * 1000).toLocaleString("en-US")} sats · approval ×{rule.requireApprovalCount ?? 1}
                          </p>
                        </div>
                      ) : null}
                      {rule.id === "deny-huge-transfer" && rule.amountThreshold ? (
                        <p className="num text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                          hard-deny above{" "}
                          {Object.entries(rule.amountThreshold)
                            .map(([sym, sats]) => `${(Number(sats) / (sym === "TRX" ? 1e6 : 1000)).toLocaleString("en-US", { maximumFractionDigits: 3 })} ${sym}`)
                            .join(" · ")}
                        </p>
                      ) : null}
                      {rule.stepUpFor && rule.stepUpFor.length > 0 ? (
                        <p className="num text-[10px] text-[var(--text-tertiary)]">forces password re-entry for: {rule.stepUpFor.join(" · ")}</p>
                      ) : null}
                    </RuleCard>
                  ))}
                </div>
              </section>
            ) : null}

            {/* contextual */}
            {draft ? (
              <section>
                <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Contextual rules · rate & habit</p>
                <div className="space-y-2">
                  {draft.contextual.map((rule) => (
                    <RuleCard
                      key={rule.id}
                      id={rule.id}
                      name={rule.name}
                      enabled={rule.enabled}
                      onToggle={(v) => setRuleEnabled("contextual", rule.id, v)}
                    >
                      {rule.id === "rate-limit-hourly" ? (
                        <div className="flex items-end gap-2">
                          <div className="w-28">
                            <Label htmlFor="policy-rate" className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                              ops / hour
                            </Label>
                            <Input
                              id="policy-rate"
                              inputMode="numeric"
                              value={rateLimit}
                              onChange={(e) => setRateLimit(e.target.value.replace(/[^\d]/g, ""))}
                              className="num mt-1 h-8 border-[var(--border-default)] bg-white/[0.03] font-mono text-[12px]"
                            />
                          </div>
                          <p className="num pb-1.5 text-[10px] text-[var(--text-tertiary)]">action on breach · {rule.action}</p>
                        </div>
                      ) : null}
                      {rule.id === "new-counterparty-cooldown" ? (
                        <p className="num text-[10px] text-[var(--text-tertiary)]">
                          first-seen counterparties need {rule.newActionCooldownHours ?? 0}h trust · action · {rule.action}
                        </p>
                      ) : null}
                    </RuleCard>
                  ))}
                </div>
              </section>
            ) : null}

            {/* composite */}
            {draft ? (
              <section>
                <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Composite rules · risk combination</p>
                <div className="space-y-2">
                  {draft.composite.map((rule) => (
                    <RuleCard
                      key={rule.id}
                      id={rule.id}
                      name={rule.name}
                      enabled={rule.enabled}
                      onToggle={(v) => setRuleEnabled("composite", rule.id, v)}
                    >
                      <p className="num text-[10px] text-[var(--text-tertiary)]">
                        when {rule.operator === "any" ? "any" : "all"} of [{rule.refs.join(" · ")}] trips → {rule.action}
                      </p>
                    </RuleCard>
                  ))}
                </div>
              </section>
            ) : null}

            {/* save */}
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
              <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--up)]" aria-hidden />
                saves are audited as policy_updated · static rules unaffected
              </p>
              <Button
                size="sm"
                className="h-9 gap-1.5 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white hover:opacity-90"
                style={{ background: "var(--gradient-success)" }}
                disabled={!dirty || updatePolicy.isPending}
                onClick={save}
              >
                {updatePolicy.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save rules
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RuleCard({
  id, name, enabled, onToggle, children,
}: {
  id: string;
  name: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      layout="position"
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors",
        enabled ? "border-[var(--up)]/25 bg-[var(--up)]/[0.04]" : "border-[var(--border-subtle)] bg-white/[0.02]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold text-foreground/90">{name}</p>
          <p className="num text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{id}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`toggle ${name}`} />
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </motion.div>
  );
}
