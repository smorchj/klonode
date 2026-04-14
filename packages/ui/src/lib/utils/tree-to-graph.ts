/**
 * Transform the routing graph into Svelte Flow node/edge format.
 * Proper hierarchical layout with centered children under parents.
 */

import type { RoutingGraph, RoutingNode, Edge as RoutingEdge, LayerLevel } from '../types';

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    summary: string;
    layer: LayerLevel;
    language: string | null;
    tokenBudget: number;
    accessCount: number;
    heatValue: number;
    hasContext: boolean;
    manuallyEdited: boolean;
    childCount: number;
    path: string;
  };
  parentId?: string;
  style?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  animated: boolean;
  style?: string;
  label?: string;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 70;
const H_GAP = 30; // horizontal gap between sibling nodes
const V_GAP = 100; // vertical gap between layers
const EXPANDED_V_GAP = 80; // gap for expanded L2 children
const MAX_COLS = 6; // max children per row before wrapping

/**
 * Convert routing graph to Svelte Flow format with proper hierarchical layout.
 */
export function routingGraphToFlow(
  graph: RoutingGraph,
  heatmap: Map<string, number> = new Map(),
  expandedGroups: Set<string> = new Set(),
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const flowNodes: FlowNode[] = [];
  const flowEdges: FlowEdge[] = [];

  const root = graph.nodes.get(graph.rootNodeId);
  if (!root) return { nodes: [], edges: [] };

  // Gather L1 children
  const layer1Nodes = root.children
    .map(id => graph.nodes.get(id))
    .filter((n): n is RoutingNode => n !== undefined);

  // For each expanded L1 node, gather its L2 children
  const l1ChildMap = new Map<string, RoutingNode[]>();
  for (const l1 of layer1Nodes) {
    if (expandedGroups.has(l1.id)) {
      const children = l1.children
        .map(id => graph.nodes.get(id))
        .filter((n): n is RoutingNode => n !== undefined);
      if (children.length > 0) {
        l1ChildMap.set(l1.id, children);
      }
    }
  }

  // Wrap L1 children into rows of MAX_COLS
  const rows: RoutingNode[][] = [];
  for (let i = 0; i < layer1Nodes.length; i += MAX_COLS) {
    rows.push(layer1Nodes.slice(i, i + MAX_COLS));
  }

  // Position root at top center
  const rootX = -NODE_WIDTH / 2;
  const rootY = 0;
  flowNodes.push(createFlowNode(root, { x: rootX, y: rootY }, heatmap));

  // Place each row of L1 nodes
  let currentY = V_GAP + NODE_HEIGHT;
  const l1Positions = new Map<string, { x: number; y: number }>();

  for (const row of rows) {
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * H_GAP;
    let x = -rowWidth / 2;

    for (const l1 of row) {
      l1Positions.set(l1.id, { x, y: currentY });
      flowNodes.push(createFlowNode(l1, { x, y: currentY }, heatmap));
      x += NODE_WIDTH + H_GAP;
    }

    // Check if any node in this row is expanded — if so, add space for children
    let rowHasExpanded = false;
    for (const l1 of row) {
      const children = l1ChildMap.get(l1.id);
      if (children && children.length > 0) {
        rowHasExpanded = true;
        const pos = l1Positions.get(l1.id)!;
        const childRows: RoutingNode[][] = [];
        for (let i = 0; i < children.length; i += MAX_COLS) {
          childRows.push(children.slice(i, i + MAX_COLS));
        }
        let childY = currentY + NODE_HEIGHT + EXPANDED_V_GAP;
        for (const cRow of childRows) {
          const cRowWidth = cRow.length * NODE_WIDTH + (cRow.length - 1) * H_GAP;
          const parentCenterX = pos.x + NODE_WIDTH / 2;
          let childX = parentCenterX - cRowWidth / 2;
          for (const child of cRow) {
            const flowNode = createFlowNode(child, { x: childX, y: childY }, heatmap);
            flowNode.parentId = l1.id;
            flowNodes.push(flowNode);
            childX += NODE_WIDTH + H_GAP;
          }
          childY += NODE_HEIGHT + H_GAP;
        }
      }
    }

    currentY += NODE_HEIGHT + V_GAP;
    if (rowHasExpanded) {
      currentY += (NODE_HEIGHT + EXPANDED_V_GAP);
    }
  }

  // Convert edges — only include edges where both endpoints are visible
  const visibleIds = new Set(flowNodes.map(n => n.id));
  for (const edge of graph.edges) {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
    flowEdges.push(createFlowEdge(edge));
  }

  return { nodes: flowNodes, edges: flowEdges };
}

function createFlowNode(
  node: RoutingNode,
  position: { x: number; y: number },
  heatmap: Map<string, number>,
): FlowNode {
  const heatValue = heatmap.get(node.id) || 0;

  return {
    id: node.id,
    type: node.layer <= 1 ? 'layerNode' : 'stageNode',
    position,
    data: {
      label: node.name,
      summary: node.summary,
      layer: node.layer,
      language: node.language,
      tokenBudget: node.tokenBudget,
      accessCount: node.telemetry.accessCount,
      heatValue,
      hasContext: node.contextFile !== null,
      manuallyEdited: node.contextFile?.manuallyEdited || false,
      childCount: node.children.length,
      path: node.path,
    },
  };
}

function createFlowEdge(edge: RoutingEdge): FlowEdge {
  const isDepEdge = edge.type === 'depends_on' || edge.type === 'references';

  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: isDepEdge ? 'smoothstep' : 'default',
    animated: edge.type === 'routes_to',
    label: isDepEdge ? `${edge.weight}` : undefined,
    style: `stroke: ${edgeColor(edge.type)}`,
  };
}

function edgeColor(type: string): string {
  switch (type) {
    case 'contains': return '#6b7280';
    case 'references': return '#3b82f6';
    case 'depends_on': return '#f59e0b';
    case 'routes_to': return '#10b981';
    default: return '#9ca3af';
  }
}
