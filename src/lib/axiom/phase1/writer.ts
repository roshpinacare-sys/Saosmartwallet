import type { LSSKernel } from '../phase0/kernel';
import type { GraphDelta, GraphMeta } from './types';
import { KEY_PREFIXES } from './types';

export interface WriteOptions {
  readonly checkpoint?: boolean;
  readonly providerName?: string;
}

export function writeGraph(kernel: LSSKernel, delta: GraphDelta, options: WriteOptions = {}): bigint {
  for (const node of delta.nodes) {
    kernel.apply(`${KEY_PREFIXES.node}${node.id}`, node.payload);
  }

  for (const edge of delta.edges) {
    const key = `${KEY_PREFIXES.edge}${edge.from}/${edge.to}`;
    const value = edge.meta === undefined
      ? new Uint8Array(0)
      : new TextEncoder().encode(JSON.stringify(edge.meta));
    kernel.apply(key, value);
  }

  const meta: GraphMeta = {
    lastParseSeq: String(kernel.stats().seq),
    providerName: options.providerName ?? 'unknown',
    fileCount: delta.nodes.filter(n => n.kind === 'file').length,
    nodeCount: delta.nodes.length,
    edgeCount: delta.edges.length,
  };
  kernel.apply(KEY_PREFIXES.meta, new TextEncoder().encode(JSON.stringify(meta)));

  const seq = kernel.stats().seq;
  if (options.checkpoint) {
    kernel.checkpoint();
  }
  return seq;
}
