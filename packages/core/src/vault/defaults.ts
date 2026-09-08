/**
 * Saosmartwallet — default vault state & policy data (M2, layer 1)
 * ================================================================
 * PURE DATA + PURE FUNCTIONS ONLY in this module.
 *
 * The policy rule set below is the DEFAULT RULE DATA the M2 spec ships with.
 * It deliberately contains no evaluation logic: the policy engine (layer 3)
 * receives rules as arguments, so defaults must be plain serializable data
 * that can live inside the vault state document, be exported in backups and
 * be diffed in UI settings screens.
 */

import type { PolicyRuleSet, VaultStateDoc } from "../types";

/**
 * The M2 default policy rule set (dynamic / contextual / composite).
 * Amounts are satoshi strings — the policy engine parses them with
 * `parseSats` at evaluation time, never at rest.
 */
export function defaultPolicyRuleSet(): PolicyRuleSet {
  return {
    dynamic: [
      {
        id: "deny-huge-transfer",
        name: "Deny huge transfers",
        enabled: true,
        amountThreshold: {
          STEEM: "50000000",
          SBD: "50000000",
          TRX: "500000000000",
          HIVE: "50000000",
          BLURT: "50000000",
          ETH: "5000000000000000000", // 5 ETH (wei)
          SOL: "50000000000", // 50 SOL (lamports)
        },
      },
      {
        id: "approve-large-transfer",
        name: "Approval for large transfers",
        enabled: true,
        amountThreshold: {
          STEEM: "5000000",
          SBD: "5000000",
          TRX: "50000000000",
          HIVE: "5000000",
          BLURT: "5000000",
          ETH: "500000000000000000", // 0.5 ETH (wei)
          SOL: "5000000000", // 5 SOL (lamports)
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
        name: "Max 60 operations/hour",
        enabled: true,
        maxOperationsPerHour: 60,
        action: "require_approval",
      },
      {
        id: "new-counterparty-cooldown",
        name: "24h new-counterparty cooldown",
        enabled: true,
        newActionCooldownHours: 24,
        action: "require_approval",
      },
    ],
    composite: [
      {
        id: "high-risk-any",
        name: "High-risk combination",
        enabled: true,
        operator: "any",
        refs: ["deny-huge-transfer", "rate-limit-hourly"],
        action: "require_approval",
      },
    ],
  };
}

/** Server default: auto-lock an unlocked session after 5 idle minutes. */
export const DEFAULT_AUTO_LOCK_SECONDS = 300;

/**
 * Builds the blank state document for a fresh vault instance. `initialized`
 * stays false until SovereignVault.initialize() installs a password verifier
 * and the full vault ecosystem — an empty doc can never be unlocked.
 */
export function emptyState(vaultInstanceId: string): VaultStateDoc {
  const now = Date.now();
  return {
    docVersion: 1,
    vaultInstanceId,
    initialized: false,
    createdAt: now,
    updatedAt: now,
    verifier: null,
    zkCommitment: null,
    master: null,
    networks: {},
    soldiers: {},
    purposes: {},
    keys: {},
    policies: defaultPolicyRuleSet(),
    backup: {
      lastBackupAt: null,
      lastBackupChecksum: null,
      sharding: null,
      socialRecovery: null,
      deadManSwitch: null,
    },
    autoLockSeconds: DEFAULT_AUTO_LOCK_SECONDS,
  };
}
