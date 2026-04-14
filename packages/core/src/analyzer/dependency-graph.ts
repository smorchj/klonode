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
  type: 'local' | 'package' | 'builtin';
}

export interface DirectoryDependency {
  fromDir: string;
  toDir: string;
  weight: number; // number of imports between these dirs
}

// Regex patterns for common import styles
const IMPORT_PATTERNS = [
  // ES modules: import ... from '...'
  /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,
  // Dynamic import: import('...')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CommonJS: require('...')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Python: from ... import ... / import ...
  /^from\s+([^\s]+)\s+import/gm,
  /^import\s+([^\s,]+)/gm,
  // Rust: use crate::... / mod ...
  /use\s+(?:crate::)?([^\s;{]+)/g,
  // Go: import "..."
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
      patterns = IMPORT_PATTERNS.slice(0, 3);
      break;
    case '.py':
      patterns = IMPORT_PATTERNS.slice(3, 5);
      break;
    case '.rs':
      patterns = [IMPORT_PATTERNS[5]];
      break;
    case '.go':
      patterns = [IMPORT_PATTERNS[6]];
      break;
    default:
      return imports;
  }

  for (const pattern of patterns) {
    // Reset regex state
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }
  }

  return imports;
}

/**
 * Classify an import path as local, package, or builtin.
 */
function classifyImport(importPath: string): 'local' | 'package' | 'builtin' {
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return 'local';
  }
  if (importPath.startsWith('node:') || importPath.startsWith('std')) {
    return 'builtin';
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
