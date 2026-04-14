/**
 * Routing simulator store.
 * Takes a user query, traces the routing path through the graph,
 * and exposes the active path for visualization.
 */

import { writable, derived, get } from 'svelte/store';
import { graphStore } from './graph';
import type { RoutingNode } from '../types';

export interface SimulatorStep {
  nodeId: string;
  node: RoutingNode;
  layer: number;
  action: string;       // what happens at this step
  contextLoaded: string; // what file gets loaded
  reason: string;        // why this node was chosen
  delay: number;         // ms delay before this step activates
}

export interface TokenComparison {
  withKlonode: number;       // tokens loaded with routing
  withoutKlonode: number;    // tokens if AI reads everything
  saved: number;             // tokens saved
  savedPercent: number;      // percentage saved
  filesWithKlonode: number;  // files read with routing
  filesWithout: number;      // files AI would scan without routing
}

export interface SimulatorState {
  query: string;
  isRunning: boolean;
  steps: SimulatorStep[];
  activeStepIndex: number;  // -1 = not started, 0+ = current step
  completed: boolean;
  comparison: TokenComparison | null;
}

const initial: SimulatorState = {
  query: '',
  isRunning: false,
  steps: [],
  activeStepIndex: -1,
  completed: false,
  comparison: null,
};

export const simulatorStore = writable<SimulatorState>(initial);

// Derived: which node IDs are "lit up" (active or already visited)
export const activePathIds = derived(simulatorStore, ($sim) => {
  if (!$sim.isRunning && !$sim.completed) return new Set<string>();
  const ids = new Set<string>();
  for (let i = 0; i <= $sim.activeStepIndex; i++) {
    if ($sim.steps[i]) ids.add($sim.steps[i].nodeId);
  }
  return ids;
});

// Derived: the currently active node ID (the one "pulsing")
export const pulsingNodeId = derived(simulatorStore, ($sim) => {
  if (!$sim.isRunning) return null;
  const step = $sim.steps[$sim.activeStepIndex];
  return step?.nodeId || null;
});

// Keywords → directory name matching
const KEYWORD_MAP: Record<string, string[]> = {
  // UI/frontend
  component: ['components', 'ui', 'views', 'widgets'],
  button: ['components', 'ui'],
  form: ['components', 'ui'],
  page: ['pages', 'app', 'routes', 'views'],
  layout: ['layouts', 'app', 'components'],
  style: ['styles', 'css', 'theme'],
  css: ['styles', 'css'],
  modal: ['components', 'ui'],
  nav: ['components', 'layouts', 'app'],

  // Backend/API
  api: ['api', 'routes', 'handlers', 'server'],
  endpoint: ['api', 'routes', 'handlers'],
  route: ['routes', 'app', 'api'],
  server: ['server', 'api'],
  middleware: ['middleware'],
  auth: ['auth', 'middleware'],
  login: ['auth', 'app'],

  // Data
  database: ['db', 'database', 'prisma', 'models'],
  schema: ['prisma', 'schemas', 'models', 'types'],
  migration: ['prisma', 'migrations', 'db'],
  model: ['models', 'prisma', 'types'],
  query: ['db', 'prisma', 'services'],

  // Logic
  hook: ['hooks'],
  util: ['utils', 'helpers', 'lib'],
  service: ['services', 'lib'],
  helper: ['helpers', 'utils'],
  state: ['store', 'stores', 'state', 'context'],
  store: ['store', 'stores', 'state'],

  // Game
  game: ['game'],
  physics: ['game'],
  player: ['game'],

  // Testing
  test: ['tests', 'test', '__tests__'],
  spec: ['tests', 'test', 'spec'],

  // Config/Infra
  config: ['config', 'constants'],
  deploy: ['scripts', '.github'],
  ci: ['.github', 'scripts'],
  script: ['scripts'],
  doc: ['docs'],

  // Assets
  image: ['public', 'assets', 'static'],
  font: ['public', 'assets'],
  icon: ['public', 'assets', 'components'],
  type: ['types', 'interfaces'],
};

/**
 * Given a user query, find the routing path through the graph.
 */
function traceRoute(query: string): SimulatorStep[] {
  const graph = get(graphStore);
  if (!graph) return [];

  const root = graph.nodes.get(graph.rootNodeId);
  if (!root) return [];

  const steps: SimulatorStep[] = [];
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  // Step 1: Always start at root (L0 — CLAUDE.md)
  steps.push({
    nodeId: root.id,
    node: root,
    layer: 0,
    action: 'Les CLAUDE.md — finn riktig rute',
    contextLoaded: 'CLAUDE.md (~800 tokens)',
    reason: 'AI starter alltid her. Leser rutetabellen.',
    delay: 0,
  });

  // Step 2: Match query keywords to L1 directories
  const l1Nodes = root.children
    .map(id => graph.nodes.get(id))
    .filter((n): n is RoutingNode => n !== undefined);

  // Score each L1 node against the query
  const scored = l1Nodes.map(node => {
    let score = 0;
    const nameLower = node.name.toLowerCase();
    const summaryLower = (node.summary || '').toLowerCase();

    // Direct name match in query
    if (queryLower.includes(nameLower)) score += 10;

    // Keyword mapping
    for (const word of words) {
      const targets = KEYWORD_MAP[word];
      if (targets && targets.includes(nameLower)) score += 5;

      // Fuzzy: word appears in node name or summary
      if (nameLower.includes(word)) score += 3;
      if (summaryLower.includes(word)) score += 2;
    }

    return { node, score };
  });

  // Sort by score, take the best match
  scored.sort((a, b) => b.score - a.score);
  const bestMatch = scored[0];

  if (!bestMatch || bestMatch.score === 0) {
    // No match — show that routing failed, fall back to root context
    steps.push({
      nodeId: root.id,
      node: root,
      layer: 1,
      action: 'Ingen treff — les rot-CONTEXT.md',
      contextLoaded: 'CONTEXT.md (~300 tokens)',
      reason: `Ingen mappe matchet "${query}". AI leser rotkontekst.`,
      delay: 1200,
    });
    return steps;
  }

  // Step 2: Route to L1 (read root CONTEXT.md to confirm route)
  steps.push({
    nodeId: root.id,
    node: root,
    layer: 1,
    action: 'Les CONTEXT.md — bekreft rute',
    contextLoaded: 'CONTEXT.md (~300 tokens)',
    reason: `Rutetabellen peker mot "${bestMatch.node.name}/"`,
    delay: 1200,
  });

  // Step 3: Navigate to L1 directory
  const l1 = bestMatch.node;
  steps.push({
    nodeId: l1.id,
    node: l1,
    layer: 1,
    action: `Gå til ${l1.name}/ — les CONTEXT.md`,
    contextLoaded: `${l1.path}/CONTEXT.md (~300 tokens)`,
    reason: `Beste treff for "${query}" (${l1.summary || l1.name})`,
    delay: 2400,
  });

  // Step 4: Check if there's a deeper match in L2
  const l2Nodes = l1.children
    .map(id => graph.nodes.get(id))
    .filter((n): n is RoutingNode => n !== undefined);

  if (l2Nodes.length > 0) {
    // Score L2 nodes
    const l2Scored = l2Nodes.map(node => {
      let score = 0;
      const nameLower = node.name.toLowerCase();
      const summaryLower = (node.summary || '').toLowerCase();

      if (queryLower.includes(nameLower)) score += 10;
      for (const word of words) {
        if (nameLower.includes(word)) score += 3;
        if (summaryLower.includes(word)) score += 2;
      }
      return { node, score };
    });

    l2Scored.sort((a, b) => b.score - a.score);
    const bestL2 = l2Scored[0];

    if (bestL2 && bestL2.score > 0) {
      // Navigate deeper to L2
      steps.push({
        nodeId: bestL2.node.id,
        node: bestL2.node,
        layer: 2,
        action: `Gå til ${bestL2.node.name}/ — les stage-kontekst`,
        contextLoaded: `${bestL2.node.path}/CONTEXT.md (~400 tokens)`,
        reason: `Dypere match: "${bestL2.node.name}" i ${l1.name}/`,
        delay: 3600,
      });

      // Step 5: Load dependencies
      const deps = graph.edges.filter(
        e => e.from === bestL2.node.id && e.type === 'depends_on'
      );
      for (const dep of deps.slice(0, 2)) {
        const depNode = graph.nodes.get(dep.to);
        if (depNode) {
          steps.push({
            nodeId: depNode.id,
            node: depNode,
            layer: depNode.layer,
            action: `Last avhengighet: ${depNode.name}/`,
            contextLoaded: `${depNode.path}/ (relevante eksporter)`,
            reason: `${bestL2.node.name} importerer fra ${depNode.name}`,
            delay: 4800,
          });
        }
      }
    } else {
      // No L2 match — stay at L1, show what's available
      steps.push({
        nodeId: l1.id,
        node: l1,
        layer: 2,
        action: `Skann undermapper i ${l1.name}/`,
        contextLoaded: `Inputs/Outputs-tabell fra CONTEXT.md`,
        reason: `${l2Nodes.length} undermapper tilgjengelig`,
        delay: 3600,
      });
    }
  }

  // Final step: Load dependencies of the L1 node
  const l1Deps = graph.edges.filter(
    e => e.from === l1.id && e.type === 'depends_on'
  );
  for (const dep of l1Deps.slice(0, 2)) {
    const depNode = graph.nodes.get(dep.to);
    if (depNode && !steps.some(s => s.nodeId === depNode.id)) {
      steps.push({
        nodeId: depNode.id,
        node: depNode,
        layer: depNode.layer,
        action: `Last avhengighet: ${depNode.name}/`,
        contextLoaded: `${depNode.path}/ (relevante eksporter)`,
        reason: `${l1.name} importerer fra ${depNode.name}`,
        delay: steps.length * 1200,
      });
    }
  }

  return steps;
}

/**
 * Calculate token comparison: with Klonode vs without.
 * "Without" = AI reads all files in the repo trying to find context.
 * "With" = AI follows the routing and only reads what's needed.
 */
function calculateComparison(steps: SimulatorStep[]): TokenComparison {
  const graph = get(graphStore);
  if (!graph) return { withKlonode: 0, withoutKlonode: 0, saved: 0, savedPercent: 0, filesWithKlonode: 0, filesWithout: 0 };

  // With Klonode: sum up tokens from each step
  let withKlonode = 0;
  let filesWithKlonode = steps.length; // each step reads ~1 file
  for (const step of steps) {
    const match = step.contextLoaded.match(/~(\d+)/);
    withKlonode += match ? parseInt(match[1]) : 200;
  }

  // Without Klonode: AI would typically need to scan the whole repo
  // Estimate based on real file counts from the graph
  const totalFiles = graph.metadata.totalFiles || 0;
  const totalDirs = graph.metadata.totalDirectories || 0;

  // Without routing, Claude typically:
  // 1. Reads the whole project tree listing (~200 tokens)
  // 2. Reads README/docs trying to understand structure (~500 tokens)
  // 3. Reads multiple wrong files before finding the right ones (~300 tokens each)
  // 4. Reads all files in the target directory + parent dirs
  // Conservative estimate: AI reads ~30-40% of files at ~120 tokens avg
  const filesScanned = Math.max(15, Math.ceil(totalFiles * 0.35));
  const avgTokensPerFile = 120;
  const withoutKlonode = 200 + 500 + (filesScanned * avgTokensPerFile);

  const saved = withoutKlonode - withKlonode;
  const savedPercent = withoutKlonode > 0 ? Math.round((saved / withoutKlonode) * 100) : 0;

  return {
    withKlonode,
    withoutKlonode,
    saved: Math.max(0, saved),
    savedPercent: Math.max(0, savedPercent),
    filesWithKlonode,
    filesWithout: filesScanned,
  };
}

let animationTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Run the routing simulation for a given query.
 */
export function runSimulation(query: string): void {
  // Cancel any existing animation
  if (animationTimer) clearTimeout(animationTimer);

  const steps = traceRoute(query);
  const comparison = calculateComparison(steps);

  simulatorStore.set({
    query,
    isRunning: true,
    steps,
    activeStepIndex: -1,
    completed: false,
    comparison,
  });

  // Animate through steps
  function advanceStep(index: number) {
    if (index >= steps.length) {
      simulatorStore.update(s => ({ ...s, isRunning: false, completed: true }));
      return;
    }

    simulatorStore.update(s => ({ ...s, activeStepIndex: index }));

    const nextDelay = index < steps.length - 1
      ? (steps[index + 1].delay - steps[index].delay)
      : 0;

    if (nextDelay > 0) {
      animationTimer = setTimeout(() => advanceStep(index + 1), nextDelay);
    } else if (index < steps.length - 1) {
      animationTimer = setTimeout(() => advanceStep(index + 1), 1000);
    } else {
      animationTimer = setTimeout(() => {
        simulatorStore.update(s => ({ ...s, isRunning: false, completed: true }));
      }, 800);
    }
  }

  // Start after a brief delay
  animationTimer = setTimeout(() => advanceStep(0), 400);
}

/**
 * Reset the simulator.
 */
export function resetSimulation(): void {
  if (animationTimer) clearTimeout(animationTimer);
  simulatorStore.set(initial);
}
