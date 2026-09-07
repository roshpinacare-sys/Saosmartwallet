/**
 * Saosmartwallet — compiled-in static policy rules + the M2 default rule set
 * ===========================================================================
 * Layer 3 (policy) of the Sovereign Key Vault.
 *
 * Two exports:
 *   - {@link STATIC_RULES} — six compiled-in rules that CANNOT be disabled by
 *     vault configuration. They pass, fail (deny), or demand step-up.
 *   - {@link defaultRuleSet} — the default dynamic/contextual/composite rule
 *     sets persisted into `VaultStateDoc.policies` at vault creation. These are
 *     DATA: operators may enable/disable/edit them; the engine never hardcodes
 *     them.
 *
 * ## Config-injection contract (`op.detail`)
 * Static rules are parameterless by design so they can never be weakened
 * through configuration. Per-vault tuning travels inside `op.detail` under
 * these reserved keys, injected by the signing orchestrator from the vault
 * state document:
 *
 *   - `allowedOperations?: string[]`             → rule `operation-allowlist`
 *   - `dailyLimitSatoshis?: string`              → rule `daily-limit` (decimal satoshi string)
 *   - `spentTodaySatoshis?: string`              → rule `daily-limit` (decimal satoshi string)
 *   - `soldierPermissions?: SoldierPermissions`  → rule `soldier-permissions`
 *
 * Keys are read defensively: absent configuration PASSES at this layer, while
 * malformed security-critical values (spend limits, transfer caps) FAIL CLOSED.
 */

import { parseSats } from "../encoding";
import type { PolicyRuleSet, SoldierPermissions, StaticRule } from "../types";

// ---------------------------------------------------------------------------
// Shared display helper
// ---------------------------------------------------------------------------

/**
 * Format a satoshi string/bigint with thousands separators for human-readable
 * policy reasons, e.g. 6000000 → "6,000,000". Non-numeric input passes through
 * untouched (the grouping regex simply does not match).
 */
export function formatSats(v: bigint | string): string {
  const digits = typeof v === "bigint" ? v.toString() : v;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ---------------------------------------------------------------------------
// Static rules — compiled in, cannot be disabled
// ---------------------------------------------------------------------------

/** Operation types that move funds or custody and therefore need active/owner authority. */
const SENSITIVE_TRANSFER_TYPES: readonly string[] = [
  "transfer",
  "transfer_to_vesting",
  "delegate_vesting_shares",
];

const noTransferWithPostingKey: StaticRule = {
  id: "no-transfer-with-posting-key",
  name: "No transfers with posting key",
  description:
    "Financial operations (transfer, transfer_to_vesting, delegate_vesting_shares) must be signed " +
    "with the active key; the owner key is accepted but triggers step-up authentication.",
  evaluate: (op, _ctx) => {
    if (!SENSITIVE_TRANSFER_TYPES.includes(op.type)) {
      return { pass: true, reason: `Key role ${op.role ?? "none"} is acceptable for ${op.type}.` };
    }
    if (op.role === "active") {
      return { pass: true, reason: `Active key authorized for ${op.type}.` };
    }
    if (op.role === "owner") {
      return {
        pass: true,
        reason: `Owner key accepted for ${op.type} — step-up authentication is required by the owner-key policy.`,
      };
    }
    if (op.role === "posting") {
      return {
        pass: false,
        action: "deny",
        reason: `Posting keys cannot authorize ${op.type} — sign with the active key (the owner key with step-up is also accepted).`,
      };
    }
    if (op.role === "memo") {
      return {
        pass: false,
        action: "deny",
        reason: `Memo keys cannot authorize ${op.type} — sign with the active key.`,
      };
    }
    return {
      pass: false,
      action: "deny",
      reason: `No key role provided — ${op.type} requires the active key (or the owner key with step-up authentication).`,
    };
  },
};

const memoKeyCannotSign: StaticRule = {
  id: "memo-key-cannot-sign",
  name: "Memo keys cannot sign",
  description:
    "The memo key exists solely for encrypted memo exchange and can never authorize any operation.",
  evaluate: (op, _ctx) =>
    op.role === "memo"
      ? {
          pass: false,
          action: "deny",
          reason: `Memo keys are used for message encryption only — they cannot sign ${op.type}.`,
        }
      : { pass: true, reason: `Key role ${op.role ?? "none"} is not the memo key.` },
};

/** Reads an unknown value as a string[]; null when absent-of-array or mixed/invalid. */
function readStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr: unknown[] = v;
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

const operationAllowlist: StaticRule = {
  id: "operation-allowlist",
  name: "Operation allowlist",
  description:
    "When the operation detail carries allowedOperations, only listed operation types may be signed. " +
    "Missing/malformed config passes here (fail-open at this layer); the orchestrator fail-closes on " +
    "missing vault-level configuration.",
  evaluate: (op, _ctx) => {
    const raw = op.detail?.allowedOperations;
    if (raw === undefined) {
      return { pass: true, reason: "No operation allowlist configured — rule passes at the policy layer." };
    }
    const allowed = readStringArray(raw);
    if (allowed === null) {
      return {
        pass: true,
        reason:
          "Operation allowlist configuration is malformed — ignored at the policy layer " +
          "(the orchestrator enforces fail-closed configuration).",
      };
    }
    return allowed.some((t) => t === op.type)
      ? { pass: true, reason: `Operation ${op.type} is on the vault allowlist.` }
      : {
          pass: false,
          action: "deny",
          reason: `Operation ${op.type} is not on this vault's allowlist (allowed: ${allowed.join(", ")}).`,
        };
  },
};

const dailyLimit: StaticRule = {
  id: "daily-limit",
  name: "Daily spend limit",
  description:
    "Enforces detail.dailyLimitSatoshis against detail.spentTodaySatoshis + the operation amount " +
    "(bigint satoshi math). Missing limit config passes; malformed values fail closed.",
  evaluate: (op, _ctx) => {
    const limitRaw = op.detail?.dailyLimitSatoshis;
    if (typeof limitRaw !== "string") {
      return { pass: true, reason: "No daily spend limit configured." };
    }
    const spentRaw = op.detail?.spentTodaySatoshis;
    const spentStr = typeof spentRaw === "string" ? spentRaw : "0";
    let limit: bigint;
    let spent: bigint;
    let amount: bigint;
    try {
      limit = parseSats(limitRaw);
      spent = parseSats(spentStr);
      amount = parseSats(op.amountSatoshis);
    } catch {
      return {
        pass: false,
        action: "deny",
        reason: "Daily-limit configuration or operation amount is malformed — failing closed.",
      };
    }
    const projected = spent + amount;
    if (projected <= limit) {
      return {
        pass: true,
        reason: `Daily spend ${formatSats(spent)} + ${formatSats(amount)} satoshis is within the ${formatSats(limit)} satoshi cap for ${op.symbol}.`,
      };
    }
    return {
      pass: false,
      action: "deny",
      reason: `Daily cap exceeded for ${op.symbol}: ${formatSats(spent)} satoshis spent today + ${formatSats(amount)} requested would pass the ${formatSats(limit)} satoshi daily limit.`,
    };
  },
};

const ownerKeyStepUp: StaticRule = {
  id: "owner-key-step-up",
  name: "Owner key step-up",
  description:
    "Signing with the owner key is allowed but always demands step-up authentication " +
    "(password re-entry) before the operation proceeds.",
  evaluate: (op, _ctx) =>
    op.role === "owner"
      ? {
          pass: true,
          action: "step_up_auth",
          reason: "Owner key in use — step-up authentication (password re-entry) is required before signing.",
        }
      : {
          pass: true,
          reason: `Not an owner-key request (role: ${op.role ?? "none"}) — no step-up demanded by this rule.`,
        },
};

/** Permissive-less permissions used when soldierPermissions is present but malformed (fail-closed). */
const NO_PERMISSIONS: SoldierPermissions = {
  canTrade: false,
  canVote: false,
  canComment: false,
  canTransfer: false,
  maxTransferAmount: "0",
};

/** Coerces an unknown detail value into SoldierPermissions; anything malformed collapses to NO_PERMISSIONS. */
function coerceSoldierPermissions(v: unknown): SoldierPermissions {
  if (typeof v !== "object" || v === null) return NO_PERMISSIONS;
  const o = v as Record<string, unknown>;
  return {
    canTrade: o.canTrade === true,
    canVote: o.canVote === true,
    canComment: o.canComment === true,
    canTransfer: o.canTransfer === true,
    maxTransferAmount: typeof o.maxTransferAmount === "string" ? o.maxTransferAmount : "0",
  };
}

interface SoldierCapability {
  key: "canTrade" | "canVote" | "canComment" | "canTransfer";
  label: string;
}

/** Maps an operation type to the soldier capability that governs it (null = no capability bound). */
function soldierCapability(opType: string): SoldierCapability | null {
  if (/^limit_order/.test(opType)) return { key: "canTrade", label: "trading (limit orders)" };
  if (opType === "vote" || opType === "witness_vote") return { key: "canVote", label: "governance voting" };
  if (/^comment/.test(opType)) return { key: "canComment", label: "commenting" };
  if (/^transfer/.test(opType)) return { key: "canTransfer", label: "transfers" };
  return null;
}

const soldierPermissions: StaticRule = {
  id: "soldier-permissions",
  name: "Soldier permissions",
  description:
    "When the operation detail carries soldierPermissions, the operation type is mapped to a " +
    "capability (limit_order_* → canTrade, vote/witness_vote → canVote, comment → canComment, " +
    "transfer* → canTransfer + amount ≤ maxTransferAmount) and denied when the capability is off.",
  evaluate: (op, _ctx) => {
    const raw = op.detail?.soldierPermissions;
    if (raw === undefined) {
      return { pass: true, reason: "No soldier permission constraints attached to this operation." };
    }
    const perms = coerceSoldierPermissions(raw);
    const cap = soldierCapability(op.type);
    if (cap === null) {
      return { pass: true, reason: `No soldier capability is bound to ${op.type} — permission rule not applicable.` };
    }
    if (!perms[cap.key]) {
      return {
        pass: false,
        action: "deny",
        reason: `This soldier vault is not permitted to perform ${cap.label} (${cap.key} is disabled).`,
      };
    }
    if (cap.key === "canTransfer") {
      let amount: bigint;
      let max: bigint;
      try {
        amount = parseSats(op.amountSatoshis);
        max = parseSats(perms.maxTransferAmount);
      } catch {
        return {
          pass: false,
          action: "deny",
          reason: "Soldier transfer-cap configuration or amount is malformed — failing closed.",
        };
      }
      if (amount > max) {
        return {
          pass: false,
          action: "deny",
          reason: `Transfer of ${formatSats(amount)} satoshis exceeds this soldier's ${formatSats(max)} satoshi transfer cap.`,
        };
      }
      return {
        pass: true,
        reason: `Soldier transfer of ${formatSats(amount)} satoshis is within the ${formatSats(max)} satoshi cap.`,
      };
    }
    return { pass: true, reason: `Soldier permission granted for ${cap.label}.` };
  },
};

/**
 * The compiled-in static rule set, in evaluation order. These instances are
 * frozen by convention (they live in code, not state) — the engine runs every
 * one of them on every evaluation and merges their outcomes.
 */
export const STATIC_RULES: StaticRule[] = [
  noTransferWithPostingKey,
  memoKeyCannotSign,
  operationAllowlist,
  dailyLimit,
  ownerKeyStepUp,
  soldierPermissions,
];

// ---------------------------------------------------------------------------
// Default dynamic / contextual / composite rule sets (as data)
// ---------------------------------------------------------------------------

/**
 * The M2 default `PolicyRuleSet` — the starting point persisted into the vault
 * state document. Semantics are enforced by `PolicyEngine` (see engine.ts):
 *
 * **Dynamic**
 * - `deny-huge-transfer` — hard-denies operations whose amount (satoshi
 *   string) exceeds the per-symbol threshold: 50,000 STEEM/HIVE/BLURT (50,000,000
 *   satoshis at precision 3) and 500,000 TRX (500,000,000,000 satoshis at
 *   precision 6). Symbols without a threshold entry are skipped.
 * - `approve-large-transfer` — amounts above 5,000 STEEM/SBD/HIVE/BLURT
 *   (5,000,000 satoshis) / 50,000 TRX (50,000,000,000 satoshis) trigger
 *   `requireApprovalCount: 1` → one additional master-vault approval. The TRX
 *   entry extends the spec's `{STEEM:"5000000",...}` pattern at the same 10:1
 *   ratio as the deny threshold.
 * - `step-up-account-update` — account_update / trigger_smart_contract always
 *   demand step-up authentication.
 *
 * **Contextual**
 * - `rate-limit-hourly` — more than 60 operations in the trailing hour
 *   (including this one) → require_approval.
 * - `new-counterparty-cooldown` — a first-seen counterparty (not typical, no
 *   successful history) → require_approval for 24h-worth of unfamiliarity.
 *
 * **Composite**
 * - `high-risk-any` — any triggered reference among
 *   [deny-huge-transfer, rate-limit-hourly] escalates to require_approval
 *   (belt-and-braces on top of the individual rule actions).
 */
export function defaultRuleSet(): PolicyRuleSet {
  return {
    dynamic: [
      {
        id: "deny-huge-transfer",
        name: "Deny huge transfers",
        enabled: true,
        amountThreshold: {
          STEEM: "50000000",
          SBD: "50000000",
          HIVE: "50000000",
          BLURT: "50000000",
          TRX: "500000000000",
        },
      },
      {
        id: "approve-large-transfer",
        name: "Approve large transfers",
        enabled: true,
        amountThreshold: {
          STEEM: "5000000",
          SBD: "5000000",
          HIVE: "5000000",
          BLURT: "5000000",
          TRX: "50000000000",
        },
        requireApprovalCount: 1,
      },
      {
        id: "step-up-account-update",
        name: "Step-up for account updates",
        enabled: true,
        stepUpFor: ["account_update", "trigger_smart_contract"],
      },
    ],
    contextual: [
      {
        id: "rate-limit-hourly",
        name: "Hourly rate limit",
        enabled: true,
        maxOperationsPerHour: 60,
        action: "require_approval",
      },
      {
        id: "new-counterparty-cooldown",
        name: "New counterparty cooldown",
        enabled: true,
        newActionCooldownHours: 24,
        action: "require_approval",
      },
    ],
    composite: [
      {
        id: "high-risk-any",
        name: "High-risk composite",
        enabled: true,
        operator: "any",
        refs: ["deny-huge-transfer", "rate-limit-hourly"],
        action: "require_approval",
      },
    ],
  };
}
