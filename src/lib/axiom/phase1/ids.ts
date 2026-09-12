// ============================================================
// AxiomState Phase 1: Canonical Graph IDs
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

export function fileId(filePath: string): string {
  return `file:${normalizePath(filePath)}`;
}

export function symbolId(filePath: string, name: string): string {
  return `symbol:${normalizePath(filePath)}:${name}`;
}

export function normalizePath(p: string): string {
  // Keep forward slashes for cross-platform canonical IDs.
  return p.replace(/\\/g, '/');
}

const EXTENSION_CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx'];

/** הגדרת-כינוי בסגנון tsconfig-paths: `@/x` → `<target>/x` תחת rootDir. */
export interface ImportAlias {
  readonly prefix: string;
  readonly target: string;
}

function tryCandidates(rootDir: string, baseNoExt: string): string | null {
  for (const ext of EXTENSION_CANDIDATES) {
    const candidate = baseNoExt + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return normalizePath(path.relative(rootDir, candidate));
    }
  }
  return null;
}

export function resolveImport(
  rootDir: string,
  baseFile: string,
  specifier: string,
  aliases: readonly ImportAlias[] = []
): string | null {
  // 1) tsconfig-style aliases first (e.g. "@/..." → "src/..." for the portal).
  for (const alias of aliases) {
    if (specifier.startsWith(alias.prefix)) {
      const rest = specifier.slice(alias.prefix.length);
      const candidateBase = path.join(rootDir, alias.target, rest)
        .replace(/\.(js|jsx|ts|tsx)$/i, '');
      const hit = tryCandidates(rootDir, candidateBase);
      if (hit) return hit;
    }
  }

  if (!specifier.startsWith('.')) return null; // bare/external module, not modeled

  // 2) relative imports.
  const baseDir = path.dirname(baseFile);
  const joined = path.join(rootDir, baseDir, specifier);
  const baseWithoutExt = joined.replace(/\.(js|jsx|ts|tsx)$/i, '');
  return tryCandidates(rootDir, baseWithoutExt);
}
