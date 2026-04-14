/**
 * Self-improvement optimizer.
 * Analyzes telemetry to improve routing over time.
 * - Prunes unused routing references
 * - Promotes frequently accessed but unrouted paths
 * - Updates node telemetry scores
 */

import type { RoutingGraph, RoutingNode } from '../model/routing-graph.js';
import { buildDirAccessMap } from './telemetry.js';

export interface OptimizationResult {
  promotions: Promotion[];
  prunings: Pruning[];
  updatedNodes: number;
  report: string;
}

export interface Promotion {
  dirPath: string;
  reason: string;
  accessCount: number;
  action: 'add_to_routing' | 'increase_detail';
}

export interface Pruning {
  dirPath: string;
  reason: string;
  lastAccessed: Date | null;
  action: 'remove_from_routing' | 'reduce_detail';
}

/**
 * Run the optimization analysis on a routing graph.
 */
export function optimize(
  graph: RoutingGraph,
  repoPath: string,
): OptimizationResult {
  const dirAccess = buildDirAccessMap(repoPath);
  const promotions: Promotion[] = [];
  const prunings: Pruning[] = [];
  let updatedNodes = 0;

  // Update node telemetry from access data
  for (const [id, node] of graph.nodes) {
    const normalizedPath = node.path.replace(/\\/g, '/');
    const accessCount = dirAccess.get(normalizedPath) || 0;

    if (accessCount > 0) {
      node.telemetry.accessCount = accessCount;
      node.telemetry.lastAccessed = new Date();
      updatedNodes++;
    }
  }

  // Find "hot" directories not in routing (Layer 2+)
  for (const [dirPath, count] of dirAccess) {
    const node = findNodeByPath(graph, dirPath);

    if (!node && count >= 3) {
      // Frequently accessed directory with no routing node
      promotions.push({
        dirPath,
        reason: `Accessed ${count} times but has no CONTEXT.md routing`,
        accessCount: count,
        action: 'add_to_routing',
      });
    } else if (node && node.contextFile && count >= 10) {
      // Very hot directory — might need more detail
      const currentTokens = node.contextFile.tokenCount;
      if (currentTokens < node.tokenBudget * 0.5) {
        promotions.push({
          dirPath,
          reason: `High access (${count}x) but context only uses ${currentTokens}/${node.tokenBudget} tokens`,
          accessCount: count,
          action: 'increase_detail',
        });
      }
    }
  }

  // Find "cold" directories with routing that's never used
  for (const [id, node] of graph.nodes) {
    if (
      node.layer >= 2 &&
      node.contextFile &&
      !node.contextFile.manuallyEdited &&
      node.telemetry.accessCount === 0
    ) {
      // Has routing but never accessed — candidate for pruning
      prunings.push({
        dirPath: node.path,
        reason: 'Has CONTEXT.md but was never accessed in any session',
        lastAccessed: node.telemetry.lastAccessed,
        action: 'reduce_detail',
      });
    }
  }

  // Calculate effectiveness scores
  for (const [id, node] of graph.nodes) {
    if (node.telemetry.accessCount > 0) {
      // Simple heuristic: effectiveness = access frequency relative to total
      const totalAccess = Array.from(graph.nodes.values())
        .reduce((sum, n) => sum + n.telemetry.accessCount, 0);
      node.telemetry.effectivenessScore = totalAccess > 0
        ? node.telemetry.accessCount / totalAccess
        : 0;
    }
  }

  // Generate report
  const report = generateReport(promotions, prunings, updatedNodes, dirAccess);

  return { promotions, prunings, updatedNodes, report };
}

function findNodeByPath(graph: RoutingGraph, dirPath: string): RoutingNode | undefined {
  for (const node of graph.nodes.values()) {
    if (node.path.replace(/\\/g, '/') === dirPath) {
      return node;
    }
  }
  return undefined;
}

function generateReport(
  promotions: Promotion[],
  prunings: Pruning[],
  updatedNodes: number,
  dirAccess: Map<string, number>,
): string {
  const lines: string[] = [];
  lines.push('# Klonode Optimization Report');
  lines.push('');
  lines.push(`Updated telemetry for ${updatedNodes} nodes.`);
  lines.push(`Total directories accessed: ${dirAccess.size}`);
  lines.push('');

  if (promotions.length > 0) {
    lines.push('## Promotions (add/improve routing)');
    for (const p of promotions) {
      lines.push(`- **${p.dirPath}**: ${p.reason} → ${p.action}`);
    }
    lines.push('');
  }

  if (prunings.length > 0) {
    lines.push('## Prunings (reduce/remove routing)');
    for (const p of prunings) {
      lines.push(`- **${p.dirPath}**: ${p.reason} → ${p.action}`);
    }
    lines.push('');
  }

  if (promotions.length === 0 && prunings.length === 0) {
    lines.push('No routing changes recommended at this time.');
    lines.push('Continue working to build more telemetry data.');
  }

  return lines.join('\n');
}
