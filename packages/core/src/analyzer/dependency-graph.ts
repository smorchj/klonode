/**
 * Builds a directory-level dependency graph by analyzing import/require statements.
 * This is a lightweight regex-based approach. Tree-sitter integration comes later
 * for deeper analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScanEntry } from './scanner.js';

export interface Dependency {
  fromFile: string;
  toFile: string;
  importPath: string;
  type: 'local' | 'package' | 'builtin' | 'dynamic';
}

export interface DirectoryDependency {
  fromDir: string;
  toDir: string;
  weight: number; // number of imports between these dirs
}

// Regex patterns for common import styles
const IMPORT_PATTERNS = [
  // [0] ES modules: import ... from '...'
  /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,
  // [1] Dynamic import with string literal: import('...')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // [2] CommonJS with string literal: require('...')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // [3] Dynamic import with template literal: import(`...`)
  /import\s*\(\s*`([^`]*)`\s*\)/g,
  // [4] CommonJS with template literal: require(`...`)
  /require\s*\(\s*`([^`]*)`\s*\)/g,
  // [5] Dynamic import with variable: import(expr) — fallback catch-all
  /import\s*\(\s*([^)'"`\s][^)]*?)\s*\)/g,
  // [6] CommonJS with variable: require(expr) — fallback catch-all
  /require\s*\(\s*([^)'"`\s][^)]*?)\s*\)/g,
  // [7] Python: from ... import ... / import ...
  /^from\s+([^\s]+)\s+import/gm,
  // [8]
  /^import\s+([^\s,]+)/gm,
  // [9] Rust: use crate::... / mod ...
  /use\s+(?:crate::)?([^\s;{]+)/g,
  // [10] Go: import "..."
  /import\s+(?:\w+\s+)?["']([^"']+)["']/g,
];

/**
 * Extract import paths from a single file's content.
 */
function extractImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const ext = path.extname(filePath).toLowerCase();

  // Select relevant patterns based on file extension
  let patterns: RegExp[];
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      patterns = IMPORT_PATTERNS.slice(0, 7);
      break;
    case '.py':
      patterns = IMPORT_PATTERNS.slice(7, 9);
      break;
    case '.rs':
      patterns = [IMPORT_PATTERNS[9]];
      break;
    case '.go':
      patterns = [IMPORT_PATTERNS[10]];
      break;
    default:
      return imports;
  }

  // Track what we've already captured with string-literal patterns
  // to avoid duplicates from the variable-expression fallback patterns
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Reset regex state
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      if (!match[1]) continue;

      let captured = match[1];

      // For template literal patterns ([3] and [4]), extract the static
      // prefix up to the first interpolation `${...}`
      if (pattern === IMPORT_PATTERNS[3] || pattern === IMPORT_PATTERNS[4]) {
        const dollarIdx = captured.indexOf('${');
        if (dollarIdx > 0) {
          captured = captured.slice(0, dollarIdx);
        } else if (dollarIdx === 0) {
          // Entirely dynamic — no static prefix to resolve
          continue;
        }
        // else: no interpolation — template literal used like a normal string
      }

      // For variable-expression fallback patterns ([5] and [6]),
      // mark as a dynamic unresolvable but still record for graph completeness
      if (pattern === IMPORT_PATTERNS[5] || pattern === IMPORT_PATTERNS[6]) {
        // Skip if we already captured this via a more precise pattern
        if (seen.has(captured)) continue;
        // Record as-is; classifyImport will return 'dynamic' for non-path expressions
        imports.push(captured);
        seen.add(captured);
        continue;
      }

      if (!seen.has(captured)) {
        imports.push(captured);
        seen.add(captured);
      }
    }
  }

  return imports;
}

/**
 * Classify an import path as local, package, or builtin.
 */
function classifyImport(importPath: string): 'local' | 'package' | 'builtin' | 'dynamic' {
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return 'local';
  }
  if (importPath.startsWith('node:') || importPath.startsWith('std')) {
    return 'builtin';
  }
  // Variable expressions: contains whitespace, ternary operators, or
  // parentheses — not a valid import specifier.
  if (/[?()\s]/.test(importPath)) {
    return 'dynamic';
  }
  return 'package';
}

/**
 * Resolve a relative import to an absolute file path.
 */
function resolveImport(
  importPath: string,
  fromFile: string,
  repoRoot: string,
): string | null {
  if (classifyImport(importPath) !== 'local') return null;

  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, importPath);

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'];
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return path.relative(repoRoot, resolved);
  }

  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (fs.existsSync(withExt)) {
      return path.relative(repoRoot, withExt);
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexFile = path.join(resolved, `index${ext}`);
    if (fs.existsSync(indexFile)) {
      return path.relative(repoRoot, indexFile);
    }
  }

  return null;
}

/**
 * Build file-level dependencies from a scan result.
 */
export function buildFileDependencies(
  root: ScanEntry,
  repoRoot: string,
): Dependency[] {
  const dependencies: Dependency[] = [];

  function walk(entry: ScanEntry): void {
    if (!entry.isDirectory && entry.extension) {
      let content: string;
      try {
        content = fs.readFileSync(entry.path, 'utf-8');
      } catch {
        return;
      }

      const imports = extractImports(content, entry.path);

      for (const imp of imports) {
        const type = classifyImport(imp);
        const resolved = type === 'local'
          ? resolveImport(imp, entry.path, repoRoot)
          : null;

        dependencies.push({
          fromFile: entry.relativePath,
          toFile: resolved || imp,
          importPath: imp,
          type,
        });
      }
    }

    for (const child of entry.children) {
      walk(child);
    }
  }

  walk(root);
  return dependencies;
}

/**
 * Collapse file-level dependencies to directory-level.
 * This gives us the edges for the routing graph.
 */
export function collapseToDirectoryDeps(
  fileDeps: Dependency[],
): DirectoryDependency[] {
  const dirWeights = new Map<string, number>();

  for (const dep of fileDeps) {
    if (dep.type !== 'local') continue;

    const fromDir = path.dirname(dep.fromFile).replace(/\\/g, '/');
    const toDir = path.dirname(dep.toFile).replace(/\\/g, '/');

    if (fromDir === toDir) continue; // Skip intra-directory deps

    const key = `${fromDir}|${toDir}`;
    dirWeights.set(key, (dirWeights.get(key) || 0) + 1);
  }

  return Array.from(dirWeights.entries()).map(([key, weight]) => {
    const [fromDir, toDir] = key.split('|');
    return { fromDir, toDir, weight };
  });
}
