/**
 * Scans a git repository directory tree, respecting .gitignore.
 * Produces a raw file/directory listing that feeds into the routing graph builder.
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import { type KlonodeConfig, DEFAULT_CONFIG } from '../model/config.js';

export interface ScanEntry {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
  children: ScanEntry[];
  depth: number;
  extension: string | null;
  sizeBytes: number;
}

export interface ScanResult {
  root: ScanEntry;
  totalFiles: number;
  totalDirectories: number;
  maxDepth: number;
}

function loadGitignore(dirPath: string, parentIgnore?: Ignore): Ignore {
  const ig = ignore();

  // Inherit parent rules
  if (parentIgnore) {
    // ignore library doesn't support inheritance directly,
    // so we pass parent down through the recursive walk
  }

  const gitignorePath = path.join(dirPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    ig.add(content);
  }

  return ig;
}

export function scanRepository(
  repoPath: string,
  config: KlonodeConfig = DEFAULT_CONFIG,
): ScanResult {
  let totalFiles = 0;
  let totalDirectories = 0;
  let maxDepth = 0;

  const rootIgnore = ignore().add(config.exclude);

  function walk(
    dirPath: string,
    relativeTo: string,
    depth: number,
    parentIgnore: Ignore,
  ): ScanEntry {
    const name = path.basename(dirPath);
    const relPath = path.relative(relativeTo, dirPath) || '.';

    if (depth > maxDepth) maxDepth = depth;

    const entry: ScanEntry = {
      path: dirPath,
      relativePath: relPath,
      name,
      isDirectory: true,
      children: [],
      depth,
      extension: null,
      sizeBytes: 0,
    };

    totalDirectories++;

    // Merge parent ignore with local .gitignore
    const localIgnore = ignore().add(config.exclude);
    const localGitignore = loadGitignore(dirPath);

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return entry;
    }

    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      const itemRelPath = path.relative(relativeTo, path.join(dirPath, item.name));
      const normalizedRelPath = itemRelPath.replace(/\\/g, '/');

      // Check ignore rules
      if (localIgnore.ignores(normalizedRelPath) || localIgnore.ignores(item.name)) {
        continue;
      }
      if (localGitignore.ignores(item.name)) {
        continue;
      }

      if (item.isDirectory()) {
        const childEntry = walk(
          path.join(dirPath, item.name),
          relativeTo,
          depth + 1,
          localIgnore,
        );
        entry.children.push(childEntry);
      } else if (item.isFile()) {
        const filePath = path.join(dirPath, item.name);
        const ext = path.extname(item.name).toLowerCase() || null;
        let size = 0;
        try {
          size = fs.statSync(filePath).size;
        } catch {
          // skip
        }

        const fileEntry: ScanEntry = {
          path: filePath,
          relativePath: normalizedRelPath,
          name: item.name,
          isDirectory: false,
          children: [],
          depth: depth + 1,
          extension: ext,
          sizeBytes: size,
        };

        totalFiles++;
        entry.children.push(fileEntry);
      }
    }

    return entry;
  }

  const root = walk(repoPath, repoPath, 0, rootIgnore);

  return {
    root,
    totalFiles,
    totalDirectories,
    maxDepth,
  };
}

/**
 * Flatten a scan tree into a list of all entries.
 */
export function flattenScan(entry: ScanEntry): ScanEntry[] {
  const result: ScanEntry[] = [entry];
  for (const child of entry.children) {
    result.push(...flattenScan(child));
  }
  return result;
}
