// ============================================================
// AxiomState Phase 2: Deterministic Bundle / Manifest Generator
// ============================================================

import type { LSSKernel } from '../phase0/kernel';
import { loadAllNodes } from '../phase1/loader';
import { SOURCE_PREFIX } from './types';

export interface BundleEntry {
  readonly id: string;
  readonly path: string;
  readonly content: Uint8Array;
}

export interface BundleResult {
  readonly order: string[];          // file ids in topological order
  readonly entries: BundleEntry[];   // same order, with content
  readonly cycles: string[][];       // detected dependency cycles (empty if none)
}

export function bundleFiles(kernel: LSSKernel, fileIds: Iterable<string>): BundleResult {
  const allNodes = loadAllNodes(kernel);
  const ids = Array.isArray(fileIds) ? fileIds : Array.from(fileIds);
  const subset = new Set(ids);

  // Build dependency and reverse-dependency maps restricted to the requested file set.
  const depsOf = new Map<string, Set<string>>();
  const dependentsOf = new Map<string, Set<string>>();
  for (const id of subset) {
    const node = allNodes.get(id);
    if (!node || node.kind !== 'file') continue;
    const deps = new Set<string>();
    for (const dep of node.deps) {
      if (subset.has(dep)) {
        deps.add(dep);
        const list = dependentsOf.get(dep) ?? new Set();
        list.add(id);
        dependentsOf.set(dep, list);
      }
    }
    depsOf.set(id, deps);
  }

  // Kahn's algorithm on the reversed graph so dependencies precede dependents.
  const inDegree = new Map<string, number>();
  for (const id of depsOf.keys()) inDegree.set(id, depsOf.get(id)!.size);

  const queue = Array.from(inDegree.entries())
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const dependents = dependentsOf.get(id) ?? new Set();
    for (const dependent of Array.from(dependents).sort()) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
      queue.sort();
    }
  }

  const cycles: string[][] = [];
  const visited = new Set(order);
  if (visited.size !== depsOf.size) {
    const remaining = Array.from(depsOf.keys()).filter(id => !visited.has(id));
    // Collect a simple cycle from each leftover strongly connected component.
    const seen = new Set<string>();
    for (const start of remaining) {
      if (seen.has(start)) continue;
      const path: string[] = [];
      const pathSet = new Set<string>();
      const walk = (id: string): boolean => {
        if (pathSet.has(id)) {
          const idx = path.indexOf(id);
          cycles.push(path.slice(idx));
          return true;
        }
        if (visited.has(id) || !depsOf.has(id)) return false;
        path.push(id);
        pathSet.add(id);
        seen.add(id);
        for (const next of Array.from(depsOf.get(id)!).sort()) {
          if (walk(next)) return true;
        }
        path.pop();
        pathSet.delete(id);
        return false;
      };
      walk(start);
    }
  }

  const entries: BundleEntry[] = order.map(id => {
    const sourceKey = `${SOURCE_PREFIX}${extractPath(id)}`;
    const content = kernel.get(sourceKey) ?? new Uint8Array(0);
    return { id, path: extractPath(id), content };
  });

  return { order, entries, cycles };
}

function extractPath(id: string): string {
  // "file:src/index.ts" -> "src/index.ts"
  if (id.startsWith('file:')) return id.slice('file:'.length);
  return id;
}
