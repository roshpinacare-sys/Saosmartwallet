import * as ts from 'typescript';
import * as path from 'node:path';
import type { GraphDelta, GraphNode, GraphEdge, ParserProvider, NodePayload } from '../types';
import { fileId, symbolId, resolveImport } from '../ids';
import type { ImportAlias } from '../ids';

export interface TypeScriptProviderOptions {
  readonly aliases?: readonly ImportAlias[];
}

export class TypeScriptProvider implements ParserProvider {
  readonly name = 'typescript';
  private readonly aliases: readonly ImportAlias[];

  constructor(options: TypeScriptProviderOptions = {}) {
    this.aliases = options.aliases ?? [];
  }

  canParse(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs';
  }

  parse(rootDir: string, filePath: string, content: Uint8Array): GraphDelta {
    const text = new TextDecoder().decode(content);
    const sourceFile = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const fId = fileId(filePath);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const fileDeps = new Set<string>();
    const importMap = new Map<string, string>(); // local alias -> target id

    const addEdge = (from: string, to: string) => {
      if (from === to) return;
      edges.push({ from, to });
    };

    // Pass 1: collect imports.
    ts.forEachChild(sourceFile, (statement) => {
      if (!ts.isImportDeclaration(statement)) return;
      const moduleSpecifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;

      const resolved = resolveImport(rootDir, filePath, moduleSpecifier.text, this.aliases);
      if (!resolved) return; // skip external modules

      const clause = statement.importClause;
      if (!clause) {
        fileDeps.add(fileId(resolved));
        return;
      }

      if (clause.name) {
        // default import: alias maps to the target file node
        importMap.set(clause.name.text, fileId(resolved));
        fileDeps.add(fileId(resolved));
      }

      if (clause.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const elem of clause.namedBindings.elements) {
            const localName = elem.name.text;
            const propertyName = elem.propertyName ? elem.propertyName.text : localName;
            importMap.set(localName, symbolId(resolved, propertyName));
            fileDeps.add(fileId(resolved));
          }
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          importMap.set(clause.namedBindings.name.text, fileId(resolved));
          fileDeps.add(fileId(resolved));
        }
      }
    });

    // Pass 2: collect top-level symbols.
    ts.forEachChild(sourceFile, (statement) => {
      const name = declarationName(statement);
      if (!name) return;

      const sId = symbolId(filePath, name);
      const symbolDeps = new Set<string>();

      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node)) {
          const target = importMap.get(node.text);
          if (target) {
            symbolDeps.add(target);
            if (target.startsWith('file:')) fileDeps.add(target);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(statement);

      const payload: NodePayload = {
        kind: 'symbol',
        name,
        path: filePath,
        range: { start: statement.getStart(sourceFile), length: statement.getWidth(sourceFile) },
        symbolType: declarationKind(statement),
        deps: Array.from(symbolDeps),
      };
      nodes.push({
        id: sId,
        kind: 'symbol',
        name,
        payload: new TextEncoder().encode(JSON.stringify(payload)),
        deps: Array.from(symbolDeps),
      });
      addEdge(fId, sId);
    });

    const filePayload: NodePayload = {
      kind: 'file',
      name: path.basename(filePath),
      path: filePath,
      deps: Array.from(fileDeps),
    };
    nodes.unshift({
      id: fId,
      kind: 'file',
      name: path.basename(filePath),
      payload: new TextEncoder().encode(JSON.stringify(filePayload)),
      deps: Array.from(fileDeps),
    });

    return { nodes, edges };
  }
}

function declarationName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isClassDeclaration(node) && node.name) return node.name.text;
  if (ts.isInterfaceDeclaration(node) && node.name) return node.name.text;
  if (ts.isTypeAliasDeclaration(node) && node.name) return node.name.text;
  if (ts.isEnumDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}

function declarationKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableStatement(node)) return 'variable';
  return 'declaration';
}
