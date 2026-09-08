/**
 * GET /api/system/health — System Owner consolidated probe (M4)
 * =============================================================
 * ONE endpoint that probes every live component of the ecosystem and
 * reports the truth: 7 networks, the bridge rails, the vault, and the
 * internal STEEM/SBD DEX. Every field is measured from the live chain /
 * repo / engine — a dead component is DATA (issue entry with a reason),
 * never a fabricated green checkmark, never a 500.
 *
 * Composition (no duplicated RPC logic):
 *  · networks  → eco-server probes (same feed that powers the GRID tab)
 *  · bridges   → packages/bridges monitor over the live SAOS-NET state
 *                + live router fee quotes for the two direct rails
 *  · vault     → the M2 engine's secret-free status surface
 *  · dex       → the M1 market client (ticker + order book + chain status)
 *
 * Self-healing posture is reported alongside the numbers (what fails over
 * automatically, what stays fail-closed) so the report never overstates.
 */

import { NextResponse } from "next/server";

import { ecoAnchors, ecoNetworks, saosNetSnapshot, withCache } from "@/lib/eco-server";
import { getVaultRuntime } from "@/lib/vault-runtime";
import { steemMarket } from "@/lib/steem-server";
import { bridgeAnalytics, railStatuses } from "../../../../../packages/bridges/monitor";
import { findPaths } from "../../../../../packages/bridges/router";

export const dynamic = "force-dynamic";

type Severity = "critical" | "warning" | "notice";

interface HealthIssue {
  component: string;
  severity: Severity;
  detail: string;
  action: string;
}

const ALL_NETWORKS = ["steem", "hive", "blurt", "tron", "saos-net", "ethereum", "solana"] as const;

export async function GET() {
  const generatedAt = new Date().toISOString();

  // ---- 1. networks (eco probes, TTL-cached upstream) — health must survive
  // a probe blowup, not 500 with it ------------------------------------------
  const t0 = Date.now();
  let networks: Awaited<ReturnType<typeof ecoNetworks>> | { ok: false; error: string };
  try {
    networks = await withCache("health:networks", 15_000, () => ecoNetworks());
  } catch (e) {
    networks = { ok: false, error: e instanceof Error ? e.message : "eco networks probe failed" };
  }
  const networksLatencyMs = Date.now() - t0;

  // ---- 2. bridges (rail statuses + analytics over live state) --------------
  const t1 = Date.now();
  let rails: ReturnType<typeof railStatuses> = [];
  let analytics: ReturnType<typeof bridgeAnalytics> | null = null;
  let bridgeError: string | null = null;
  try {
    const [anchors, saosnet] = await Promise.all([ecoAnchors(), saosNetSnapshot()]);
    const chains = networks.ok ? networks.chains.map((c) => ({ id: c.id, status: c.status, note: c.note })) : [];
    rails = railStatuses({ anchors, saosnet, chains });
    analytics = bridgeAnalytics({ anchors, saosnet, chains });
  } catch (e) {
    bridgeError = e instanceof Error ? e.message : String(e);
  }
  const bridgeLatencyMs = Date.now() - t1;

  // ---- 2b. live router quotes for the two direct rails ---------------------
  const t2 = Date.now();
  const quote = async (from: string, to: string) => {
    try {
      const paths = await findPaths({ source: from as Parameters<typeof findPaths>[0]["source"], target: to as Parameters<typeof findPaths>[0]["target"], asset: "STEEM", amount: "1" });
      const direct = paths[0];
      if (!direct) return { from, to, readiness: "unavailable", gateReason: "router returned no path", fee: null as Array<{ network: string; amount: string; currency: string }> | null, estimatedTime: null as number | null };
      return {
        from,
        to,
        readiness: direct.readiness,
        gateReason: direct.readiness === "gated" ? (direct.gateReason ?? "gated") : null,
        estimatedTime: direct.estimatedTime,
        fee: direct.fee.legs.map((l) => ({ network: l.network, amount: l.amount, currency: l.currency })),
      };
    } catch (e) {
      return { from, to, readiness: "probe-failed", gateReason: e instanceof Error ? e.message : String(e), fee: null as Array<{ network: string; amount: string; currency: string }> | null, estimatedTime: null as number | null };
    }
  };
  const [routeSteemEth, routeSteemSol] = await Promise.all([quote("steem", "ethereum"), quote("steem", "solana")]);
  const routesLatencyMs = Date.now() - t2;

  // ---- 3. vault (secret-free status) ---------------------------------------
  const t3 = Date.now();
  let vault: Record<string, unknown>;
  try {
    const rt = getVaultRuntime();
    await rt.ready;
    const s = await rt.vault.getStatus();
    vault = {
      reachable: true,
      initialized: s.initialized,
      locked: s.locked,
      networks: s.counts.networks,
      soldiers: s.counts.soldiers,
      securityScore: s.securityScore,
      auditIntegrityOk: s.auditIntegrityOk,
      findings: s.securityFindings,
    };
  } catch (e) {
    vault = { reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
  const vaultLatencyMs = Date.now() - t3;

  // ---- 4. DEX (live STEEM/SBD internal market) -----------------------------
  const t4 = Date.now();
  let dex: Record<string, unknown>;
  try {
    const market = steemMarket();
    const [ticker, book, chainStatus] = await Promise.all([market.ticker(), market.orderBook(50), market.chainStatus()]);
    const bestBid = book.bids[0]?.priceNum ?? null;
    const bestAsk = book.asks[0]?.priceNum ?? null;
    const spreadPercent =
      bestBid !== null && bestAsk !== null && bestAsk > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : null;
    dex = {
      reachable: true,
      bids: book.bids.length,
      asks: book.asks.length,
      latest: ticker.latest,
      spreadPercent,
      headBlock: chainStatus.headBlock,
      lagSeconds: chainStatus.lagSeconds,
    };
  } catch (e) {
    dex = { reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
  const dexLatencyMs = Date.now() - t4;

  // ---- 5. issues — computed from the measurements above (honest) -----------
  const issues: HealthIssue[] = [];
  if (networks.ok) {
    for (const c of networks.chains) {
      if (c.status === "offline") {
        issues.push({
          component: `network:${c.id}`,
          severity: "critical",
          detail: `probe offline — ${c.note}`,
          action: "failover to the next endpoint in the adapter's endpoint book (automatic on next probe)",
        });
      } else if (typeof c.lagSeconds === "number" && c.lagSeconds > 30) {
        issues.push({
          component: `network:${c.id}`,
          severity: "warning",
          detail: `head lag ${c.lagSeconds}s exceeds 30s`,
          action: "re-probe; if persistent, failover RPC",
        });
      }
    }
  } else {
    issues.push({
      component: "networks",
      severity: "critical",
      detail: "eco probe layer failed",
      action: "check outbound connectivity",
    });
  }
  if (bridgeError) {
    issues.push({
      component: "bridges",
      severity: "warning",
      detail: `monitor composition failed: ${bridgeError}`,
      action: "re-probe SAOS-NET state feed (GitHub-backed)",
    });
  }
  for (const r of rails) {
    if (r.status === "gated") {
      issues.push({
        component: `bridge:${r.id}`,
        severity: "notice",
        detail: `${r.rail} gated — ${r.evidence}`,
        action: "resume/undeploy per rail gate (honest state, no fabrication)",
      });
    }
  }
  for (const q of [routeSteemEth, routeSteemSol]) {
    if (q.readiness === "gated") {
      issues.push({
        component: `route:${q.from}->${q.to}`,
        severity: "notice",
        detail: String(q.gateReason),
        action: "deploy the bridge contract/program on the target chain",
      });
    }
  }
  if (vault.reachable === true) {
    if (vault.initialized === false) {
      issues.push({
        component: "vault",
        severity: "notice",
        detail: "vault not initialized — first-boot ceremony pending (clean handoff state)",
        action: "run the VAULT tab setup wizard",
      });
    } else if (vault.locked === true) {
      issues.push({
        component: "vault",
        severity: "notice",
        detail: "vault initialized but locked",
        action: "unlock to sign",
      });
    }
    if (vault.auditIntegrityOk === false) {
      issues.push({
        component: "vault:audit",
        severity: "critical",
        detail: "audit chain integrity check FAILED",
        action: "run audit report, investigate tamper window immediately",
      });
    }
  } else {
    issues.push({
      component: "vault",
      severity: "critical",
      detail: `engine unreachable: ${String(vault.error)}`,
      action: "restart the dev server / inspect runtime singleton",
    });
  }
  if (dex.reachable === false) {
    issues.push({
      component: "dex",
      severity: "critical",
      detail: `internal market probe failed: ${String(dex.error)}`,
      action: "failover to the next Steem endpoint book entry",
    });
  }

  const upChains = networks.ok ? networks.chains.filter((c) => c.status === "online").length : 0;
  const liveRails = rails.filter((r) => r.status === "live").length;
  const gatedRails = rails.filter((r) => r.status === "gated").length;

  const body = {
    ok: true as const,
    generatedAt,
    summary: {
      networksUp: `${upChains}/${ALL_NETWORKS.length}`,
      liveRails,
      gatedRails,
      criticalIssues: issues.filter((i) => i.severity === "critical").length,
    },
    checks: {
      networks: {
        latencyMs: networksLatencyMs,
        chains: networks.ok ? networks.chains : null,
        error: networks.ok ? null : networks.error,
      },
      bridges: {
        latencyMs: bridgeLatencyMs,
        rails,
        analytics,
        routes: { steemEthereum: routeSteemEth, steemSolana: routeSteemSol },
        routesLatencyMs,
        error: bridgeError,
      },
      vault: { latencyMs: vaultLatencyMs, ...vault },
      dex: { latencyMs: dexLatencyMs, ...dex },
    },
    issues,
    selfHealing: {
      rpcFailover: "adapters hold ordered endpoint books; a failed probe advances to the next endpoint automatically",
      vault: "fail-closed everywhere: locked/missing-key/policy-deny all block signing; audit chain is tamper-evident",
      broadcast: "broadcast is capability-gated per adapter — disabled by default, never enabled implicitly",
      stateAgePolicy: "SAOS-NET state age is surfaced (stateAgeSeconds) and degrades honestly — never hidden",
    },
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
