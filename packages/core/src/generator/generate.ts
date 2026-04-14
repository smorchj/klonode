/**
 * Main generation orchestrator.
 * Takes a repo path, runs the full analysis pipeline, generates all routing files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { scanRepository } from '../analyzer/scanner.js';
import { getRepoLanguages } from '../analyzer/language-detect.js';
import { buildFileDependencies, collapseToDirectoryDeps } from '../analyzer/dependency-graph.js';
import { summarizeAll } from '../analyzer/summarizer.js';
import { buildRoutingGraph } from '../analyzer/graph-builder.js';
import { generateLayer0 } from './layer0.js';
import { generateLayer1 } from './layer1.js';
import { generateAllLayer2, setContentExtractionContext } from './layer2.js';
import type { RoutingGraph } from '../model/routing-graph.js';
import { type KlonodeConfig, DEFAULT_CONFIG } from '../model/config.js';

export interface GenerateResult {
  graph: RoutingGraph;
  files: GeneratedFile[];
  stats: {
    totalFilesGenerated: number;
    totalTokens: number;
    durationMs: number;
  };
}

export interface GeneratedFile {
  relativePath: string;
  content: string;
  layer: number;
}

/**
 * Run the full Klonode generation pipeline on a repository.
 */
export async function generateRouting(
  repoPath: string,
  config: KlonodeConfig = DEFAULT_CONFIG,
): Promise<GenerateResult> {
  const startTime = Date.now();
  const repoName = path.basename(repoPath);

  // Phase 1: Scan
  const scanResult = scanRepository(repoPath, config);

  // Phase 2: Analyze
  const summaries = summarizeAll(scanResult.root);
  const fileDeps = buildFileDependencies(scanResult.root, repoPath);
  const dirDeps = collapseToDirectoryDeps(fileDeps);

  // Phase 3: Build graph
  const graph = buildRoutingGraph({
    repoPath,
    repoName,
    scanRoot: scanResult.root,
    summaries,
    directoryDeps: dirDeps,
  });

  // Phase 4: Generate files
  const files: GeneratedFile[] = [];
  let totalTokens = 0;

  // Layer 0: CLAUDE.md at root
  const layer0Content = generateLayer0(graph);
  files.push({
    relativePath: 'CLAUDE.md',
    content: layer0Content,
    layer: 0,
  });
  totalTokens += Math.ceil(layer0Content.length / 4);

  // Layer 1: CONTEXT.md at root
  const layer1Content = generateLayer1(graph);
  files.push({
    relativePath: 'CONTEXT.md',
    content: layer1Content,
    layer: 1,
  });
  totalTokens += Math.ceil(layer1Content.length / 4);

  // Layer 2: CONTEXT.md in each significant subdirectory
  // Pass scan data so layer2 can extract actual file contents (exports, routes, patterns)
  setContentExtractionContext(scanResult.root, repoPath);
  const layer2Files = generateAllLayer2(graph);
  for (const [dirPath, content] of layer2Files) {
    const relPath = dirPath === '.'
      ? 'CONTEXT.md'
      : `${dirPath}/CONTEXT.md`;
    files.push({
      relativePath: relPath,
      content,
      layer: 2,
    });
    totalTokens += Math.ceil(content.length / 4);

    // Attach enriched content back to graph nodes so it persists in graph.json
    for (const [, node] of graph.nodes) {
      if (node.path === dirPath) {
        node.contextFile = {
          inputs: [],
          process: [],
          outputs: [],
          rawMarkdown: content,
          lineCount: content.split('\n').length,
          tokenCount: Math.ceil(content.length / 4),
          lastGenerated: new Date(),
          manuallyEdited: false,
        };
        break;
      }
    }
  }

  return {
    graph,
    files,
    stats: {
      totalFilesGenerated: files.length,
      totalTokens,
      durationMs: Date.now() - startTime,
    },
  };
}

/**
 * Write generated files to disk.
 */
export function writeGeneratedFiles(
  repoPath: string,
  files: GeneratedFile[],
  mode: 'inline' | 'shadow' = 'inline',
): void {
  for (const file of files) {
    let targetPath: string;

    if (mode === 'inline') {
      targetPath = path.join(repoPath, file.relativePath);
    } else {
      // Shadow mode: all routing files under .klonode/routing/
      targetPath = path.join(repoPath, '.klonode', 'routing', file.relativePath);
    }

    // Ensure directory exists
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });

    // Don't overwrite manually edited files
    if (fs.existsSync(targetPath)) {
      const existing = fs.readFileSync(targetPath, 'utf-8');
      if (existing.includes('<!-- klonode:manual -->')) {
        continue; // Skip manually edited files
      }
    }

    fs.writeFileSync(targetPath, file.content, 'utf-8');
  }
}

/**
 * Save the Klonode config to .klonode/config.json
 */
export function saveConfig(repoPath: string, config: KlonodeConfig): void {
  const klonodeDir = path.join(repoPath, '.klonode');
  fs.mkdirSync(klonodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(klonodeDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}

/**
 * Load existing Klonode config, or return defaults.
 */
export function loadConfig(repoPath: string): KlonodeConfig {
  const configPath = path.join(repoPath, '.klonode', 'config.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  }
  return DEFAULT_CONFIG;
}
