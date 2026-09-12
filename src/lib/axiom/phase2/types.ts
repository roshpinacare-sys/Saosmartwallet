// ============================================================
// AxiomState Phase 2: Query & Execution Domain
// ============================================================

export const HASH_PREFIX = 'hash://';
export const SOURCE_PREFIX = 'source://';
export const FILE_INDEX_PREFIX = 'file-index://';

export interface FileIndex {
  readonly path: string;
  readonly nodeIds: string[];
  readonly edgeKeys: string[];
}

export interface SyncReport {
  readonly scanned: number;
  readonly changed: string[];
  readonly removed: string[];
  readonly unchanged: number;
}
