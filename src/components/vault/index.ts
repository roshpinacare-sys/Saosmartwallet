/**
 * Sovereign Key Vault UI — barrel (M2, task 4-b).
 * Data layer: /src/hooks/use-vault.ts (queries + mutations against the frozen
 * /api/vault/* contracts in src/lib/vault-contracts.ts).
 */

export { VaultStatusWidget } from "./vault-status-widget";
export { VaultSetupWizard } from "./vault-setup-wizard";
export { SigningDialog } from "./signing-dialog";
export { PolicyManagementDialog } from "./policy-management-dialog";
export { BackupRecoveryDialog } from "./backup-recovery-dialog";
export { AuditPanel } from "./audit-panel";
export { VaultConsole } from "./vault-console";
