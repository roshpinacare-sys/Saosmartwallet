"use client";

/**
 * OpenOrdersPanel — the DEX lifecycle's closing leg (M3+).
 * ========================================================
 * Lists the tracked account's open limit orders (data already polled by
 * useWallet — deliberately NO second poller) and wires limit_order_cancel
 * end-to-end:
 *
 *   Cancel → POST /api/steem/trade/cancel      (unsigned preview, oracle-verified
 *                                               cancel serialization)
 *          → POST /api/vault/sign-cancel       (step-up password → policy gate →
 *                                               key reveal → optional broadcast)
 *          → wallet query invalidated          (order disappears when cancelled)
 *
 * Cancel wire format was verified live against the node's own serializer
 * (condenser_api.get_transaction_hex, 2026-09-08). A cancel puts nothing at
 * risk — the unfilled remainder returns to the owner — but it is still
 * policy-gated and audited like every other vault signature.
 */

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, Check, Copy, ExternalLink, Fingerprint, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, useVaultSignCancel, useVaultStatus } from "@/hooks/use-vault";
import { buildCancelOrder, fmtPrice, type BuildCancelResponse, type WalletResponse } from "@/hooks/use-steem-market";
import type { PolicyDecision } from "@/lib/vault-contracts";

type OpenOrder = WalletResponse["openOrders"][number];

type Phase = "input" | "signing" | "violated" | "error" | "signed";

export function OpenOrdersPanel({
  account,
  orders,
}: {
  account: string;
  orders: OpenOrder[];
}) {
  const [target, setTarget] = useState<OpenOrder | null>(null);

  return (
    <div className="space-y-2" aria-label="Open orders">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          open orders · limit_order_cancel live
        </p>
        <span className="num text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {orders.length} resting
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-3 text-center text-[10.5px] text-[var(--text-tertiary)]">
          no resting orders for @{account} — fills land on the tape as they match
        </p>
      ) : (
        <div className="scroll-thin max-h-64 overflow-y-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[rgba(10,10,10,0.85)] backdrop-blur">
              <tr className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                <th className="px-2.5 py-2 font-medium">id</th>
                <th className="px-2.5 py-2 font-medium">selling</th>
                <th className="px-2.5 py-2 font-medium">receiving</th>
                <th className="px-2.5 py-2 text-right font-medium">price</th>
                <th className="px-2.5 py-2 text-right font-medium">age</th>
                <th className="px-2.5 py-2" aria-label="actions" />
              </tr>
            </thead>
            <tbody className="num">
              {orders.map((o) => (
                <tr key={o.orderid} className="border-t border-[var(--border-subtle)]/60">
                  <td className="px-2.5 py-1.5 text-[var(--text-tertiary)]" title={`created ${o.created}`}>
                    {o.orderid}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className={o.sellingSymbol === "STEEM" ? "text-[var(--up)]" : "text-foreground/85"}>
                      {o.sellingAmount} {o.sellingSymbol}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-foreground/85">
                    {o.receivingAmount} {o.receivingSymbol}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">{fmtPrice(o.price)}</td>
                  <td className="px-2.5 py-1.5 text-right text-[var(--text-tertiary)]">{ageOf(o.created)}</td>
                  <td className="px-2.5 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[9.5px] uppercase tracking-wider text-[var(--down)] hover:text-[var(--down)]"
                      onClick={() => setTarget(o)}
                      aria-label={`cancel order ${o.orderid}`}
                    >
                      <Ban className="h-3 w-3" /> cancel
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CancelOrderDialog order={target} onClose={() => setTarget(null)} />
    </div>
  );
}

/** Human age for a node timestamp (server returns "YYYY-MM-DDTHH:MM:SS", UTC). */
function ageOf(iso: string): string {
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function CancelOrderDialog({ order, onClose }: { order: OpenOrder | null; onClose: () => void }) {
  const qc = useQueryClient();
  const sign = useVaultSignCancel();
  const { data: vaultStatusData } = useVaultStatus();
  const vault = vaultStatusData?.status ?? null;

  const [preview, setPreview] = useState<BuildCancelResponse | null>(null);
  const [building, setBuilding] = useState(false);
  const [password, setPassword] = useState("");
  const [broadcast, setBroadcast] = useState(true);
  const [phase, setPhase] = useState<Phase>("input");
  const [violation, setViolation] = useState<PolicyDecision | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [signed, setSigned] = useState<BuildCancelResponse | null>(null);
  const [signatureHex, setSignatureHex] = useState("");
  const [broadcastTxId, setBroadcastTxId] = useState<string | null>(null);

  const open = order !== null;

  // Build the unsigned preview when a new order is targeted (one flow, no
  // dead states). Effect — not render — because this is a side effect.
  // All hooks stay unconditional; the null guard lives inside.
  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    setPreview(null);
    setBuilding(true);
    setPhase("input");
    setViolation(null);
    setErrorMsg("");
    setSigned(null);
    setSignatureHex("");
    setBroadcastTxId(null);
    setPassword("");
    setBroadcast(true);
    void (async () => {
      try {
        const res = await buildCancelOrder({ account: order.seller, orderid: order.orderid });
        if (!cancelled) setPreview(res);
      } catch (err) {
        if (!cancelled) {
          toast.error("cancel build failed", { description: err instanceof Error ? err.message : String(err) });
          onClose();
        }
      } finally {
        if (!cancelled) setBuilding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order]);

  if (!order) return null;

  const close = (o: boolean) => {
    if (!o) onClose();
  };

  const handleErr = (err: ApiError) => {
    if (err.code === "POLICY_DENIED" || (err.decision && !err.decision.allowed)) {
      setViolation(err.decision ?? null);
      setPhase("violated");
    } else {
      setErrorMsg(err.message);
      setPhase("error");
    }
  };

  const doSign = async () => {
    setPhase("signing");
    try {
      const res = await sign.mutateAsync({
        network: "steem",
        account: order.seller,
        orderid: order.orderid,
        password,
        broadcast,
      });
      setSigned(preview);
      setSignatureHex(res.signatureHex);
      setBroadcastTxId(res.broadcast?.txId ?? null);
      setPhase("signed");
      toast.success(broadcast ? "order cancelled & broadcast" : "cancel signed (not broadcast)", {
        description: `tx ${res.txId.slice(0, 16)}… · ${res.byteLength} bytes`,
      });
      // Refresh the wallet (open orders + balances) — the resting order is gone.
      await qc.invalidateQueries({ queryKey: ["steem", "wallet", order.seller] });
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

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="glass scroll-thin max-h-[85vh] overflow-y-auto border-[var(--border-default)] sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em]">
            <Ban className="h-4 w-4 text-[var(--down)]" aria-hidden />
            Cancel order #{order.orderid}
          </DialogTitle>
          <DialogDescription className="num text-[11px] text-[var(--text-tertiary)]">
            limit_order_cancel · the unfilled remainder returns to @{order.seller} · nothing is spent
          </DialogDescription>
        </DialogHeader>

        {/* order summary */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-3">
          <div className="num flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11.5px]">
            <span>
              selling <span className="text-foreground/90">{order.sellingAmount} {order.sellingSymbol}</span>
            </span>
            <span aria-hidden className="text-[var(--text-tertiary)]">
              →
            </span>
            <span>
              receiving <span className="text-foreground/90">{order.receivingAmount} {order.receivingSymbol}</span>
            </span>
            <span className="text-[var(--text-tertiary)]">@ {fmtPrice(order.price)}</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="space-y-4"
          >
            {phase === "input" ? (
              building || !preview ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  <Loader2 className="h-4 w-4 animate-spin" /> building cancel bytes…
                </div>
              ) : (
                <div className="space-y-4">
                  {/* unsigned preview */}
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-3">
                    <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                      operation · limit_order_cancel
                    </p>
                    <div className="num space-y-1 text-[11.5px]">
                      <PreviewRow k="owner" v={`@${preview.operation.payload.owner}`} />
                      <PreviewRow k="orderid" v={String(preview.operation.payload.orderid)} />
                      <PreviewRow k="ref_block" v={`${preview.unsignedTx.refBlockNum}/${preview.unsignedTx.refBlockPrefix}`} />
                      <PreviewRow k="tx expiration" v={`${preview.unsignedTx.txExpiration} (60s window)`} />
                      <PreviewRow k="bytes" v={String(preview.byteLength)} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--up)]/25 bg-[var(--up)]/5 p-3">
                    <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-[var(--up)]">
                      signing digest · sha256(chain_id ‖ tx)
                    </p>
                    <p className="hex-string break-all text-[10px]">{preview.digestHex}</p>
                    <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">required role: ACTIVE key · policy-checked</p>
                  </div>

                  {/* vault notice / password + broadcast */}
                  {vault && !vault.initialized ? (
                    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
                      <p className="text-[11px] leading-relaxed text-[var(--warning)]/90">
                        <span className="font-bold uppercase tracking-wider">Vault not initialized.</span>{" "}
                        Set up the Sovereign Key Vault in the VAULT tab (7), then return to sign. Nothing moved.
                      </p>
                    </div>
                  ) : (
                    <>
                      {vault && vault.locked ? (
                        <p className="text-[10px] text-[var(--warning)]">
                          vault locked — the step-up password below signs with step-up authority
                        </p>
                      ) : null}
                      <div className="space-y-1.5">
                        <Label htmlFor="cancel-pw" className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                          Vault password · step-up
                        </Label>
                        <Input
                          id="cancel-pw"
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
                      <Button
                        size="lg"
                        className="h-11 w-full gap-2 text-[12px] font-bold uppercase tracking-[0.18em] text-white hover:opacity-90"
                        style={{ background: "var(--gradient-danger)" }}
                        disabled={sign.isPending || password.length === 0}
                        onClick={() => void doSign()}
                      >
                        <Fingerprint className="h-4 w-4" />
                        {sign.isPending ? "signing…" : "Sign & Cancel Order"}
                      </Button>
                    </>
                  )}
                </div>
              )
            ) : null}

            {phase === "signing" ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> policy → digest → secp256k1 {broadcast ? "→ broadcast" : ""}
              </div>
            ) : null}

            {phase === "violated" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--down)]/40 bg-[var(--down)]/[0.07] p-3.5">
                  <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--down)]">
                    <ShieldAlert className="h-4 w-4" aria-hidden /> Policy Violation
                  </p>
                  {violation ? (
                    <div className="mt-3 space-y-2">
                      {violation.checks
                        .filter((c) => !c.pass)
                        .map((c) => (
                          <div key={c.ruleId} className="rounded border border-[var(--down)]/25 bg-black/20 px-2.5 py-2">
                            <p className="num text-[10px] uppercase tracking-[0.14em] text-[var(--down)]">✗ {c.name}</p>
                            <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">{c.detail}</p>
                          </div>
                        ))}
                    </div>
                  ) : null}
                  <p className="mt-2.5 text-[10px] text-[var(--text-tertiary)]">
                    nothing was signed · nothing was broadcast · attempt audited
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="w-full text-[11px] uppercase tracking-wider" onClick={() => setPhase("input")}>
                  Back
                </Button>
              </div>
            ) : null}

            {phase === "error" ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 rounded-lg border border-[var(--down)]/30 bg-[var(--down)]/[0.07] p-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--down)]" aria-hidden />
                  <p className="text-[11px] leading-relaxed text-[var(--down)]/90">{errorMsg || "signing failed"}</p>
                </div>
                <Button variant="secondary" size="sm" className="w-full text-[11px] uppercase tracking-wider" onClick={() => setPhase("input")}>
                  Back
                </Button>
              </div>
            ) : null}

            {phase === "signed" && signed ? (
              <div className="space-y-3">
                <div className="space-y-2.5 rounded-lg border border-[var(--up)]/25 bg-[var(--up)]/[0.05] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-[var(--up)]">
                      <Check className="h-3.5 w-3.5" aria-hidden /> signed {broadcastTxId ? "& broadcast" : "(signed only)"}
                    </p>
                    <span className="num text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{signed.byteLength} bytes</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">tx id</p>
                    <div className="flex items-center gap-2">
                      {broadcastTxId ? (
                        <a
                          href={`https://steemscan.com/tx/${broadcastTxId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-[var(--info)] hover:text-[var(--up)]"
                        >
                          explorer <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void copy("tx id", broadcastTxId ?? signed.txId)}
                        className="text-[var(--text-tertiary)] hover:text-[var(--up)]"
                        aria-label="copy tx id"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="hex-string break-all text-[10px]">{broadcastTxId ?? signed.txId}</p>
                  <p className="hex-string break-all text-[10px] text-[var(--text-tertiary)]">sig {signatureHex.slice(0, 42)}…</p>
                </div>
                <Button variant="secondary" size="sm" className="w-full text-[11px] uppercase tracking-wider" onClick={() => close(false)}>
                  Close
                </Button>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[var(--text-tertiary)]">{k}</span>
      <span className="truncate text-right text-foreground/90" title={v}>
        {v}
      </span>
    </div>
  );
}
