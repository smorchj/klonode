/**
 * Svelte store for the routing graph.
 * Single source of truth — both tree view and graph view render from this.
 */

import { writable, derived } from 'svelte/store';
import type { RoutingGraph, RoutingNode, Edge } from '../types';

// The full routing graph
export const graphStore = writable<RoutingGraph | null>(null);

// Currently selected node ID
export const selectedNodeId = writable<string | null>(null);

// Current view mode
export const viewMode = writable<'tree' | 'graph' | 'split' | 'github'>('split');

// Heatmap overlay toggle
export const showHeatmap = writable(false);

// Get the selected node's full data
export const selectedNode = derived(
  [graphStore, selectedNodeId],
  ([$graph, $nodeId]) => {
    if (!$graph || !$nodeId) return null;
    return $graph.nodes.get($nodeId) || null;
  },
);

// Get all top-level directories for tree root
export const topLevelNodes = derived(graphStore, ($graph) => {
  if (!$graph) return [];
  const root = $graph.nodes.get($graph.rootNodeId);
  if (!root) return [];
  return root.children
    .map((id) => $graph.nodes.get(id))
    .filter((n): n is RoutingNode => n !== undefined);
});

// Get edges for the graph view
export const graphEdges = derived(graphStore, ($graph) => {
  if (!$graph) return [];
  return $graph.edges;
});

// Node access heatmap data
export const heatmapData = derived(graphStore, ($graph) => {
  if (!$graph) return new Map<string, number>();
  const map = new Map<string, number>();
  let maxAccess = 0;

  for (const [id, node] of $graph.nodes) {
    const count = node.telemetry.accessCount;
    map.set(id, count);
    if (count > maxAccess) maxAccess = count;
  }

  // Normalize to 0-1
  if (maxAccess > 0) {
    for (const [id, count] of map) {
      map.set(id, count / maxAccess);
    }
  }

  return map;
});
