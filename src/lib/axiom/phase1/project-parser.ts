import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphDelta, GraphNode, GraphEdge, ParserProvider } from './types';
import { TypeScriptProvider } from './providers/typescript';
import { RegexProvider } from './providers/regex';
import type { ImportAlias } from './ids';

export interface ProjectParserOptions {
  readonly providers?: ParserProvider[];
  readonly exclude?: Set<string>;
  /** tsconfig-style aliases, forwarded to TypeScriptProvider. */
  readonly aliases?: readonly ImportAlias[];
}

const DEFAULT_EXCLUDES = new Set([
  'node_modules',
  '.git',
  'dist',
  'tmp',
  'coverage',
]);

export class ProjectParser {
  private readonly providers: ParserProvider[];
  private readonly exclude: Set<string>;

  constructor(options: ProjectParserOptions = {}) {
    this.providers = options.providers ?? [
      new TypeScriptProvider({ aliases: options.aliases }),
      new RegexProvider(),
    ];
    this.exclude = options.exclude ?? DEFAULT_EXCLUDES;
  }

  parseFile(rootDir: string, rel: string): GraphDelta {
    const content = fs.readFileSync(path.join(rootDir, rel));
    const provider = this.providers.find(p => p.canParse(rel));
    if (!provider) return { nodes: [], edges: [] };
    return provider.parse(rootDir, rel, content);
  }

  parseProject(rootDir: string): GraphDelta {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (this.exclude.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(full);
        } else if (entry.isFile()) {
          const rel = path.relative(rootDir, full);
          const content = fs.readFileSync(full);
          const provider = this.providers.find(p => p.canParse(rel));
          if (!provider) continue;
          const delta = provider.parse(rootDir, rel, content);
          nodes.push(...delta.nodes);
          edges.push(...delta.edges);
        }
      }
    };

    visit(rootDir);
    return { nodes, edges };
  }
}

export function parseProject(rootDir: string, options?: ProjectParserOptions): GraphDelta {
  return new ProjectParser(options).parseProject(rootDir);
}
