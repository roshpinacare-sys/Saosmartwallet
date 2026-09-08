"use client";

/**
 * Sovereign Key Vault — UI data layer (M2, task 4-b)
 * ==================================================
 * Every hook talks to the FROZEN /api/vault/* HTTP contracts in
 * src/lib/vault-contracts.ts. Relative URLs only. NO mock data: loading
 * states render skeletons, failures render honest errors with retry.
 *
 * ApiError carries the server's `error` message plus `code`/`decision`
 * (PolicyDecision) when present, so the signing dialog can render the
 * 403 policy-violation panel and the 423 locked notice inline.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  AuditReportResponse,
  AuditResponse,
  AuditVerifyResponse,
  CreateBackupRequest,
  CreateBackupResponse,
  DeadManRequest,
  DeadManResponse,
  ImportKeyRequest,
  ImportKeyResponse,
  InitRequest,
  InitResponse,
  KeyListResponse,
  LockResponse,
  PolicyResponse,
  RevokeKeyRequest,
  RevokeKeyResponse,
  RestoreBackupRequest,
  RestoreBackupResponse,
  SetupSocialRecoveryRequest,
  SetupSocialRecoveryResponse,
  SignCancelRequest,
  SignCancelResponse,
  SignOrderRequest,
  SignOrderResponse,
  SimulateOrderRequest,
  SimulateResponse,
  StatusResponse,
  UnlockRequest,
  UnlockResponse,
  UpdatePolicyRequest,
  UpdatePolicyResponse,
  UpsertNetworkRequest,
  UpsertNetworkResponse,
  UpsertSoldiersRequest,
  UpsertSoldiersResponse,
  VaultErrorCode,
  PolicyDecision,
} from "@/lib/vault-contracts";

// ---------------------------------------------------------------------------
// Error type + fetch helpers
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: VaultErrorCode,
    readonly decision?: PolicyDecision,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseBody<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON failure — fall through to the status error below */
  }
  const b = body as { ok?: unknown; error?: string; code?: VaultErrorCode; decision?: PolicyDecision } | null;
  if (!res.ok || !b || b.ok !== true) {
    throw new ApiError(
      (b && typeof b.error === "string" && b.error) || `request failed (${res.status})`,
      res.status,
      b?.code,
      b?.decision,
    );
  }
  return body as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return parseBody<T>(res);
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return parseBody<T>(res);
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return parseBody<T>(res);
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const VAULT_STATUS_KEY = ["vault", "status"] as const;
export const VAULT_KEYS_KEY = ["vault", "keys"] as const;
export const VAULT_POLICY_KEY = ["vault", "policy"] as const;

export interface VaultAuditFilters {
  type?: string;
  result?: "success" | "failure" | "blocked";
  limit?: number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useVaultStatus() {
  return useQuery({
    queryKey: VAULT_STATUS_KEY,
    queryFn: () => getJson<StatusResponse>("/api/vault/status"),
    refetchInterval: 15000,
    retry: 1,
  });
}

export function useVaultKeys() {
  return useQuery({
    queryKey: VAULT_KEYS_KEY,
    queryFn: () => getJson<KeyListResponse>("/api/vault/keys"),
    refetchInterval: 30000,
    retry: 1,
  });
}

export function useVaultPolicy() {
  return useQuery({
    queryKey: VAULT_POLICY_KEY,
    queryFn: () => getJson<PolicyResponse>("/api/vault/policy"),
    retry: 1,
  });
}

export function useVaultAudit(filters: VaultAuditFilters = {}) {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.result) params.set("result", filters.result);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ["vault", "audit", filters.type ?? "", filters.result ?? "", filters.limit ?? 0],
    queryFn: () => getJson<AuditResponse>(`/api/vault/audit${qs ? `?${qs}` : ""}`),
    refetchInterval: 10000,
    retry: 1,
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Mutation plumbing — every mutation toasts ApiError.message and refreshes
// the status snapshot; extra keys invalidated per mutation.
// ---------------------------------------------------------------------------

function useVaultMutation<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
  opts?: { extraInvalidate?: readonly (readonly string[])[] },
) {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: VAULT_STATUS_KEY });
      for (const key of opts?.extraInvalidate ?? []) {
        await qc.invalidateQueries({ queryKey: key });
      }
    },
    onError: (err) => {
      toast.error(err.message || "vault request failed", {
        description: err.code ? `code: ${err.code}` : undefined,
      });
    },
  });
}

export function useVaultInit() {
  return useVaultMutation<InitResponse, InitRequest>((vars) => postJson("/api/vault/init", vars));
}

export function useVaultUnlock() {
  return useVaultMutation<UnlockResponse, UnlockRequest>((vars) => postJson("/api/vault/unlock", vars));
}

export function useVaultLock() {
  return useVaultMutation<LockResponse, Record<string, never>>(() => postJson("/api/vault/lock", {}));
}

export function useVaultImportKeys() {
  return useVaultMutation<ImportKeyResponse, ImportKeyRequest>((vars) => postJson("/api/vault/keys", vars), {
    extraInvalidate: [VAULT_KEYS_KEY],
  });
}

export function useVaultRevokeKey() {
  return useVaultMutation<RevokeKeyResponse, RevokeKeyRequest>(({ keyId, password }) => {
    // DELETE with the id in the query string AND the step-up password in the body.
    return fetch(`/api/vault/keys?id=${encodeURIComponent(keyId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId, password }),
      cache: "no-store",
    }).then((res) => parseBody<RevokeKeyResponse>(res));
  }, { extraInvalidate: [VAULT_KEYS_KEY] });
}

export function useVaultUpsertNetworks() {
  return useVaultMutation<UpsertNetworkResponse, UpsertNetworkRequest>((vars) =>
    postJson("/api/vault/networks", vars),
  );
}

export function useVaultUpsertSoldiers() {
  return useVaultMutation<UpsertSoldiersResponse, UpsertSoldiersRequest>((vars) =>
    postJson("/api/vault/soldiers", vars),
  );
}

export function useVaultUpdatePolicy() {
  return useVaultMutation<UpdatePolicyResponse, UpdatePolicyRequest>(
    (vars) => putJson("/api/vault/policy", vars),
    { extraInvalidate: [VAULT_POLICY_KEY] },
  );
}

export function useVaultSimulate() {
  return useVaultMutation<SimulateResponse, SimulateOrderRequest>((vars) =>
    postJson("/api/vault/simulate", vars),
  );
}

export function useVaultSign() {
  return useVaultMutation<SignOrderResponse, SignOrderRequest>((vars) => postJson("/api/vault/sign", vars));
}

export function useVaultSignCancel() {
  return useVaultMutation<SignCancelResponse, SignCancelRequest>((vars) =>
    postJson("/api/vault/sign-cancel", vars),
  );
}

export function useVaultBackup() {
  return useVaultMutation<CreateBackupResponse, CreateBackupRequest>((vars) =>
    postJson("/api/vault/backup", vars),
  );
}

export function useVaultRestore() {
  return useVaultMutation<RestoreBackupResponse, RestoreBackupRequest>((vars) =>
    putJson("/api/vault/backup", vars),
  );
}

export function useVaultSocialRecovery() {
  return useVaultMutation<SetupSocialRecoveryResponse, SetupSocialRecoveryRequest>((vars) =>
    postJson("/api/vault/social-recovery", vars),
  );
}

export function useVaultDeadMan() {
  return useVaultMutation<DeadManResponse, DeadManRequest>((vars) => putJson("/api/vault/deadman", vars));
}

// ---------------------------------------------------------------------------
// Audit on-demand actions (verify walk + report downloads)
// ---------------------------------------------------------------------------

export async function fetchAuditVerify(): Promise<AuditVerifyResponse> {
  return getJson<AuditVerifyResponse>("/api/vault/audit?verify=1");
}

export async function fetchAuditReport(format: "json" | "csv" | "pdf"): Promise<AuditReportResponse> {
  return getJson<AuditReportResponse>(`/api/vault/audit?report=${format}`);
}

/** Client-side file download through a Blob URL (never persists anywhere). */
export function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Decodes an AuditReportResponse body into a downloadable Blob. */
export function auditReportBlob(format: "json" | "csv" | "pdf", body: string): Blob {
  if (format === "pdf") {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "application/pdf" });
  }
  if (format === "csv") return new Blob([body], { type: "text/csv" });
  return new Blob([body], { type: "application/json" });
}

// ---------------------------------------------------------------------------
// Display formatting (epoch-ms relative time, shared by widgets)
// ---------------------------------------------------------------------------

export function fmtRelMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtClockMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}
