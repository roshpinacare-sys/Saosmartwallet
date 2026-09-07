"use client";

/**
 * TradeTerminal — limit-order builder wired to the M0/M1 engine.
 * Flow: user picks side/price/amount → POST /api/steem/trade/build → the
 * server computes the limit_order_create payload with BigInt math, stamps
 * ref-block fields via SteemAdapter.buildOperations, serializes with the
 * oracle-verified engine, and returns an UNSIGNED preview. The dialog shows
 * the exact bytes + digest. Signing is gated (keystore ships in packages/core,
 * M2) — this terminal cannot broadcast, by construction.
 */

import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Check,
  Copy,
  Loader2,
  ShieldAlert,
  TerminalSquare,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { LiveBadge, PanelHeader } from "@/components/dex/terminal-furniture";
import {
  buildOrder,
  fmtPrice,
  useMarketFeed,
  useWallet,
  type BuildOrderResponse,
} from "@/hooks/use-steem-market";
import { useDexStore } from "@/lib/dex-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Side = "buy" | "sell";

const TTL_OPTIONS = [
  { value: "3600", label: "1 hour" },
  { value: "21600", label: "6 hours" },
  { value: "86400", label: "24 hours" },
  { value: "259200", label: "3 days" },
  { value: "604800", label: "7 days" },
];

const ACCOUNT_RE = /^[a-z0-9.\-]{3,16}$/;

export function TradeTerminal() {
  const { account, setAccount, pricePrefill } = useDexStore();
  const [accountDraft, setAccountDraft] = useState(account);
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [ttl, setTtl] = useState("21600");
  const [fillOrKill, setFillOrKill] = useState(false);
  const [preview, setPreview] = useState<BuildOrderResponse | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: feed } = useMarketFeed();
  const { data: wallet } = useWallet(account);

  // store → local state sync using React's adjust-during-render pattern
  // (no effects — avoids cascading renders and satisfies set-state lint)
  const [lastAppliedPrefill, setLastAppliedPrefill] = useState(pricePrefill);
  if (pricePrefill && pricePrefill !== lastAppliedPrefill) {
    setLastAppliedPrefill(pricePrefill);
    setPrice(pricePrefill.price);
    setSide(pricePrefill.sideHint === "ask" ? "buy" : "sell");
  }
  const [lastAccount, setLastAccount] = useState(account);
  if (account !== lastAccount) {
    setLastAccount(account);
    setAccountDraft(account);
  }

  const steemBalance = useMemo(() => {
    const m = /^([\d.]+)\s+STEEM$/.exec(wallet?.account.balances.liquid ?? "");
    return m ? Number(m[1]) : 0;
  }, [wallet]);
  const sbdBalance = useMemo(() => {
    const m = /^([\d.]+)\s+SBD$/.exec(wallet?.account.balances.debt ?? "");
    return m ? Number(m[1]) : 0;
  }, [wallet]);

  const bid = feed?.ticker.highestBid ? Number(feed.ticker.highestBid) : NaN;
  const ask = feed?.ticker.lowestAsk ? Number(feed.ticker.lowestAsk) : NaN;
  const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : NaN;

  const amountNum = Number(amount || "0");
  const priceNum = Number(price || "0");
  // floor to the SBD satoshi grid — mirrors the server's BigInt math so the
  // preview never contradicts this row (display only; server is authoritative)
  const total = amountNum > 0 && priceNum > 0 ? Math.floor(amountNum * priceNum * 1000) / 1000 : 0;

  const valid =
    ACCOUNT_RE.test(account) &&
    priceNum > 0 &&
    amountNum > 0 &&
    (side === "buy" ? sbdBalance === 0 || total <= sbdBalance * 1.0001 : steemBalance === 0 || amountNum <= steemBalance * 1.0001);

  const build = useMutation({
    mutationFn: () =>
      buildOrder({
        account,
        side,
        amount: amountNum.toFixed(3),
        price: priceNum.toFixed(6),
        fillOrKill,
        ttlSeconds: Number(ttl),
      }),
    onSuccess: (res) => {
      setPreview(res);
      setDialogOpen(true);
      toast.success("limit_order_create built & serialized", {
        description: `${res.byteLength} bytes · tx ${res.txId.slice(0, 16)}…`,
      });
    },
    onError: (err) => {
      toast.error("order build failed", { description: err instanceof Error ? err.message : String(err) });
    },
  });

  const quickFill = (pct: number) => {
    if (side === "sell") {
      setAmount(((steemBalance * pct) / 100).toFixed(3));
    } else if (priceNum > 0) {
      setAmount(((sbdBalance * pct) / 100 / priceNum).toFixed(3));
    }
  };

  return (
    <section className="glass flex flex-col overflow-hidden rounded-xl" aria-label="Trading terminal">
      <PanelHeader
        title="Trading Terminal"
        subtitle="LIMIT_ORDER_CREATE · M0 ENGINE"
        icon={<TerminalSquare className="h-4 w-4" />}
        right={
          <div className="flex items-center gap-2">
            {wallet ? <LiveBadge active label="SYNCED" /> : null}
          </div>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {/* account */}
        <div className="space-y-1.5">
          <Label htmlFor="terminal-account" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Account (owner)
          </Label>
          <div className="flex gap-2">
            <Input
              id="terminal-account"
              value={accountDraft}
              onChange={(e) => setAccountDraft(e.target.value.toLowerCase())}
              placeholder="steem-account"
              className="num h-9 font-mono text-[13px]"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              variant="secondary"
              size="sm"
              className="h-9 shrink-0 gap-1.5 px-3 text-[11px] uppercase tracking-wider"
              onClick={() => {
                if (!ACCOUNT_RE.test(accountDraft)) {
                  toast.error("invalid account name", { description: "3–16 chars: a-z 0-9 . -" });
                  return;
                }
                setAccount(accountDraft);
                toast(`wallet synced: @${accountDraft}`);
              }}
            >
              <Wallet className="h-3.5 w-3.5" /> Track
            </Button>
          </div>
          {account && wallet ? (
            <p className="num text-[10px] text-muted-foreground">
              liquid <span className="text-[var(--up)]">{steemBalance.toLocaleString("en-US", { maximumFractionDigits: 3 })} STEEM</span>
              {" · "}
              <span className="text-foreground/80">{sbdBalance.toLocaleString("en-US", { maximumFractionDigits: 3 })} SBD</span>
            </p>
          ) : null}
        </div>

        {/* side tabs */}
        <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
          <TabsList className="grid h-11 w-full grid-cols-2 bg-secondary/60 p-1">
            <TabsTrigger
              value="buy"
              className="gap-1.5 rounded-md text-[12px] font-bold uppercase tracking-[0.14em] data-[state=active]:bg-[var(--up)]/15 data-[state=active]:text-[var(--up)] data-[state=active]:shadow-[inset_0_0_0_1px_var(--up)]/40"
            >
              <ArrowUpFromLine className="h-3.5 w-3.5" /> Buy STEEM
            </TabsTrigger>
            <TabsTrigger
              value="sell"
              className="gap-1.5 rounded-md text-[12px] font-bold uppercase tracking-[0.14em] data-[state=active]:bg-[var(--down)]/15 data-[state=active]:text-[var(--down)] data-[state=active]:shadow-[inset_0_0_0_1px_var(--down)]/40"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" /> Sell STEEM
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* price */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="terminal-price" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Limit price · SBD per STEEM
            </Label>
            <div className="flex gap-1">
              {[
                { label: "BID", v: bid },
                { label: "MID", v: mid },
                { label: "ASK", v: ask },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => Number.isFinite(p.v) && p.v > 0 && setPrice(p.v.toFixed(6))}
                  className="num rounded border border-border/70 px-1.5 py-0.5 text-[9px] tracking-wider text-muted-foreground transition-colors hover:border-[var(--up)]/40 hover:text-[var(--up)]"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <Input
            id="terminal-price"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.000000"
            inputMode="decimal"
            className="num h-10 text-right font-mono text-[15px]"
          />
        </div>

        {/* amount */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="terminal-amount" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Amount · STEEM
            </Label>
            <div className="flex gap-1">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => quickFill(p)}
                  disabled={!account || !wallet}
                  className="num rounded border border-border/70 px-1.5 py-0.5 text-[9px] tracking-wider text-muted-foreground transition-colors hover:border-[var(--up)]/40 hover:text-[var(--up)] disabled:opacity-30"
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <Input
            id="terminal-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.000"
            inputMode="decimal"
            className="num h-10 text-right font-mono text-[15px]"
          />
        </div>

        {/* total */}
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {side === "buy" ? "Cost" : "Receive"} · SBD
          </span>
          <span className="num text-sm font-bold text-foreground">{total > 0 ? total.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "0.000"}</span>
        </div>

        {/* options row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Order lifetime</Label>
            <Select value={ttl} onValueChange={setTtl}>
              <SelectTrigger className="h-9 text-[12px]">
                <SelectValue placeholder="lifetime" />
              </SelectTrigger>
              <SelectContent>
                {TTL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-[12px]">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
            <div>
              <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Fill-or-kill</Label>
              <p className="text-[9px] text-muted-foreground">die instead of resting</p>
            </div>
            <Switch checked={fillOrKill} onCheckedChange={setFillOrKill} aria-label="fill or kill" />
          </div>
        </div>

        {/* build */}
        <Button
          size="lg"
          disabled={!valid || build.isPending}
          onClick={() => build.mutate()}
          className={cn(
            "h-12 gap-2 text-[13px] font-bold uppercase tracking-[0.18em]",
            side === "buy"
              ? "bg-[var(--up)] text-[oklch(0.15_0.02_165)] hover:bg-[var(--up)]/85"
              : "bg-[var(--down)] text-white hover:bg-[var(--down)]/85",
          )}
        >
          {build.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> building bytes…
            </>
          ) : (
            <>
              {side === "buy" ? "Buy" : "Sell"} {amountNum > 0 ? amountNum.toLocaleString("en-US", { maximumFractionDigits: 3 }) : ""} STEEM
              <span className="opacity-70">@ {priceNum > 0 ? priceNum.toFixed(6) : "—"} SBD</span>
            </>
          )}
        </Button>

        {!valid && account && (amountNum > 0 || priceNum > 0) ? (
          <p className="flex items-center gap-1.5 text-[10px] text-[var(--amberterminal)]">
            <Ban className="h-3 w-3" />
            {side === "buy"
              ? total > sbdBalance && sbdBalance > 0
                ? "cost exceeds tracked SBD balance"
                : "enter a valid price, amount and tracked account"
              : amountNum > steemBalance && steemBalance > 0
                ? "amount exceeds tracked STEEM balance"
                : "enter a valid price, amount and tracked account"}
          </p>
        ) : null}
      </div>

      <OrderPreviewDialog open={dialogOpen} onOpenChange={setDialogOpen} preview={preview} />
    </section>
  );
}

function OrderPreviewDialog({
  open,
  onOpenChange,
  preview,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  preview: BuildOrderResponse | null;
}) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass max-h-[85vh] overflow-y-auto border-border/70 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em]">
            <Check className="h-4 w-4 text-[var(--up)]" />
            Order built — ready for signing
          </DialogTitle>
          <DialogDescription className="num text-[11px]">
            {preview ? (
              <>
                {preview.side.toUpperCase()} · {preview.operation.payload.amount_to_sell} → {preview.operation.payload.min_to_receive}
                {" · "}
                effective {fmtPrice(Number(preview.effectivePrice) / 1e6)} SBD/STEEM
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="space-y-4">
            {/* op payload */}
            <div className="rounded-lg border border-border/60 bg-secondary/40 p-3">
              <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                operation · limit_order_create
              </p>
              <div className="num space-y-1 text-[11.5px]">
                <Row k="owner" v={`@${preview.operation.payload.owner}`} />
                <Row k="orderid" v={String(preview.operation.payload.orderid)} />
                <Row k="amount_to_sell" v={preview.operation.payload.amount_to_sell} />
                <Row k="min_to_receive" v={preview.operation.payload.min_to_receive} />
                <Row k="fill_or_kill" v={String(preview.operation.payload.fill_or_kill)} />
                <Row k="expiration" v={preview.operation.payload.expiration} />
              </div>
            </div>

            {/* tx envelope */}
            <div className="rounded-lg border border-border/60 bg-secondary/40 p-3">
              <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                unsigned transaction envelope
              </p>
              <div className="num space-y-1 text-[11.5px]">
                <Row k="ref_block_num" v={String(preview.unsignedTx.refBlockNum)} />
                <Row k="ref_block_prefix" v={String(preview.unsignedTx.refBlockPrefix)} />
                <Row k="tx expiration" v={`${preview.unsignedTx.txExpiration} (60s window)`} />
                <Row k="chain_id" v={`${preview.unsignedTx.chainId.slice(0, 16)}… (steem = 32×00)`} />
                <Row k="tx_id" v={preview.txId} copy={{ label: "tx id", value: preview.txId, copied: copied === "tx id", onCopy: copy }} />
                <Row k="bytes" v={String(preview.byteLength)} />
              </div>
            </div>

            {/* serialized hex */}
            <div className="rounded-lg border border-border/60 bg-secondary/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  serialized (sha256 digest preimage) · hex
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[10px] uppercase tracking-wider"
                  onClick={() => copy("hex", preview.serializedHex)}
                >
                  {copied === "hex" ? <Check className="h-3 w-3 text-[var(--up)]" /> : <Copy className="h-3 w-3" />}
                  copy
                </Button>
              </div>
              <div className="scroll-thin max-h-24 overflow-y-auto rounded border border-border/50 bg-background/60 p-2">
                <p className="hex-string">{preview.serializedHex}</p>
              </div>
            </div>

            {/* digest */}
            <div className="rounded-lg border border-[var(--up)]/25 bg-[var(--up)]/5 p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--up)]">
                  signing digest · sha256(chain_id ‖ tx)
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[10px] uppercase tracking-wider"
                  onClick={() => copy("digest", preview.digestHex)}
                >
                  {copied === "digest" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  copy
                </Button>
              </div>
              <p className="hex-string">{preview.digestHex}</p>
              <p className="mt-2 text-[10px] text-muted-foreground">required role: ACTIVE key · policy-checked</p>
            </div>

            {/* gate notice */}
            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--amberterminal)]/30 bg-[var(--amberterminal)]/8 p-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amberterminal)]" aria-hidden />
              <p className="text-[11px] leading-relaxed text-[var(--amberterminal)]/90">
                <span className="font-bold uppercase tracking-wider">Signing locked.</span>{" "}
                Keystore + Policy Engine ship with packages/core (M2). This terminal builds,
                serializes and verifies — it physically cannot broadcast. Nothing moved.
              </p>
            </div>

            <AnimatePresence>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="num text-center text-[9px] uppercase tracking-[0.2em] text-muted-foreground"
              >
                {preview.signingStatus}
              </motion.p>
            </AnimatePresence>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  k,
  v,
  copy,
}: {
  k: string;
  v: string;
  copy?: { label: string; value: string; copied: boolean; onCopy: (label: string, value: string) => void };
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-right">
        <span className="truncate text-foreground/90" title={v}>
          {v}
        </span>
        {copy ? (
          <button
            type="button"
            onClick={() => copy.onCopy(copy.label, copy.value)}
            className="shrink-0 text-muted-foreground transition-colors hover:text-[var(--up)]"
            aria-label={`copy ${copy.label}`}
          >
            {copy.copied ? <Check className="h-3 w-3 text-[var(--up)]" /> : <Copy className="h-3 w-3" />}
          </button>
        ) : null}
      </span>
    </div>
  );
}
