/**
 * Saosmartwallet — audit layer barrel (layer 6).
 *
 * Consumers: `import { AuditSystem, renderPdfReport } from
 * "…/packages/core/src/audit"`. All shared types live in `../types`; the
 * `AuditStore` seam lives in `../storage/types`.
 */

export { AuditSystem } from "./audit";
export type { AuditSystemOptions, LogAuditInput, AuditIntegrityResult } from "./audit";
export { renderPdfReport } from "./pdf";
