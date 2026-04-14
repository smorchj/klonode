/**
 * Layer 1: Top-level CONTEXT.md generator.
 * Placed at the repo root. Routes tasks to the correct top-level directory.
 * ~300 tokens max.
 */

import type { RoutingGraph } from '../model/routing-graph.js';
import { enforceTokenBudget } from './token-budget.js';

export function generateLayer1(graph: RoutingGraph): string {
  const root = graph.nodes.get(graph.rootNodeId)!;
  const topLevelDirs = root.children
    .map(id => graph.nodes.get(id)!)
    .filter(Boolean)
    .filter(n => n.type === 'directory');

  const lines: string[] = [];

  lines.push(`# ${graph.metadata.repoName} — Task Routing`);
  lines.push('');
  lines.push('Use this table to find the right workspace for your task.');
  lines.push('');

  // Task routing table
  lines.push('## Workspaces');
  lines.push('| Directory | Purpose | When to Go Here |');
  lines.push('|-----------|---------|-----------------|');

  for (const dir of topLevelDirs) {
    const purpose = dir.summary || dir.name;
    const when = inferWhenToVisit(dir.name);
    lines.push(`| \`${dir.path}/\` | ${truncate(purpose, 40)} | ${when} |`);
  }

  lines.push('');

  // Shared resources
  const sharedDirs = topLevelDirs.filter(d =>
    ['config', 'shared', 'types', 'utils', 'lib', 'constants'].includes(d.name.toLowerCase()),
  );

  if (sharedDirs.length > 0) {
    lines.push('## Shared Resources');
    lines.push('These directories are referenced by multiple workspaces:');
    for (const dir of sharedDirs) {
      lines.push(`- \`${dir.path}/\` — ${dir.summary || dir.name}`);
    }
    lines.push('');
  }

  const content = lines.join('\n');
  return enforceTokenBudget(content, 300);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function inferWhenToVisit(dirName: string): string {
  const map: Record<string, string> = {
    src: 'Any code changes',
    lib: 'Shared code modifications',
    app: 'App routes or pages',
    api: 'API work',
    components: 'UI component work',
    pages: 'Page changes',
    routes: 'Route changes',
    tests: 'Testing',
    test: 'Testing',
    docs: 'Documentation updates',
    config: 'Config changes',
    scripts: 'Script modifications',
    styles: 'Style changes',
    public: 'Static asset changes',
    database: 'DB schema/migration',
    db: 'DB schema/migration',
    prisma: 'DB schema/migration',
    auth: 'Auth changes',
    services: 'Business logic',
    middleware: 'Middleware changes',
    i18n: 'Translation work',
    store: 'State management',
    stores: 'State management',
  };
  return map[dirName.toLowerCase()] || 'Related work';
}
