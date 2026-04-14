/**
 * Layer 0: CLAUDE.md generator.
 * This is the "DNS" of the routing system — always loaded by Claude.
 * Kept lean (~800 tokens). Contains: folder map, triggers, routing table, load rules.
 */

import type { RoutingGraph, RoutingNode } from '../model/routing-graph.js';
import { enforceTokenBudget } from './token-budget.js';

/**
 * Generate the root CLAUDE.md content.
 */
export function generateLayer0(graph: RoutingGraph): string {
  const root = graph.nodes.get(graph.rootNodeId)!;
  const topLevelDirs = root.children
    .map(id => graph.nodes.get(id)!)
    .filter(Boolean)
    .filter(n => n.type === 'directory');

  const lines: string[] = [];

  // Header
  lines.push(`# ${graph.metadata.repoName}`);
  lines.push('');
  lines.push(`> Auto-generated routing by Klonode. ${graph.metadata.totalFiles} files across ${graph.metadata.totalDirectories} directories.`);
  lines.push('');

  // Folder map (ASCII tree of top-level dirs)
  lines.push('## Folder Map');
  lines.push('```');
  lines.push(`${graph.metadata.repoName}/`);
  for (const dir of topLevelDirs) {
    const indicator = dir.children.length > 0 ? '/' : '';
    const summary = dir.summary ? ` — ${truncate(dir.summary, 60)}` : '';
    lines.push(`  ${dir.name}${indicator}${summary}`);
  }
  lines.push('```');
  lines.push('');

  // Triggers
  lines.push('## Triggers');
  lines.push('- `setup` — Run initial Klonode configuration');
  lines.push('- `status` — Show routing health and coverage');
  lines.push('- `optimize` — Run self-improvement on routing');
  lines.push('');

  // Routing table
  lines.push('## Routing');
  lines.push('| Task | Go To | Load |');
  lines.push('|------|-------|------|');

  for (const dir of topLevelDirs) {
    const taskHint = inferTaskFromDir(dir);
    if (taskHint) {
      lines.push(`| ${taskHint} | \`${dir.path}/CONTEXT.md\` | Stage context only |`);
    }
  }
  lines.push('');

  // What to load / not load
  lines.push('## Context Rules');
  lines.push('- Read the CONTEXT.md in the target directory FIRST');
  lines.push('- Only load files listed in the Inputs table of that CONTEXT.md');
  lines.push('- Do NOT load files from unrelated directories');
  lines.push('- Do NOT read entire directories — use selective section routing');
  lines.push('- Keep total context under 8,000 tokens per task');
  lines.push('');

  // Languages
  const langs = Object.entries(graph.metadata.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (langs.length > 0) {
    lines.push('## Languages');
    lines.push(langs.map(([lang, count]) => `${lang} (${count})`).join(', '));
    lines.push('');
  }

  const content = lines.join('\n');
  return enforceTokenBudget(content, 800);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function inferTaskFromDir(node: RoutingNode): string | null {
  const name = node.name.toLowerCase();

  const taskMap: Record<string, string> = {
    src: 'Write or modify code',
    lib: 'Work with shared libraries',
    app: 'Modify application routes/pages',
    api: 'Work with API endpoints',
    components: 'Create or edit UI components',
    pages: 'Modify pages/views',
    routes: 'Edit route handlers',
    tests: 'Write or run tests',
    test: 'Write or run tests',
    docs: 'Update documentation',
    config: 'Modify configuration',
    scripts: 'Edit build/utility scripts',
    styles: 'Modify styles/CSS',
    database: 'Database schema/migrations',
    db: 'Database schema/migrations',
    prisma: 'Database schema/migrations',
    auth: 'Authentication/authorization',
    services: 'Business logic services',
    middleware: 'Edit middleware',
    hooks: 'Modify hooks',
    utils: 'Utility functions',
    public: 'Static assets',
    i18n: 'Translations/localization',
    store: 'State management',
    stores: 'State management',
  };

  return taskMap[name] || null;
}
