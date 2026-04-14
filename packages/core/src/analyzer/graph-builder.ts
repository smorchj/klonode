/**
 * Builds a RoutingGraph from scan results, language profiles, and dependencies.
 * This is the main orchestrator that ties all analysis together.
 */

import * as crypto from 'crypto';
import type { ScanEntry } from './scanner.js';
import type { DirectorySummary } from './summarizer.js';
import type { DirectoryDependency } from './dependency-graph.js';
import {
  type RoutingGraph,
  type RoutingNode,
  type Edge,
  type LayerLevel,
  type NodeType,
  createRoutingGraph,
  createRoutingNode,
} from '../model/routing-graph.js';

function stableId(relativePath: string): string {
  return crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 12);
}

/**
 * Classify a directory into an ICM layer.
 */
function classifyLayer(
  entry: ScanEntry,
  summary: DirectorySummary | undefined,
  depth: number,
): LayerLevel {
  // Root is always Layer 0
  if (depth === 0) return 0;

  // First-level directories are Layer 1 (top routing)
  if (depth === 1) return 1;

  // Directories that are clearly reference material
  if (summary) {
    const purposeLower = summary.purpose.toLowerCase();
    if (
      purposeLower.includes('config') ||
      purposeLower.includes('type') ||
      purposeLower.includes('schema') ||
      purposeLower.includes('doc') ||
      purposeLower.includes('interface')
    ) {
      return 3;
    }

    // Build artifacts, generated code
    if (
      purposeLower.includes('static') ||
      purposeLower.includes('asset') ||
      purposeLower.includes('migration')
    ) {
      return 4;
    }
  }

  // Everything else at depth 2+ is Layer 2 (stage/task level)
  return 2;
}

function classifyNodeType(entry: ScanEntry): NodeType {
  if (!entry.isDirectory) {
    return 'file';
  }
  if (entry.depth === 0) return 'root';
  return 'directory';
}

export interface BuildGraphOptions {
  repoPath: string;
  repoName: string;
  scanRoot: ScanEntry;
  summaries: Map<string, DirectorySummary>;
  directoryDeps: DirectoryDependency[];
  maxDepth?: number;
}

/**
 * Build the complete routing graph from analysis results.
 */
export function buildRoutingGraph(options: BuildGraphOptions): RoutingGraph {
  const {
    repoPath,
    repoName,
    scanRoot,
    summaries,
    directoryDeps,
    maxDepth = 6,
  } = options;

  const graph = createRoutingGraph(repoPath, repoName);
  let totalFiles = 0;
  let totalDirs = 0;

  function addNode(entry: ScanEntry, parentId: string | null): string {
    // Skip files — we only route to directories
    // Files are tracked in the context of their parent directory
    if (!entry.isDirectory) {
      totalFiles++;
      return '';
    }

    if (entry.depth > maxDepth) return '';

    totalDirs++;

    const id = entry.depth === 0 ? 'root' : stableId(entry.relativePath);
    const summary = summaries.get(entry.relativePath);
    const layer = classifyLayer(entry, summary, entry.depth);
    const type = classifyNodeType(entry);

    const node: RoutingNode = createRoutingNode(
      id,
      entry.relativePath,
      entry.name,
      type,
      layer,
      parentId,
    );

    node.summary = summary?.summary || '';
    node.language = summary?.languages.primary || null;

    // Update existing root node or add new
    if (entry.depth === 0) {
      const existing = graph.nodes.get('root')!;
      Object.assign(existing, {
        summary: node.summary,
        language: node.language,
      });
    } else {
      graph.nodes.set(id, node);
    }

    // Add containment edge (parent → child)
    if (parentId) {
      const parentNode = graph.nodes.get(parentId);
      if (parentNode) {
        parentNode.children.push(id);
      }

      graph.edges.push({
        id: `${parentId}->${id}`,
        from: parentId,
        to: id,
        type: 'contains',
        weight: 1,
      });
    }

    // Recurse into children
    for (const child of entry.children) {
      addNode(child, id);
    }

    return id;
  }

  addNode(scanRoot, null);

  // Add dependency edges (directory-level)
  for (const dep of directoryDeps) {
    const fromId = stableId(dep.fromDir);
    const toId = stableId(dep.toDir);

    if (graph.nodes.has(fromId) && graph.nodes.has(toId)) {
      graph.edges.push({
        id: `dep:${fromId}->${toId}`,
        from: fromId,
        to: toId,
        type: 'depends_on',
        weight: dep.weight,
      });
    }
  }

  // Update metadata
  const langBreakdown: Record<string, number> = {};
  for (const summary of summaries.values()) {
    for (const [lang, count] of Object.entries(summary.languages.breakdown)) {
      langBreakdown[lang] = (langBreakdown[lang] || 0) + count;
    }
  }

  graph.metadata.totalFiles = totalFiles;
  graph.metadata.totalDirectories = totalDirs;
  graph.metadata.languages = langBreakdown;

  return graph;
}
