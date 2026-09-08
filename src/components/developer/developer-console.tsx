"use client";

/**
 * DeveloperConsole — DEVELOPER tab (Model 1, Week 1: the metered product is LIVE).
 *
 *   · API KEYS   — create (plaintext shown once, copy-to-clipboard), revoke,
 *                  honest per-key usage counters
 *   · TRY IT     — run the REAL metered endpoint with a key (client-state only,
 *                  never persisted), verdict + latency + quota headers
 *   · USAGE      — ledger analytics: totals, last-24h outcomes, hourly series
 *
 * Anti-mock: every number comes from /api/developer/* and /api/v1/identity/verify.
 * The metered verify hits the same public chains as the PROOFS demo — a FAILED
 * verdict for an unanchored account is an honest measurement, not an error.
 */

import { useState, useSyncExternalStore } from "react";

import { motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { PanelHeader, StatCell } from "@/components/terminal/primitives";
import { RegistryPanel } from "@/components/terminal/registry-panel";
import {
  clearAdminToken,
  getAdminToken,
  setAdminToken,
  useAdminBootstrap,
  useApiKeys,
  useCreateKey,
  useMeteredVerify,
  useRevokeKey,
  useUsage,
  type MeteredVerifyResponse,
} from "@/hooks/use-developer";
import { cn } from "@/lib/utils";

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num font-mono text-[11px] break-all", className)}>{children}</span>;
}

/** No-op external-store subscription — see AdminGateBar's sessionStorage read. */
const subscribeNoop = () => () => {};

function OutcomeChip({ outcome }: { outcome: "PROVEN" | "FAILED" | "ERROR" }) {
  const cls =
    outcome === "PROVEN"
      ? "border-[var(--up)]/40 bg-[var(--up)]/10 text-[var(--up)]"
      : outcome === "FAILED"
        ? "border-[var(--down)]/40 bg-[var(--down)]/10 text-[var(--down)]"
        : "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]";
  return (
    <span className={cn("num inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider", cls)}>
      <BadgeCheck className="h-3 w-3" aria-hidden />
      {outcome}
    </span>
  );
}

/* ─────────────────────────── API KEYS ─────────────────────────── */

/**
 * AdminGateBar — console mutations (mint/revoke keys) are admin-gated
 * server-side. The credential is bootstrap-once (copy-once like the keys
 * themselves), lives in sessionStorage for the tab session, and can be
 * forgotten with one click. Stale tokens are cleared automatically by the
 * hooks on 401.
 */
function AdminGateBar() {
  const bootstrap = useAdminBootstrap();
  const [tokenInput, setTokenInput] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // sessionStorage is browser-only: read it through an external store so the
  // server snapshot renders LOCKED and every re-render re-reads the token
  // (bootstrap/forget both setState → re-render → fresh snapshot).
  const hasToken = useSyncExternalStore(
    subscribeNoop,
    () => getAdminToken() !== null,
    () => false,
  );

  const onBootstrap = () => {
    setAuthError(null);
    bootstrap.mutate(undefined, {
      onSuccess: (r) => {
        if (r.created && r.token) {
          setAdminToken(r.token);
          setFreshToken(r.token);
          setCopied(false);
        } else if (r.exists) {
          setAuthError(r.note ?? "credential already exists — paste its token below");
        }
      },
      onError: (e) => setAuthError(e.message),
    });
  };

  const onPasteToken = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    setAdminToken(t);
    setTokenInput("");
    setAuthError(null);
  };

  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
    } catch {
      // clipboard blocked — the token remains visible for manual copy
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
      role="group"
      aria-label="console admin access"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--saos)]" aria-hidden />
        <span className="text-[10px] font-bold tracking-[0.14em]">ADMIN ACCESS</span>
        <span
          className={cn(
            "num rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.14em]",
            hasToken
              ? "border-[var(--saos)] text-[var(--saos)]"
              : "border-[var(--border-default)] text-[var(--fg-muted)]",
          )}
        >
          {hasToken ? "UNLOCKED (session)" : "LOCKED"}
        </span>
        {hasToken && (
          <button
            type="button"
            className="ml-auto rounded border border-[var(--border-default)] px-2 py-1 text-[10px] font-bold tracking-wider hover:bg-[var(--bg-elevated)]"
            onClick={() => {
              clearAdminToken();
              setFreshToken(null);
            }}
          >
            FORGET TOKEN
          </button>
        )}
      </div>
      {!hasToken && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            className="rounded border border-[var(--saos)] px-2 py-1 text-[10px] font-bold tracking-wider text-[var(--saos)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
            onClick={onBootstrap}
            disabled={bootstrap.isPending}
          >
            {bootstrap.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              "BOOTSTRAP ADMIN TOKEN"
            )}
          </button>
          <form className="flex flex-1 gap-2" onSubmit={onPasteToken}>
            <input
              className="num min-w-0 flex-1 rounded border border-[var(--border-default)] bg-transparent px-2 py-1 font-mono text-[11px] outline-none focus:border-[var(--saos)]"
              placeholder="…or paste an existing admin token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              aria-label="existing admin token"
              autoComplete="off"
            />
            <button
              type="submit"
              className="rounded border border-[var(--border-default)] px-2 py-1 text-[10px] font-bold tracking-wider hover:bg-[var(--bg-elevated)]"
            >
              USE
            </button>
          </form>
        </div>
      )}
      {freshToken && (
        <div className="flex flex-col gap-1 rounded border border-[var(--saos)] p-2">
          <Mono className="text-[var(--saos)]">{freshToken}</Mono>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-bold hover:bg-[var(--bg-elevated)]"
              onClick={copyToken}
            >
              {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
              {copied ? "COPIED" : "COPY"}
            </button>
            <span className="text-[9px] text-[var(--fg-muted)]">
              shown once — only its SHA-256 is stored server-side
            </span>
          </div>
        </div>
      )}
      {authError && (
        <p className="text-[10px] text-[var(--danger,--fg)]" role="alert">
          {authError}
        </p>
      )}
    </div>
  );
}

function KeysPanel() {
  const keys = useApiKeys();
  const create = useCreateKey();
  const revoke = useRevokeKey();
  const [name, setName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(name, {
      onSuccess: (r) => {
        setFreshKey(r.key);
        setCopied(false);
        setName("");
      },
    });
  };

  const copyKey = async () => {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
    } catch {
      // clipboard blocked — the key remains visible for manual copy
    }
  };

  return (
    <section className="glass flex flex-col overflow-hidden" aria-labelledby="dev-keys-title">
      <PanelHeader
        title="API KEYS · SAOS IDENTITY API"
        subtitle="Bearer keys for the metered product endpoint — plaintext shown exactly once"
        icon={<KeyRound className="h-4 w-4 text-[var(--saos)]" aria-hidden />}
        right={
          <span className="num rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[9px] font-bold tracking-[0.14em]">
            {keys.data ? `${keys.data.keys.length} KEY${keys.data.keys.length === 1 ? "" : "S"}` : "…"}
          </span>
        }
        accent="saos"
      />
      <div className="flex flex-col gap-4 p-4">
        <AdminGateBar />
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onCreate}>
          <label className="sr-only" htmlFor="dev-key-name">
            Key name
          </label>
          <input
            id="dev-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="key name (e.g. pilot-customer-1)"
            className="num min-h-11 flex-1 rounded-md border border-[var(--border-default)] bg-black/30 px-3 py-2 font-mono text-xs outline-none focus:border-[var(--saos)]"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="num inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--saos)]/50 bg-[var(--saos)]/15 px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-[var(--saos)] transition hover:bg-[var(--saos)]/25 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <KeyRound className="h-3.5 w-3.5" aria-hidden />}
            CREATE KEY
          </button>
        </form>

        {create.isError && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            {create.error.message}
          </p>
        )}

        {freshKey && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2 rounded-md border border-[var(--up)]/40 bg-[var(--up)]/5 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--up)]">NEW KEY — COPY NOW, SHOWN ONLY THIS ONCE</span>
              <button
                type="button"
                onClick={copyKey}
                className="num inline-flex min-h-8 items-center gap-1.5 rounded border border-[var(--up)]/40 px-2 py-1 text-[10px] font-bold text-[var(--up)] transition hover:bg-[var(--up)]/10"
              >
                {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                {copied ? "COPIED" : "COPY"}
              </button>
            </div>
            <Mono className="text-[var(--up)]">{freshKey}</Mono>
          </motion.div>
        )}

        <div className="max-h-96 overflow-y-auto rounded-md border border-[var(--border-subtle)]">
          <table className="w-full text-left">
            <caption className="sr-only">Developer API keys with usage counters</caption>
            <thead className="sticky top-0 bg-black/60">
              <tr className="num text-[9px] tracking-[0.14em] text-[var(--text-tertiary)]">
                <th className="px-2 py-1.5 font-bold">KEY</th>
                <th className="px-2 py-1.5 font-bold">NAME</th>
                <th className="px-2 py-1.5 font-bold">TODAY</th>
                <th className="px-2 py-1.5 font-bold">TOTAL</th>
                <th className="px-2 py-1.5 font-bold">STATUS</th>
                <th className="px-2 py-1.5 font-bold">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {keys.data?.keys.length === 0 && (
                <tr>
                  <td colSpan={6} className="num px-2 py-4 text-center font-mono text-[10px] text-[var(--text-tertiary)]">
                    no keys yet — create the first one above
                  </td>
                </tr>
              )}
              {keys.data?.keys.map((k) => (
                <tr key={k.id} className="border-t border-[var(--border-subtle)]">
                  <td className="num px-2 py-1.5 font-mono text-[10px]">{k.prefix}…</td>
                  <td className="num max-w-0 truncate px-2 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{k.name}</td>
                  <td className="num px-2 py-1.5 font-mono text-[10px]">{k.callsToday}</td>
                  <td className="num px-2 py-1.5 font-mono text-[10px]">{k.callsTotal}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "num rounded border px-1 py-0.5 text-[8px] font-bold tracking-wider",
                        k.active
                          ? "border-[var(--up)]/40 bg-[var(--up)]/10 text-[var(--up)]"
                          : "border-[var(--down)]/40 bg-[var(--down)]/10 text-[var(--down)]",
                      )}
                    >
                      {k.active ? "ACTIVE" : "REVOKED"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {k.active && (
                      <button
                        type="button"
                        aria-label={`revoke key ${k.prefix}`}
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(k.id)}
                        className="inline-flex min-h-8 items-center rounded border border-[var(--down)]/40 px-2 py-1 text-[10px] font-bold text-[var(--down)] transition hover:bg-[var(--down)]/10 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                        <span className="ml-1 hidden sm:inline">REVOKE</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
          Free tier: 1,000 verified calls / key / UTC day. Every executed call meters (the service does real chain work
          even when the verdict is FAILED). Revoked keys keep their history but are refused at the product endpoint.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────── TRY THE PRODUCT ─────────────────────────── */

function VerifyDetail({ r }: { r: MeteredVerifyResponse }) {
  const m = r.meta;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
      {m && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCell label="OUTCOME" value={<OutcomeChip outcome={m.outcome} />} sub={`key ${m.keyPrefix}…`} />
          <StatCell
            label="LATENCY (MEASURED)"
            value={<span className="num text-lg font-bold text-[var(--up)]">{m.latencyMs.toLocaleString()}ms</span>}
            sub="full chain verification, this call"
          />
          <StatCell
            label="QUOTA TODAY"
            value={`${m.quota.used}/${m.quota.limit}`}
            sub={`${m.quota.remaining} remaining · resets ${new Date(m.quota.resetAt * 1000).toISOString().slice(11, 16)} UTC`}
          />
          <StatCell label="PLAN" value={m.plan.tier.toUpperCase()} sub={`${m.plan.dailyCalls.toLocaleString()} calls/day · free tier`} />
        </div>
      )}

      {r.ok === true && r.verify && (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--border-subtle)] bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">EVM ADDRESS (EIP-55)</span>
            <Mono className="text-[var(--up)]">{r.verify.recoveredEvm}</Mono>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">STEEM ACTIVE AUTHORITY</span>
            <Mono>{r.verify.activeKeyPub}</Mono>
          </div>
          {r.anchor && (
            <div className="flex items-center justify-between gap-2">
              <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">ON-CHAIN ANCHOR</span>
              <a
                href={r.anchor.explorer}
                target="_blank"
                rel="noreferrer"
                className="num inline-flex items-center gap-1 font-mono text-[11px] text-[var(--saos)] hover:underline"
              >
                block {r.anchor.block}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
          )}
        </div>
      )}

      {r.summary && (
        <p className="rounded-md border border-[var(--up)]/25 bg-[var(--up)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          {r.summary}
        </p>
      )}
      {r.error && (
        <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">{r.error}</p>
      )}
    </motion.div>
  );
}

function TryItPanel() {
  const verify = useMeteredVerify();
  const [key, setKey] = useState("");
  const [username, setUsername] = useState("headcorner");
  const r = verify.data;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const curl = `curl -X POST ${origin}/api/v1/identity/verify \\
  -H "Authorization: Bearer saos_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"${username}"}'`;

  // Mirrors the shipped packages/saos-id-verify SDK (live-dogfooded by tools/m1-w2-sdk-dogfood.ts).
  const sdk = `npm i saos-id-verify

import { verifyIdentity } from "saos-id-verify";

const r = await verifyIdentity({
  baseUrl: "${origin || "https://<your-saos-gateway>"}",
  apiKey: process.env.SAOS_API_KEY!,
  username: "${username}",
});

if (r.ok) console.log(r.meta.outcome, r.verify.sameScalarProof, r.anchor.block);`;

  return (
    <section className="glass flex flex-col overflow-hidden" aria-labelledby="dev-try-title">
      <PanelHeader
        title="TRY IT · THE METERED ENDPOINT"
        subtitle="POST /api/v1/identity/verify — same math as PROOFS, wrapped in key auth + quota"
        icon={<TerminalSquare className="h-4 w-4 text-[var(--saos)]" aria-hidden />}
        right={r?.meta ? <OutcomeChip outcome={r.meta.outcome} /> : undefined}
        accent="saos"
      />
      <div className="flex flex-col gap-4 p-4">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate({ key, username });
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <label className="sr-only" htmlFor="dev-try-key">
                API key
              </label>
              <input
                id="dev-try-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="saos_live_… (paste a key — kept in this tab only, never stored)"
                autoComplete="off"
                className="num min-h-11 w-full rounded-md border border-[var(--border-default)] bg-black/30 px-3 py-2 font-mono text-xs outline-none focus:border-[var(--saos)]"
              />
            </div>
            <div className="sm:w-52">
              <label className="sr-only" htmlFor="dev-try-user">
                Steem username
              </label>
              <input
                id="dev-try-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="steem username"
                className="num min-h-11 w-full rounded-md border border-[var(--border-default)] bg-black/30 px-3 py-2 font-mono text-xs outline-none focus:border-[var(--saos)]"
              />
            </div>
            <button
              type="submit"
              disabled={verify.isPending || !key.trim()}
              className="num inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--saos)]/50 bg-[var(--saos)]/15 px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-[var(--saos)] transition hover:bg-[var(--saos)]/25 disabled:opacity-50"
            >
              {verify.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <TerminalSquare className="h-3.5 w-3.5" aria-hidden />}
              RUN VERIFY
            </button>
          </div>
        </form>

        {verify.isError && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            {verify.error.message}
          </p>
        )}

        {r && <VerifyDetail r={r} />}

        <details className="rounded-md border border-[var(--border-subtle)] bg-black/20 p-3">
          <summary className="num cursor-pointer text-[10px] font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
            CURL — EXACTLY WHAT AN INTEGRATOR RUNS
          </summary>
          <pre className="num mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">{curl}</pre>
        </details>

        <details className="rounded-md border border-[var(--border-subtle)] bg-black/20 p-3">
          <summary className="num cursor-pointer text-[10px] font-bold tracking-[0.14em] text-[var(--saos)]">
            OFFICIAL SDK — saos-id-verify (npm · week 2 · live-dogfooded)
          </summary>
          <pre className="num mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">{sdk}</pre>
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Zero-dependency TypeScript client in packages/saos-id-verify — typed PROVEN/FAILED union,
            SaosAuthError/SaosQuotaError fail-closed classes, X-RateLimit headers parsed. Build proven
            (strict tsc → dist/), PROVEN + FAILED + 401 all executed live through the SDK itself.
          </p>
        </details>
      </div>
    </section>
  );
}

/* ─────────────────────────── USAGE ─────────────────────────── */

function UsagePanel() {
  const usage = useUsage();
  const u = usage.data;
  const maxCalls = Math.max(1, ...(u?.series.map((s) => s.calls) ?? [1]));

  return (
    <section className="glass flex flex-col overflow-hidden" aria-labelledby="dev-usage-title">
      <PanelHeader
        title="USAGE · METERING LEDGER"
        subtitle="Executed product calls, counted where they happen — zero calls is a real zero"
        icon={<TrendingUp className="h-4 w-4 text-[var(--saos)]" aria-hidden />}
        accent="saos"
      />
      <div className="flex flex-col gap-4 p-4">
        {usage.isError && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            {usage.error.message}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCell label="API KEYS" value={u?.totals.apiKeys ?? "…"} sub="created all-time" />
          <StatCell label="CALLS TODAY (UTC)" value={u?.totals.callsToday ?? "…"} sub="all keys" />
          <StatCell label="CALLS ALL-TIME" value={u?.totals.callsAllTime ?? "…"} sub="the ledger" />
          <StatCell
            label="AVG LATENCY 24H"
            value={u ? (u.last24h.total > 0 ? `${u.last24h.avgLatencyMs.toLocaleString()}ms` : "—") : "…"}
            sub={u && u.last24h.total > 0 ? `${u.last24h.total} calls measured` : "no calls in 24h"}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="num flex items-center justify-between text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">
            <span>LAST 24H · HOURLY BUCKETS (UTC)</span>
            {u && (
              <span>
                PROVEN {u.last24h.proven} · FAILED {u.last24h.failed} · ERROR {u.last24h.errored}
              </span>
            )}
          </div>
          <div className="flex h-20 items-end gap-[3px]" role="img" aria-label="Hourly call volume over the last 24 hours">
            {(u?.series ?? Array.from({ length: 24 }).map((_, i) => ({ utcHour: String(i), calls: -1 }))).map((s, i) => {
              const unknown = s.calls < 0;
              const h = unknown ? 4 : Math.max(4, (s.calls / maxCalls) * 100);
              return (
                <div
                  key={i}
                  className={cn("flex-1 rounded-sm", unknown ? "animate-pulse bg-white/5" : s.calls > 0 ? "bg-[var(--up)]" : "bg-white/10")}
                  style={{ height: `${h}%` }}
                  title={unknown ? "measuring…" : `${s.calls} calls @ ${s.utcHour.slice(11, 13)}:00 UTC`}
                />
              );
            })}
          </div>
          <div className="num flex justify-between text-[9px] text-[var(--text-tertiary)]">
            <span>-24h</span>
            <span>now (UTC)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DeveloperConsole() {
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <TryItPanel />
      <KeysPanel />
      <UsagePanel />
      {/* repo registry + honest gaps — dev meta belongs with the developer surface */}
      <div className="flex flex-col gap-2">
        <p className="num text-[9px] uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
          repo registry — what exists where · honest gaps
        </p>
        <RegistryPanel />
      </div>
    </div>
  );
}
