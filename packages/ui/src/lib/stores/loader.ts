/**
 * Loads a routing graph from JSON and hydrates it into the proper Map-based structure.
 * Handles both static demo data and future API endpoints.
 */

import { graphStore } from './graph';
import type { RoutingGraph, RoutingNode, ContextFile } from '../types';

interface SerializedGraph {
  id: string;
  repoPath: string;
  rootNodeId: string;
  nodes: Record<string, RoutingNode>;
  edges: any[];
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

/**
 * Load graph from a URL (static JSON file or API endpoint).
 */
export async function loadGraphFromUrl(url: string): Promise<void> {
  const response = await fetch(url);
  const data: SerializedGraph = await response.json();
  const graph = hydrateGraph(data);
  graphStore.set(graph);
}

/**
 * Load the graph for the project the Workstation backend is running in.
 * Tries `/api/graph/current` first (which reads `.klonode/graph.json` from
 * the server cwd), and falls back to `/demo-graph.json` if no real graph
 * exists. This means a fresh user who has run `klonode init` in their
 * project sees the real tree, not a fake `demo-project`. See #64 /
 * self-hosting survival work.
 */
export async function loadGraphForCurrentProject(): Promise<
  'real' | 'demo'
> {
  try {
    const res = await fetch('/api/graph/current');
    if (res.ok) {
      const data: SerializedGraph = await res.json();
      graphStore.set(hydrateGraph(data));
      return 'real';
    }
  } catch {
    // fall through to demo
  }
  await loadGraphFromUrl('/demo-graph.json');
  return 'demo';
}

/**
 * Convert serialized JSON into a proper RoutingGraph with Maps.
 */
function hydrateGraph(data: SerializedGraph): RoutingGraph {
  const nodes = new Map<string, RoutingNode>();

  for (const [id, node] of Object.entries(data.nodes)) {
    // Ensure telemetry exists
    if (!node.telemetry) {
      node.telemetry = {
        accessCount: 0,
        lastAccessed: null,
        avgTokensConsumed: 0,
        taskTypes: { feature: 0, bugfix: 0, refactor: 0, test: 0, docs: 0, config: 0, unknown: 0 },
        effectivenessScore: 0,
      };
    }

    // Normalize path separators to forward slashes. The graph.json is
    // generated on whatever platform built it (Windows serializes with
    // backslashes). The live activity watcher normalizes every tool_use
    // path to forward slashes via activity.normalizePath — if we don't
    // normalize the graph side too, the `activeNodePaths.get(node.path)`
    // lookup in GraphView/TreeNode fails and pulse rings never render.
    if (typeof node.path === 'string') {
      node.path = node.path.replace(/\\/g, '/');
    }

    // Generate contextFile preview from node data if missing
    if (!node.contextFile && node.type !== 'file') {
      node.contextFile = buildContextPreview(node, data);
    }

    nodes.set(id, node);
  }

  return {
    id: data.id,
    repoPath: data.repoPath,
    rootNodeId: data.rootNodeId,
    nodes,
    edges: data.edges || [],
    metadata: {
      ...data.metadata,
      generatedAt: new Date(data.metadata.generatedAt),
      lastOptimized: data.metadata.lastOptimized ? new Date(data.metadata.lastOptimized) : null,
    },
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}

/**
 * Build a contextFile preview from existing node data.
 * This synthesizes CONTEXT.md content from the graph structure
 * so the editor panel has something useful to show.
 */
function buildContextPreview(node: RoutingNode, data: SerializedGraph): ContextFile {
  const children = (node.children || [])
    .map(id => data.nodes[id])
    .filter(Boolean);

  const childDirs = children.filter(c => c.type === 'directory');
  const childFiles = children.filter(c => c.type === 'file');

  // Find dependencies
  const outDeps = (data.edges || []).filter(
    (e: any) => e.from === node.id && e.type === 'depends_on'
  );
  const inDeps = (data.edges || []).filter(
    (e: any) => e.to === node.id && e.type === 'depends_on'
  );

  const lines: string[] = [];

  // Header
  lines.push(`# ${node.name}`);
  lines.push('');
  lines.push(node.summary || `Directory: ${node.path}`);
  lines.push('');

  // Inputs
  lines.push('## Inputs');
  lines.push('| Kilde | Fil/Lokasjon | Seksjon | Hvorfor |');
  lines.push('|-------|-------------|---------|---------|');

  if (outDeps.length > 0) {
    for (const dep of outDeps.slice(0, 5)) {
      const target = data.nodes[dep.to];
      if (target) {
        lines.push(`| Avhengighet | \`${target.path}/\` | Relevante eksporter | ${dep.weight} import(er) |`);
      }
    }
  } else if (node.parent) {
    const parent = data.nodes[node.parent];
    if (parent) {
      lines.push(`| Forelder | \`${parent.path}/CONTEXT.md\` | Rutetabell | Navigasjonskontekst |`);
    }
  }
  lines.push('');

  // Process
  lines.push('## Prosess');
  let stepNum = 1;
  lines.push(`${stepNum++}. Forstå formålet med \`${node.name}/\``);

  if (childDirs.length > 0) {
    lines.push(`${stepNum++}. Gjennomgå undermapper: ${childDirs.map(d => d.name).join(', ')}`);
  }

  const keyFiles = childFiles.filter(f =>
    f.name.match(/^(index|main|app|mod|lib|server|page|layout)\./i)
  );
  if (keyFiles.length > 0) {
    lines.push(`${stepNum++}. Start med inngangspunkt: ${keyFiles.map(f => f.name).join(', ')}`);
  }

  const name = node.name.toLowerCase();
  if (name.includes('test') || name.includes('spec')) {
    lines.push(`${stepNum++}. Identifiser hvilke tester som dekker området du endrer`);
    lines.push(`${stepNum++}. Kjør relevante tester før og etter endringer`);
  } else if (name.includes('api') || name.includes('route') || name.includes('handler')) {
    lines.push(`${stepNum++}. Sjekk endepunktdefinisjoner og request/response-typer`);
    lines.push(`${stepNum++}. Verifiser middleware-kjede om aktuelt`);
  } else if (name.includes('component')) {
    lines.push(`${stepNum++}. Sjekk komponent-props og grensesnitt`);
    lines.push(`${stepNum++}. Se etter delte stiler eller tema-bruk`);
  } else if (name.includes('model') || name.includes('schema') || name.includes('type')) {
    lines.push(`${stepNum++}. Sjekk for nedstrøms forbrukere av disse typene`);
    lines.push(`${stepNum++}. Sørg for at endringer er bakoverkompatible`);
  } else if (name.includes('game') || name.includes('physics')) {
    lines.push(`${stepNum++}. Forstå spillmekanikk og fysikkmotor`);
    lines.push(`${stepNum++}. Test endringer i spilløkten`);
  } else {
    lines.push(`${stepNum++}. Gjør nødvendige endringer etter eksisterende mønstre`);
  }
  lines.push(`${stepNum++}. Verifiser at endringer ikke bryter avhengig kode`);
  lines.push('');

  // Outputs
  lines.push('## Outputs');
  if (childDirs.length > 0 || keyFiles.length > 0) {
    lines.push('| Artefakt | Lokasjon | Format |');
    lines.push('|----------|----------|--------|');
    for (const dir of childDirs.slice(0, 8)) {
      lines.push(`| ${dir.name} | \`${dir.path}/\` | Mappe |`);
    }
    for (const file of keyFiles.slice(0, 4)) {
      lines.push(`| ${file.name} | \`${file.path}\` | ${file.language || 'Fil'} |`);
    }
  } else {
    lines.push('Ingen outputs definert ennå.');
  }
  lines.push('');

  // Dependents
  if (inDeps.length > 0) {
    lines.push('## Brukes av');
    for (const dep of inDeps.slice(0, 5)) {
      const source = data.nodes[dep.from];
      if (source) {
        lines.push(`- \`${source.path}/\` (${dep.weight} import(er))`);
      }
    }
    lines.push('');
  }

  const rawMarkdown = lines.join('\n');

  return {
    inputs: outDeps.map((d: any) => ({
      source: 'Dependency',
      fileOrLocation: data.nodes[d.to]?.path || '',
      sectionScope: 'Relevant exports',
      why: `${d.weight} import(s)`,
    })),
    process: [`Forstå formålet med ${node.name}/`, 'Gjennomgå undermapper', 'Gjør endringer'],
    outputs: childDirs.map(d => ({
      artifact: d.name,
      location: `${d.path}/`,
      format: 'Directory',
    })),
    rawMarkdown,
    lineCount: lines.length,
    tokenCount: Math.ceil(rawMarkdown.length / 4),
    lastGenerated: new Date(),
    manuallyEdited: false,
  };
}
