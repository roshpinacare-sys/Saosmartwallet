import * as path from 'node:path';
import type { GraphDelta, GraphNode, GraphEdge, ParserProvider, NodePayload } from '../types';
import { fileId, resolveImport } from '../ids';

export class RegexProvider implements ParserProvider {
  readonly name = 'regex';

  canParse(_filePath: string): boolean {
    return true;
  }

  parse(rootDir: string, filePath: string, content: Uint8Array): GraphDelta {
    const text = new TextDecoder().decode(content);
    const fId = fileId(filePath);
    const deps = new Set<string>();
    const edges: GraphEdge[] = [];

    const importRegex = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+.*?\s+from\s+['"]([^'"]+)['"]|from\s+['"]([^'"]+)['"]\s+import/g;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(text)) !== null) {
      const specifier = m[1] || m[2] || m[3];
      if (!specifier) continue;
      const resolved = resolveImport(rootDir, filePath, specifier);
      if (resolved) {
        const target = fileId(resolved);
        deps.add(target);
        edges.push({ from: fId, to: target });
      }
    }

    const payload: NodePayload = {
      kind: 'file',
      name: path.basename(filePath),
      path: filePath,
      deps: Array.from(deps),
    };

    const node: GraphNode = {
      id: fId,
      kind: 'file',
      name: path.basename(filePath),
      payload: new TextEncoder().encode(JSON.stringify(payload)),
      deps: Array.from(deps),
    };

    return { nodes: [node], edges };
  }
}
