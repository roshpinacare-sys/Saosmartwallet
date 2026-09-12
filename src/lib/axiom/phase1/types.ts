// ============================================================
// AxiomState Phase 1: AST-Graph Domain Model
// ============================================================

export interface GraphNode {
  readonly id: string;        // e.g. "file:src/index.ts" or "symbol:src/utils.ts:foo"
  readonly kind: 'file' | 'symbol';
  readonly name: string;
  readonly payload: Uint8Array; // JSON-encoded metadata (range, kind detail, etc.)
  readonly deps: readonly string[]; // outgoing dependency ids
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly meta?: unknown;
}

export interface GraphDelta {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
}

export interface ParserProvider {
  readonly name: string;
  canParse(filePath: string): boolean;
  parse(rootDir: string, filePath: string, content: Uint8Array): GraphDelta;
}

export interface NodePayload {
  kind: 'file' | 'symbol';
  name: string;
  path?: string;           // original source path
  range?: { start: number; length: number };
  symbolType?: string;      // "function", "class", "variable", etc.
  deps: string[];
}

export interface GraphMeta {
  readonly lastParseSeq: string;
  readonly providerName: string;
  readonly fileCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

// Canonical key prefixes inside the LSS kernel.
export const KEY_PREFIXES = {
  node: 'ast://node/',
  edge: 'ast://edge/',
  meta: 'ast://meta',
} as const;
