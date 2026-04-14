/**
 * Agent Registry — manages the team of CLI agents for a Klonode project.
 *
 * Each agent is a Claude Code instance with specific context paths and tool permissions.
 * Agents are auto-generated from the project's Layer 1 directory structure,
 * with the Chief Organizer (CO) always present as the oversight agent.
 */

import type { RoutingGraph, RoutingNode } from '../model/routing-graph.js';
import type { DetectedTool } from '../analyzer/tool-detector.js';

export type AgentRole = 'co' | 'worker';

export type ContextDepth = 'minimal' | 'light' | 'standard' | 'heavy' | 'full';

export interface AgentDefinition {
  /** Unique identifier */
  id: string;
  /** Display name (e.g., "Frontend", "Backend", "CO") */
  name: string;
  /** Agent role */
  role: AgentRole;
  /** Description of what this agent specializes in */
  description: string;
  /** CONTEXT.md paths this agent has access to */
  contextPaths: string[];
  /** Tool permissions for this agent */
  toolPermissions: string[];
  /** Max turns per interaction */
  maxTurns: number;
  /** Default context depth */
  defaultContextDepth: ContextDepth;
  /** Icon/emoji for UI */
  icon: string;
  /** Color for UI (hex) */
  color: string;
  /** Relevant detected tools */
  tools: string[];
}

export interface AgentRegistry {
  /** Project root path */
  repoPath: string;
  /** All registered agents */
  agents: AgentDefinition[];
  /** CO agent (always first) */
  co: AgentDefinition;
}

const AGENT_COLORS = [
  '#a78bfa', // violet
  '#22d3ee', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f87171', // red
  '#818cf8', // indigo
  '#34d399', // green
  '#fb923c', // orange
];

const AGENT_ICONS: Record<string, string> = {
  frontend: '🎨',
  backend: '⚙',
  api: '🔌',
  database: '🗄',
  testing: '🧪',
  devops: '🚀',
  docs: '📝',
  auth: '🔐',
  game: '🎮',
  ui: '🖥',
  lib: '📦',
  scripts: '⚡',
  public: '🌐',
  types: '📋',
  config: '⚙',
};

/**
 * Create the Chief Organizer agent definition.
 */
function createCO(repoPath: string): AgentDefinition {
  return {
    id: 'co',
    name: 'CO',
    role: 'co',
    description: 'Chief Organizer — oversees the project, improves context and tools, analyzes interaction logs',
    contextPaths: ['*'], // CO sees everything
    toolPermissions: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    maxTurns: 25,
    defaultContextDepth: 'heavy',
    icon: '🧠',
    color: '#a78bfa',
    tools: [],
  };
}

/**
 * Auto-generate worker agents from a project's Layer 1 directories.
 * Each significant top-level directory becomes a potential agent specialization.
 */
export function buildAgentRegistry(
  graph: RoutingGraph,
  detectedTools: DetectedTool[] = [],
): AgentRegistry {
  const co = createCO(graph.repoPath);
  const agents: AgentDefinition[] = [co];

  const root = graph.nodes.get(graph.rootNodeId);
  if (!root) return { repoPath: graph.repoPath, agents, co };

  // Map detected tools to directory paths
  const toolsByDir = new Map<string, string[]>();
  for (const tool of detectedTools) {
    const dirPart = tool.configPath.split('/')[0];
    const existing = toolsByDir.get(dirPart) || [];
    existing.push(tool.id);
    toolsByDir.set(dirPart, existing);
  }

  let colorIdx = 1; // 0 is CO's violet

  for (const childId of root.children) {
    const node = graph.nodes.get(childId);
    if (!node || node.type !== 'directory') continue;

    // Skip unimportant directories
    if (node.children.length === 0) continue;

    const nameLower = node.name.toLowerCase();
    const icon = AGENT_ICONS[nameLower] || '📁';
    const color = AGENT_COLORS[colorIdx % AGENT_COLORS.length];
    colorIdx++;

    // Collect context paths: this dir + its children
    const contextPaths = [node.path];
    for (const grandchildId of node.children) {
      const gc = graph.nodes.get(grandchildId);
      if (gc) contextPaths.push(gc.path);
    }

    // Determine tools for this agent
    const agentTools = toolsByDir.get(node.name) || [];

    // Determine appropriate permissions based on directory type
    const isConfig = ['config', 'types', '.github', 'docs'].includes(nameLower);
    const toolPerms = isConfig
      ? ['Read', 'Glob', 'Grep']
      : ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

    agents.push({
      id: `agent-${node.name}`,
      name: node.name.charAt(0).toUpperCase() + node.name.slice(1),
      role: 'worker',
      description: node.summary || `Specialist for ${node.path}`,
      contextPaths,
      toolPermissions: toolPerms,
      maxTurns: 15,
      defaultContextDepth: 'standard',
      icon,
      color,
      tools: agentTools,
    });
  }

  // Update CO with all detected tools
  co.tools = detectedTools.map(t => t.id);

  return { repoPath: graph.repoPath, agents, co };
}

/**
 * Get context for a specific agent based on context depth.
 */
export function getAgentContext(
  agent: AgentDefinition,
  graph: RoutingGraph,
  depth: ContextDepth,
): { context: string; files: string[]; folderPaths: string[] } {
  const parts: string[] = [];
  const files: string[] = [];
  const folderPaths: string[] = [];

  const root = graph.nodes.get(graph.rootNodeId);

  // Minimal: just CLAUDE.md
  if (root?.contextFile?.rawMarkdown) {
    parts.push(`## ${root.path}/CONTEXT.md\n${root.contextFile.rawMarkdown}`);
    files.push(root.path + '/CONTEXT.md');
  }
  if (depth === 'minimal') return { context: parts.join('\n\n---\n\n'), files, folderPaths };

  // Light: + L1 nodes
  if (root) {
    for (const childId of root.children) {
      const node = graph.nodes.get(childId);
      if (!node) continue;

      // CO sees all L1, workers only see their paths
      const isRelevant = agent.role === 'co' || agent.contextPaths.includes('*') ||
        agent.contextPaths.some(p => node.path.startsWith(p) || p.startsWith(node.path));

      if (isRelevant && node.contextFile?.rawMarkdown) {
        parts.push(`## ${node.path}/CONTEXT.md\n${node.contextFile.rawMarkdown}`);
        files.push(node.path + '/CONTEXT.md');
        folderPaths.push(node.path);
      }
    }
  }
  if (depth === 'light') return { context: parts.join('\n\n---\n\n'), files, folderPaths };

  // Standard: + relevant L2 children
  for (const [, node] of graph.nodes) {
    if (node.layer !== 2) continue;

    const isRelevant = agent.role === 'co' || agent.contextPaths.includes('*') ||
      agent.contextPaths.some(p => node.path.startsWith(p));

    if (isRelevant && node.contextFile?.rawMarkdown) {
      if (!files.includes(node.path + '/CONTEXT.md')) {
        parts.push(`## ${node.path}/CONTEXT.md\n${node.contextFile.rawMarkdown}`);
        files.push(node.path + '/CONTEXT.md');
        folderPaths.push(node.path);
      }
    }
  }
  if (depth === 'standard') return { context: parts.join('\n\n---\n\n'), files, folderPaths };

  // Heavy: + L3 references + dependency chain
  for (const [, node] of graph.nodes) {
    if (node.layer !== 3) continue;

    const isRelevant = agent.role === 'co' || agent.contextPaths.includes('*') ||
      agent.contextPaths.some(p => node.path.startsWith(p));

    if (isRelevant && node.contextFile?.rawMarkdown) {
      if (!files.includes(node.path + '/CONTEXT.md')) {
        parts.push(`## ${node.path}/CONTEXT.md\n${node.contextFile.rawMarkdown}`);
        files.push(node.path + '/CONTEXT.md');
        folderPaths.push(node.path);
      }
    }
  }

  // Follow dependency edges
  for (const edge of graph.edges) {
    if (edge.type !== 'depends_on') continue;
    const depNode = graph.nodes.get(edge.to);
    if (depNode?.contextFile?.rawMarkdown && !files.includes(depNode.path + '/CONTEXT.md')) {
      parts.push(`## ${depNode.path}/CONTEXT.md\n${depNode.contextFile.rawMarkdown}`);
      files.push(depNode.path + '/CONTEXT.md');
      folderPaths.push(depNode.path);
    }
  }
  if (depth === 'heavy') return { context: parts.join('\n\n---\n\n'), files, folderPaths };

  // Full: everything
  for (const [, node] of graph.nodes) {
    if (node.contextFile?.rawMarkdown && !files.includes(node.path + '/CONTEXT.md')) {
      parts.push(`## ${node.path}/CONTEXT.md\n${node.contextFile.rawMarkdown}`);
      files.push(node.path + '/CONTEXT.md');
      folderPaths.push(node.path);
    }
  }

  return { context: parts.join('\n\n---\n\n'), files, folderPaths };
}
