/**
 * Serialize/deserialize routing graphs for export/import.
 * Converts Map-based graph to plain JSON and back.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RoutingGraph, RoutingNode, Edge, GraphMetadata, NodeTelemetry } from '../model/routing-graph.js';
import { createEmptyTelemetry } from '../model/routing-graph.js';

interface SerializedGraph {
  id: string;
  repoPath: string;
  rootNodeId: string;
  nodes: Record<string, RoutingNode>;
  edges: Edge[];
  metadata: GraphMetadata;
  createdAt: string;
  updatedAt: string;
  version: string;
}

export function serializeGraph(graph: RoutingGraph): string {
  const serialized: SerializedGraph = {
    id: graph.id,
    repoPath: graph.repoPath,
    rootNodeId: graph.rootNodeId,
    nodes: Object.fromEntries(graph.nodes),
    edges: graph.edges,
    metadata: {
      ...graph.metadata,
      generatedAt: graph.metadata.generatedAt,
      lastOptimized: graph.metadata.lastOptimized,
    },
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
    version: '0.1.0',
  };

  return JSON.stringify(serialized, null, 2);
}

export function deserializeGraph(json: string): RoutingGraph {
  const data: SerializedGraph = JSON.parse(json);

  const nodes = new Map<string, RoutingNode>();
  for (const [id, node] of Object.entries(data.nodes)) {
    nodes.set(id, {
      ...node,
      telemetry: node.telemetry || createEmptyTelemetry(),
    });
  }

  return {
    id: data.id,
    repoPath: data.repoPath,
    rootNodeId: data.rootNodeId,
    nodes,
    edges: data.edges,
    metadata: {
      ...data.metadata,
      generatedAt: new Date(data.metadata.generatedAt),
      lastOptimized: data.metadata.lastOptimized
        ? new Date(data.metadata.lastOptimized)
        : null,
    },
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}

/**
 * Save graph to .klonode/graph.json
 */
export function saveGraph(repoPath: string, graph: RoutingGraph): void {
  const klonodeDir = path.join(repoPath, '.klonode');
  fs.mkdirSync(klonodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(klonodeDir, 'graph.json'),
    serializeGraph(graph),
    'utf-8',
  );
}

/**
 * Load graph from .klonode/graph.json
 */
export function loadGraph(repoPath: string): RoutingGraph | null {
  const graphPath = path.join(repoPath, '.klonode', 'graph.json');
  if (!fs.existsSync(graphPath)) return null;
  const json = fs.readFileSync(graphPath, 'utf-8');
  return deserializeGraph(json);
}
