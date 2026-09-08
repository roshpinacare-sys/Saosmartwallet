"use client";

/**
 * use-developer.ts — hooks for the DEVELOPER console (Model 1 metered API).
 * keys list (polled) · create/revoke (mutations) · metered product verify ·
 * usage analytics (polled) — zero mock, every value from the real endpoints.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  callsToday: number;
  callsTotal: number;
}

export interface CreateKeyResponse {
  ok: boolean;
  key: string;
  created: { id: string; name: string; prefix: string; createdAt: string };
  warning: string;
}

export interface MeteredVerifyResponse {
  ok: boolean;
  username: string;
  measuredAt: string;
  error?: string;
  anchor?: {
    trxId: string;
    block: number;
    timestamp: string;
    explorer: string;
    claimedEvm: string | null;
  };
  verify?: {
    recoveredEvm: string;
    claimedMatchesRecovered: boolean;
    activeKeyPub: string;
    sameScalarProof: boolean;
    scanned: number;
  };
  chains?: Array<{ chain: string; sameKeyAsSteem: boolean | null; activePub: string | null; note?: string }>;
  summary?: string;
  meta?: {
    endpoint: string;
    keyPrefix: string;
    outcome: "PROVEN" | "FAILED" | "ERROR";
    latencyMs: number;
    quota: { used: number; limit: number; remaining: number; resetAt: number };
    plan: { tier: string; dailyCalls: number };
  };
}

export interface UsageResponse {
  ok: boolean;
  totals: { apiKeys: number; callsAllTime: number; callsToday: number };
  last24h: { total: number; proven: number; failed: number; errored: number; avgLatencyMs: number };
  series: Array<{ utcHour: string; calls: number }>;
}

export function useApiKeys() {
  return useQuery<{ ok: boolean; keys: ApiKeyRow[] }>({
    queryKey: ["developer-keys"],
    queryFn: async () => {
      const res = await fetch("/api/developer/keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`keys ${res.status}`);
      return (await res.json()) as { ok: boolean; keys: ApiKeyRow[] };
    },
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useCreateKey() {
  const qc = useQueryClient();
  return useMutation<CreateKeyResponse, Error, string>({
    mutationFn: async (name) => {
      const res = await fetch("/api/developer/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = (await res.json()) as CreateKeyResponse;
      if (!res.ok) throw new Error("key creation failed");
      return j;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["developer-keys"] }),
  });
}

export function useRevokeKey() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; revoked: string }, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/developer/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = (await res.json()) as { ok: boolean; revoked: string };
      if (!res.ok) throw new Error("revoke failed");
      return j;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["developer-keys"] }),
  });
}

export function useMeteredVerify() {
  return useMutation<MeteredVerifyResponse, Error, { key: string; username: string }>({
    mutationFn: async ({ key, username }) => {
      const res = await fetch("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.trim()}` },
        body: JSON.stringify({ username }),
      });
      const j = (await res.json()) as MeteredVerifyResponse;
      if (!res.ok && !j.error) throw new Error(`verify ${res.status}`);
      return j;
    },
  });
}

export function useUsage() {
  return useQuery<UsageResponse>({
    queryKey: ["developer-usage"],
    queryFn: async () => {
      const res = await fetch("/api/developer/usage", { cache: "no-store" });
      if (!res.ok) throw new Error(`usage ${res.status}`);
      return (await res.json()) as UsageResponse;
    },
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
}
