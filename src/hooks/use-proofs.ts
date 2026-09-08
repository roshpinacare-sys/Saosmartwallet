"use client";

/**
 * use-proofs.ts — hooks for the PROOFS lab (3 live demos).
 * Demo 1: identity-anchor verification (POST, on demand)
 * Demo 2: grid98 live benchmark (POST, on demand — spawns the real engine)
 * Demo 3: soldier fleet status (GET, polled every 10s)
 */

import { useMutation, useQuery } from "@tanstack/react-query";

export interface AnchorChainRow {
  chain: "steem" | "hive" | "blurt";
  activePub: string | null;
  sameKeyAsSteem: boolean | null;
  note?: string;
}

export interface AnchorVerifyResponse {
  ok: boolean;
  username: string;
  measuredAt: string;
  error?: string;
  anchor?: {
    trxId: string;
    block: number;
    timestamp: string;
    explorer: string;
    protocol?: string;
    action?: string;
    anchoredAt?: string;
    claimedEvm: string | null;
    chainsClaimed: string[];
    msg: string | null;
    sig: string | null;
  };
  verify?: {
    eip191DigestHex: string;
    recoveredEvm: string;
    claimedMatchesRecovered: boolean;
    activeKeyPub: string;
    activeKeyEvmAddress: string;
    activeKeyEqualsRecovered: boolean;
    sameScalarProof: boolean;
    scanned: number;
  };
  chains?: AnchorChainRow[];
  summary?: string;
}

export interface FleetOp {
  time: string;
  type: string;
  summary: string;
  trxId: string;
  ageMinutes: number;
}

export interface FleetSoldier {
  name: string;
  role: string;
  scopes: string[];
  sp: number | null;
  vpPct: number | null;
  rcPct: number | null;
  created: string | null;
  lastActivity: { time: string; type: string; summary: string; trxId: string; ageMinutes: number } | null;
  recentOps: FleetOp[];
  isOnline: boolean | null;
  note?: string;
}

export interface FleetStatusResponse {
  ok: boolean;
  measuredAt: string;
  error?: string;
  total: number;
  online: number;
  statusLine: string;
  soldiers: FleetSoldier[];
  liveAccounts: number;
  probeError?: string;
}

export interface Grid98BenchResponse {
  ok: boolean;
  measuredAt: string;
  error?: string;
  run: {
    at: string | null;
    ms: number | null;
    txs: number | null;
    txsPerSec: number | null;
    capabilityPerDay: number | null;
    passes: number | null;
    note: string | null;
  } | null;
  gates: {
    skippedForEdge: number | null;
    rejected: number | null;
    edgeLeak: number | null;
    treasuryPnlMicro: number | null;
    floorSteps: Array<{ at: string; floor: number; backedByMicro: number }>;
  };
  provenance: {
    engineFile: string;
    archiveFile: string | null;
    archiveBytes: number | null;
    benchMode: string;
  };
  references: Array<{ name: string; tps: string; source: string }>;
  runLog?: string[];
}

export function useSaosFleetStatus() {
  return useQuery<FleetStatusResponse>({
    queryKey: ["saos-fleet-status"],
    queryFn: async () => {
      const res = await fetch("/api/saos/fleet-status", { cache: "no-store" });
      if (!res.ok) throw new Error(`fleet-status ${res.status}`);
      return (await res.json()) as FleetStatusResponse;
    },
    refetchInterval: 10_000, // the demo breathes every 10s
    placeholderData: (prev) => prev,
  });
}

export function useSaosAnchorVerify() {
  return useMutation<AnchorVerifyResponse, Error, string | undefined>({
    mutationFn: async (username) => {
      const res = await fetch("/api/saos/anchor-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const j = (await res.json()) as AnchorVerifyResponse;
      if (!res.ok) throw new Error(j.error ?? `anchor-verify ${res.status}`);
      return j;
    },
  });
}

export function useSaosGrid98Bench() {
  return useMutation<Grid98BenchResponse, Error, number | undefined>({
    mutationFn: async (benchMs) => {
      const res = await fetch("/api/saos/grid98-bench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benchMs }),
      });
      const j = (await res.json()) as Grid98BenchResponse;
      if (!res.ok) throw new Error(j.error ?? `grid98-bench ${res.status}`);
      return j;
    },
  });
}
