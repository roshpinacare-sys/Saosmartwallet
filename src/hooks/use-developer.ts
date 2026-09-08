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

/* ── Admin gate (console MUTATIONS are admin-gated server-side) ─────────── */

const ADMIN_TOKEN_STORAGE_KEY = "saos_admin_token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
}

export function setAdminToken(token: string): void {
  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
}

export function clearAdminToken(): void {
  window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}

export interface AdminBootstrapResponse {
  ok: boolean;
  created: boolean;
  token?: string;
  exists?: boolean;
  source?: "env" | "db";
  note?: string;
  warning?: string;
  error?: string;
}

export function useAdminBootstrap() {
  return useMutation<AdminBootstrapResponse, Error, void>({
    mutationFn: async () => {
      const res = await fetch("/api/developer/admin/bootstrap", { method: "POST" });
      const j = (await res.json()) as AdminBootstrapResponse;
      if (!res.ok && !j.error) throw new Error(`bootstrap ${res.status}`);
      return j;
    },
  });
}

/** Auth header for admin-gated console mutations (omitted when unauthenticated). */
function adminAuthHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** True when the server rejected console credentials — clears the stale token. */
function isAdminRejection(status: number, body: unknown): boolean {
  const err = (body as { error?: string } | null)?.error;
  return status === 401 && (err ?? "").startsWith("admin authorization failed");
}

export function useCreateKey() {
  const qc = useQueryClient();
  return useMutation<CreateKeyResponse, Error, string>({
    mutationFn: async (name) => {
      const res = await fetch("/api/developer/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ name }),
      });
      const j = (await res.json()) as CreateKeyResponse;
      if (isAdminRejection(res.status, j)) {
        clearAdminToken();
        throw new Error("admin token required — authenticate the console to mint keys");
      }
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
      const res = await fetch(`/api/developer/keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: adminAuthHeaders(),
      });
      const j = (await res.json()) as { ok: boolean; revoked: string; error?: string };
      if (isAdminRejection(res.status, j)) {
        clearAdminToken();
        throw new Error("admin token required — authenticate the console to revoke keys");
      }
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
