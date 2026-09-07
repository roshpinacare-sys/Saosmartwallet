/**
 * Saosmartwallet — backup layer barrel (M2, layer 5).
 *
 * Consumers: `import { BackupManager } from "…/packages/core/src/backup"`.
 * Shared vocabulary (BackupPackage, RecoveryContact, DeadManConfig,
 * RecoverySession, Share) lives in `../types` and is re-exported here;
 * the social-recovery envelope (SocialRecoverySetup) is defined in
 * backup/backup.ts because types.ts is frozen.
 */

export {
  BackupManager,
  type BackupCreateOptions,
  type BackupManagerDeps,
  type SocialRecoverySetup,
} from "./backup";

export type {
  BackupPackage,
  Beneficiary,
  DeadManConfig,
  RecoveryContact,
  RecoverySession,
  Share,
} from "../types";
