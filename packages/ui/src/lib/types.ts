/**
 * Lightweight type definitions for the UI.
 * Mirrors @klonode/core types without importing Node.js code.
 */

export type LayerLevel = 0 | 1 | 2 | 3 | 4;
export type NodeType = 'root' | 'directory' | 'file' | 'reference' | 'artifact';
export type EdgeType = 'contains' | 'references' | 'depends_on' | 'routes_to';
export type TaskCategory = 'feature' | 'bugfix' | 'refactor' | 'test' | 'docs' | 'config' | 'unknown';

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
  inputs: any[];
  process: string[];
  outputs: any[];
  rawMarkdown: string;
  lineCount: number;
  tokenCount: number;
  lastGenerated: Date;
  manuallyEdited: boolean;
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
