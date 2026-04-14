/**
 * Core data model for Klonode's routing graph.
 * Both the tree view and node graph render from this single structure.
 * Based on the Interpreted Context Methodology (ICM) five-layer architecture.
 */

export type LayerLevel = 0 | 1 | 2 | 3 | 4;

export type NodeType = 'root' | 'directory' | 'file' | 'reference' | 'artifact';

export type EdgeType = 'contains' | 'references' | 'depends_on' | 'routes_to';

export type TaskCategory =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'config'
  | 'unknown';

export interface RoutingGraph {
  id: string;
  repoPath: string;
  rootNodeId: string;
  nodes: Map<string, RoutingNode>;
  edges: Edge[];
  metadata: GraphMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoutingNode {
  id: string;
  path: string;
  name: string;
  type: NodeType;
  layer: LayerLevel;
  contextFile: ContextFile | null;
  children: string[];
  parent: string | null;
  summary: string;
  language: string | null;
  tokenBudget: number;
  telemetry: NodeTelemetry;
}

export interface ContextFile {
  inputs: ContextInput[];
  process: string[];
  outputs: ContextOutput[];
  rawMarkdown: string;
  lineCount: number;
  tokenCount: number;
  lastGenerated: Date;
  manuallyEdited: boolean;
}

export interface ContextInput {
  source: string;
  filePath: string;
  section: string;
  reason: string;
}

export interface ContextOutput {
  artifact: string;
  location: string;
  format: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  weight: number;
  label?: string;
}

export interface GraphMetadata {
  repoName: string;
  totalFiles: number;
  totalDirectories: number;
  languages: Record<string, number>;
  generatedAt: Date;
  lastOptimized: Date | null;
  version: string;
}

export interface NodeTelemetry {
  accessCount: number;
  lastAccessed: Date | null;
  avgTokensConsumed: number;
  taskTypes: Record<TaskCategory, number>;
  effectivenessScore: number;
}

// --- Factory functions ---

export function createEmptyTelemetry(): NodeTelemetry {
  return {
    accessCount: 0,
    lastAccessed: null,
    avgTokensConsumed: 0,
    taskTypes: {
      feature: 0,
      bugfix: 0,
      refactor: 0,
      test: 0,
      docs: 0,
      config: 0,
      unknown: 0,
    },
    effectivenessScore: 0,
  };
}

export function createRoutingNode(
  id: string,
  path: string,
  name: string,
  type: NodeType,
  layer: LayerLevel,
  parent: string | null = null,
): RoutingNode {
  const tokenBudgets: Record<LayerLevel, number> = {
    0: 800,
    1: 300,
    2: 500,
    3: 2000,
    4: 1000,
  };

  return {
    id,
    path,
    name,
    type,
    layer,
    contextFile: null,
    children: [],
    parent,
    summary: '',
    language: null,
    tokenBudget: tokenBudgets[layer],
    telemetry: createEmptyTelemetry(),
  };
}

export function createRoutingGraph(
  repoPath: string,
  repoName: string,
): RoutingGraph {
  const rootId = 'root';
  const rootNode = createRoutingNode(rootId, '.', repoName, 'root', 0);

  const nodes = new Map<string, RoutingNode>();
  nodes.set(rootId, rootNode);

  return {
    id: crypto.randomUUID(),
    repoPath,
    rootNodeId: rootId,
    nodes,
    edges: [],
    metadata: {
      repoName,
      totalFiles: 0,
      totalDirectories: 0,
      languages: {},
      generatedAt: new Date(),
      lastOptimized: null,
      version: '0.1.0',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
