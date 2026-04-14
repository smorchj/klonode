/**
 * Layer 2: Stage/directory CONTEXT.md generator.
 * Placed in each significant subdirectory.
 * Contains: file purposes, exports, API routes, patterns, dependencies.
 * Enriched with actual file content analysis (not just folder names).
 * 200-800 tokens, 25-120 lines max.
 */

import type { RoutingGraph, RoutingNode, Edge } from '../model/routing-graph.js';
import { enforceTokenBudget, enforceLineLimit } from './token-budget.js';
import { extractDirectoryContent, type DirectoryContent } from '../analyzer/content-extractor.js';
import type { ScanEntry } from '../analyzer/scanner.js';
import { getChecklistForDirectory, validateContext, ROOT_CHECKLIST, type ChecklistItem } from './context-checklist.js';

/** Cached scan entries for content extraction */
let scanEntryMap: Map<string, ScanEntry> | null = null;
let currentRepoRoot = '';

export function setContentExtractionContext(scanRoot: ScanEntry, repoRoot: string): void {
  currentRepoRoot = repoRoot;
  scanEntryMap = new Map();
  function walk(entry: ScanEntry) {
    if (entry.isDirectory) {
      scanEntryMap!.set(entry.relativePath, entry);
      for (const child of entry.children) walk(child);
    }
  }
  walk(scanRoot);
}

/**
 * Generate both light and full CONTEXT for a directory.
 * Light: minimal tokens, just routing hints (file names, key exports, purpose)
 * Full: comprehensive context with all functions, cross-refs, patterns, checklist
 */
export function generateLayer2(
  graph: RoutingGraph,
  nodeId: string,
): string | null {
  return generateLayer2Full(graph, nodeId);
}

export function generateLayer2Light(
  graph: RoutingGraph,
  nodeId: string,
): string | null {
  const node = graph.nodes.get(nodeId);
  if (!node || node.type === 'file') return null;
  if (node.layer < 1) return null;

  const childNodes = node.children.map(id => graph.nodes.get(id)!).filter(Boolean);
  const childDirs = childNodes.filter(n => n.type === 'directory');

  let dirContent: DirectoryContent | null = null;
  if (scanEntryMap && currentRepoRoot) {
    const scanEntry = scanEntryMap.get(node.path);
    if (scanEntry) dirContent = extractDirectoryContent(scanEntry, currentRepoRoot);
  }

  const lines: string[] = [];
  lines.push(`# ${node.name}`);
  lines.push(node.summary || node.path);
  lines.push('');

  // Just file names + one-liner purposes (ultra compact)
  if (dirContent && dirContent.filePurposes.size > 0) {
    for (const [file, purpose] of dirContent.filePurposes) {
      lines.push(`- \`${file}\` — ${purpose}`);
    }
    lines.push('');
  }

  // Key exports — just names, no signatures, max 8
  if (dirContent && dirContent.exports.length > 0) {
    const names = dirContent.exports.slice(0, 8).map(e => e.name);
    if (dirContent.exports.length > 8) names.push(`+${dirContent.exports.length - 8}`);
    lines.push(`Exports: ${names.join(', ')}`);
    lines.push('');
  }

  // Subdirs — one line
  if (childDirs.length > 0) {
    lines.push(`Subdirs: ${childDirs.map(d => d.name).join(', ')}`);
  }

  let content = lines.join('\n');
  content = enforceTokenBudget(content, 300);
  return content;
}

export function generateLayer2Full(
  graph: RoutingGraph,
  nodeId: string,
): string | null {
  const node = graph.nodes.get(nodeId);
  if (!node || node.type === 'file') return null;
  if (node.layer < 1) return null;

  const childNodes = node.children
    .map(id => graph.nodes.get(id)!)
    .filter(Boolean);

  const childDirs = childNodes.filter(n => n.type === 'directory');
  const childFiles = childNodes.filter(n => n.type === 'file');

  const incomingDeps = graph.edges.filter(e => e.to === nodeId && e.type === 'depends_on');
  const outgoingDeps = graph.edges.filter(e => e.from === nodeId && e.type === 'depends_on');

  let dirContent: DirectoryContent | null = null;
  if (scanEntryMap && currentRepoRoot) {
    const scanEntry = scanEntryMap.get(node.path);
    if (scanEntry) {
      dirContent = extractDirectoryContent(scanEntry, currentRepoRoot);
    }
  }

  const lines: string[] = [];

  // Header with clear summary
  lines.push(`# ${node.name}`);
  lines.push('');
  lines.push(node.summary || `Directory: ${node.path}`);
  lines.push('');

  // API Routes — full detail
  if (dirContent && dirContent.apiRoutes.length > 0) {
    lines.push('## API Routes');
    for (const route of dirContent.apiRoutes) {
      lines.push(`- **${route.method}** — ${route.handler}`);
    }
    lines.push('');
  }

  // Files — every file with a clear description
  if (dirContent && dirContent.filePurposes.size > 0) {
    lines.push('## Files');
    for (const [file, purpose] of dirContent.filePurposes) {
      lines.push(`- \`${file}\` — ${purpose}`);
    }
    lines.push('');
  }

  // Exports — list ALL functions and types (the whole point of context)
  if (dirContent && dirContent.exports.length > 0) {
    lines.push('## Exports');
    const grouped = new Map<string, string[]>();
    for (const exp of dirContent.exports) {
      const kind = exp.kind;
      if (!grouped.has(kind)) grouped.set(kind, []);
      const label = exp.signature ? `${exp.name}${exp.signature}` : exp.name;
      grouped.get(kind)!.push(label);
    }
    for (const [kind, names] of grouped) {
      // Show up to 15 per kind — context needs to be thorough
      const shown = names.slice(0, 15);
      if (names.length > 15) shown.push(`+${names.length - 15} more`);
      lines.push(`- **${kind}**: ${shown.join(', ')}`);
    }
    lines.push('');
  }

  // Patterns
  if (dirContent && dirContent.patterns.length > 0) {
    lines.push('## Patterns');
    for (const pattern of dirContent.patterns) {
      lines.push(`- ${pattern}`);
    }
    lines.push('');
  }

  // Dependencies — what this directory imports from
  if (outgoingDeps.length > 0 || (dirContent && dirContent.externalImports.length > 0)) {
    lines.push('## Dependencies');
    for (const dep of outgoingDeps) {
      const targetNode = graph.nodes.get(dep.to);
      if (targetNode) {
        lines.push(`- \`${targetNode.path}/\` (${dep.weight} imports)`);
      }
    }
    if (dirContent) {
      for (const imp of dirContent.externalImports.slice(0, 10)) {
        lines.push(`- \`${imp}\``);
      }
    }
    lines.push('');
  }

  // Related directories — cross-references for context Claude needs
  const relatedDirs = findRelatedDirectories(graph, node, childDirs, outgoingDeps, incomingDeps);
  if (relatedDirs.length > 0) {
    lines.push('## Related');
    for (const rel of relatedDirs) {
      lines.push(`- \`${rel.path}/\` — ${rel.reason}`);
    }
    lines.push('');
  }

  // Subdirectories
  if (childDirs.length > 0) {
    lines.push('## Subdirectories');
    for (const dir of childDirs) {
      lines.push(`- \`${dir.name}/\` — ${dir.summary || 'subdirectory'}`);
    }
    lines.push('');
  }

  // Used by
  if (incomingDeps.length > 0) {
    lines.push('## Used By');
    for (const dep of incomingDeps.slice(0, 8)) {
      const sourceNode = graph.nodes.get(dep.from);
      if (sourceNode) {
        lines.push(`- \`${sourceNode.path}/\` (${dep.weight} imports)`);
      }
    }
    if (incomingDeps.length > 8) {
      lines.push(`- +${incomingDeps.length - 8} more`);
    }
    lines.push('');
  }

  // Validate against checklist — add notes for missing sections
  const checklist = getChecklistForDirectory(node.name, node.path);
  if (checklist.length > 0) {
    const { missing } = validateContext(lines.join('\n'), checklist);
    if (missing.length > 0) {
      lines.push('## Notes');
      for (const item of missing) {
        lines.push(`- TODO: Add ${item.heading} — ${item.description}`);
      }
      lines.push('');
    }
  }

  let content = lines.join('\n');
  // Increased limits: context should be thorough, not minimal
  content = enforceLineLimit(content, 200);
  content = enforceTokenBudget(content, 1500);
  return content;
}

/**
 * Find directories related to this one that should be cross-referenced.
 * E.g., admin → creator, api/game → game engine, components/forum → app/forum
 */
function findRelatedDirectories(
  graph: RoutingGraph,
  node: RoutingNode,
  childDirs: RoutingNode[],
  outgoingDeps: Edge[],
  incomingDeps: Edge[],
): { path: string; reason: string }[] {
  const related: { path: string; reason: string }[] = [];
  const seen = new Set<string>([node.id]);

  // Add all dependency targets not already listed
  for (const dep of outgoingDeps) {
    if (seen.has(dep.to)) continue;
    seen.add(dep.to);
    const target = graph.nodes.get(dep.to);
    if (target && target.layer <= 2) {
      related.push({ path: target.path, reason: `imports ${dep.weight} symbols` });
    }
  }

  // Name-based relationships
  const nameLower = node.name.toLowerCase();
  const knownRelations: Record<string, string[]> = {
    admin: ['creator', 'auth', 'api/admin'],
    creator: ['admin', 'components/creator', 'api/creator'],
    game: ['components', 'api/game', 'public/assets'],
    forum: ['components/forum', 'api/forum'],
    auth: ['api/auth', 'lib/auth', 'middleware'],
    api: ['lib', 'prisma'],
    components: ['app', 'hooks', 'lib'],
    prisma: ['lib', 'api'],
    scripts: ['lib', 'prisma'],
  };

  const targets = knownRelations[nameLower] || [];
  for (const targetName of targets) {
    for (const [, n] of graph.nodes) {
      if (seen.has(n.id)) continue;
      if (n.path === targetName || n.path.endsWith('/' + targetName) || n.name === targetName) {
        seen.add(n.id);
        related.push({ path: n.path, reason: 'related by purpose' });
        break;
      }
    }
  }

  return related.slice(0, 8);
}

function generateProcessSteps(
  node: RoutingNode,
  childDirs: RoutingNode[],
  childFiles: RoutingNode[],
): string[] {
  const steps: string[] = [];
  const name = node.name.toLowerCase();

  // Generic steps based on directory purpose
  steps.push(`Understand the purpose of \`${node.name}/\``);

  if (childDirs.length > 0) {
    steps.push(
      `Review subdirectories: ${childDirs.map(d => d.name).join(', ')}`,
    );
  }

  if (childFiles.length > 0) {
    const keyFiles = childFiles
      .filter(f => f.name.match(/^(index|main|app|mod|lib)\./i))
      .map(f => f.name);
    if (keyFiles.length > 0) {
      steps.push(`Start with entry point(s): ${keyFiles.join(', ')}`);
    }
  }

  // Purpose-specific steps
  if (name.includes('test') || name.includes('spec')) {
    steps.push('Identify which tests cover the area you are modifying');
    steps.push('Run relevant tests before and after changes');
  } else if (name.includes('api') || name.includes('route') || name.includes('handler')) {
    steps.push('Check endpoint definitions and request/response types');
    steps.push('Verify middleware chain if applicable');
  } else if (name.includes('component')) {
    steps.push('Check component props and interfaces');
    steps.push('Look for shared styles or theme usage');
  } else if (name.includes('model') || name.includes('schema') || name.includes('type')) {
    steps.push('Check for downstream consumers of these types');
    steps.push('Ensure changes are backwards compatible');
  } else {
    steps.push('Make the required changes following existing patterns');
  }

  steps.push('Verify changes do not break dependent code');

  return steps;
}

/**
 * Generate Layer 2 CONTEXT.md for all eligible directories.
 * Returns both light and full versions.
 */
export function generateAllLayer2(
  graph: RoutingGraph,
): Map<string, string> {
  const results = new Map<string, string>();

  for (const [id, node] of graph.nodes) {
    if (node.layer >= 1 && node.type === 'directory') {
      const content = generateLayer2Full(graph, id);
      if (content) {
        results.set(node.path, content);
      }
    }
  }

  return results;
}

/**
 * Generate both light and full CONTEXT for all directories.
 * Light files: CONTEXT.light.md — minimal tokens for simple tasks
 * Full files: CONTEXT.md — comprehensive for complex tasks
 */
export function generateAllLayer2Dual(
  graph: RoutingGraph,
): { light: Map<string, string>; full: Map<string, string> } {
  const light = new Map<string, string>();
  const full = new Map<string, string>();

  for (const [id, node] of graph.nodes) {
    if (node.layer >= 1 && node.type === 'directory') {
      const lightContent = generateLayer2Light(graph, id);
      const fullContent = generateLayer2Full(graph, id);
      if (lightContent) light.set(node.path, lightContent);
      if (fullContent) full.set(node.path, fullContent);
    }
  }

  return { light, full };
}
