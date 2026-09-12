/**
 * AxiomState — deterministic code intelligence for the network.
 * Integrated from user's prior project (AxiomState Phase 2, MIT-granted personal work).
 *
 * - phase0: LSS kernel — immutable WAL, checkpoints, CRC-32 integrity.
 * - phase1: AST graph (TS provider + regex fallback), loader & traversal.
 * - phase2: incremental sync (SHA-256), exact query DSL, deterministic bundles.
 */
export * from './phase0/kernel';
export * from './phase1/types';
export * from './phase1/ids';
export * from './phase1/project-parser';
export * from './phase1/writer';
export * from './phase1/loader';
export * from './phase1/traversal';
export * from './phase2/types';
export * from './phase2/query';
export * from './phase2/incremental';
export * from './phase2/bundle';
