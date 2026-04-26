/**
 * `klonode status` — Show routing health, coverage, and telemetry summary.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

// Layers we expect to carry a CONTEXT.md. Layer 0 is the root CLAUDE.md and
// layers 3-4 (references / artifacts) are leaf attachments without their own
// CONTEXT.md, so they don't count toward coverage gaps.
const CONTEXT_BEARING_LAYERS = new Set<number>([1, 2]);

const LAYER_LABELS = [
  'CLAUDE.md (root)',
  'CONTEXT.md (top)',
  'CONTEXT.md (stage)',
  'References',
  'Artifacts',
];

export async function statusCommand(
  repoPath: string,
  options: { security?: boolean } = {},
): Promise<void> {
  const {
    loadGraph,
    loadConfig,
    buildDirAccessMap,
    listSessions,
    scanRepositoryForInjection,
    formatInjectionReport,
  } = await import('@klonode/core');

  const resolved = path.resolve(repoPath);
  const graph = loadGraph(resolved);

  if (!graph) {
    console.log(chalk.yellow('\n⚠ No Klonode routing found.'));
    console.log(chalk.gray('Run `klonode init` to generate routing for this project.\n'));
    return;
  }

  const config = loadConfig(resolved);

  console.log(chalk.blue.bold('\n⟐ Klonode Status\n'));
  console.log(chalk.white(`Project: ${graph.metadata.repoName}`));
  console.log(chalk.gray(`Mode: ${config.mode}`));
  console.log(chalk.gray(`Generated: ${formatGeneratedAt(graph.metadata.generatedAt)}`));
  console.log('');

  // Node + token counts per layer + coverage gaps.
  const layerCounts = new Map<number, number>();
  const tokensByLayer = new Map<number, number>();
  const coverageGaps: string[] = [];
  let nodesWithContext = 0;
  let manuallyEdited = 0;

  for (const node of graph.nodes.values()) {
    layerCounts.set(node.layer, (layerCounts.get(node.layer) || 0) + 1);
    if (node.contextFile) {
      nodesWithContext++;
      tokensByLayer.set(
        node.layer,
        (tokensByLayer.get(node.layer) ?? 0) + node.contextFile.tokenCount,
      );
      if (node.contextFile.manuallyEdited) manuallyEdited++;
    } else if (CONTEXT_BEARING_LAYERS.has(node.layer)) {
      coverageGaps.push(node.path);
    }
  }

  console.log(chalk.white('Routing Coverage:'));
  for (const [layer, count] of Array.from(layerCounts.entries()).sort()) {
    const label = LAYER_LABELS[layer] ?? `Layer ${layer}`;
    const tokens = tokensByLayer.get(layer) ?? 0;
    const tokenSuffix = tokens > 0 ? `, ${formatTokens(tokens)} tokens` : '';
    console.log(chalk.gray(`  Layer ${layer} (${label}): ${count} nodes${tokenSuffix}`));
  }

  console.log(chalk.gray(`  Nodes with CONTEXT.md: ${nodesWithContext}`));
  console.log(chalk.gray(`  Manually edited: ${manuallyEdited}`));
  console.log('');

  // Coverage gaps: directories that should have a CONTEXT.md but don't.
  if (coverageGaps.length > 0) {
    console.log(chalk.white(`Coverage gaps: ${coverageGaps.length} director${coverageGaps.length === 1 ? 'y' : 'ies'} without CONTEXT.md`));
    const sortedGaps = [...coverageGaps].sort();
    for (const gap of sortedGaps.slice(0, 10)) {
      console.log(chalk.yellow(`  ${gap}`));
    }
    if (sortedGaps.length > 10) {
      console.log(chalk.gray(`  …and ${sortedGaps.length - 10} more`));
    }
    console.log('');
  }

  // Stale-graph warning: any source file newer than graph.json invalidates
  // the routing. Compare the most-recent mtime under the repo root against
  // graph.metadata.generatedAt.
  const newestSource = findNewestSourceMtime(resolved);
  const generatedAt = new Date(graph.metadata.generatedAt);
  if (newestSource !== null && newestSource > generatedAt) {
    const driftMs = newestSource.getTime() - generatedAt.getTime();
    console.log(chalk.yellow(
      `⚠ graph.json is stale: source files have changed ${formatDuration(driftMs)} after the last generation.`,
    ));
    console.log(chalk.gray('  Re-run `klonode init` (or `klonode regenerate`) to refresh.\n'));
  }

  // Telemetry summary
  const sessions = listSessions(resolved);
  const dirAccess = buildDirAccessMap(resolved);

  console.log(chalk.white('Telemetry:'));
  console.log(chalk.gray(`  Sessions recorded: ${sessions.length}`));
  console.log(chalk.gray(`  Directories accessed: ${dirAccess.size}`));

  if (dirAccess.size > 0) {
    console.log('');
    console.log(chalk.white('Top accessed directories:'));
    const sorted = Array.from(dirAccess.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [dir, count] of sorted) {
      const bar = '█'.repeat(Math.min(count, 30));
      console.log(chalk.gray(`  ${dir.padEnd(40)} ${bar} ${count}`));
    }
  }

  if (sessions.length < 3) {
    console.log(chalk.yellow('\n⚡ Tip: Work on a few more tasks to build enough telemetry for optimization.\n'));
  } else {
    console.log(chalk.green('\n✓ Enough telemetry data. Run `klonode optimize` to improve routing.\n'));
  }

  // Security scan (only when --security is passed, or always when there's manual edits to review)
  if (options.security || manuallyEdited > 0) {
    console.log(chalk.white('Security scan:'));
    const report = scanRepositoryForInjection(resolved);
    const formatted = formatInjectionReport(report);
    if (report.totalHits > 0) {
      console.log(chalk.yellow(formatted));
    } else {
      console.log(chalk.gray('  ' + formatted));
    }
    console.log('');
  }
}

function formatGeneratedAt(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString();
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const STALE_SCAN_IGNORES = new Set<string>([
  '.git',
  '.klonode',
  'node_modules',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.pnpm-store',
]);

function findNewestSourceMtime(repoPath: string): Date | null {
  let newest: Date | null = null;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (STALE_SCAN_IGNORES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (newest === null || stat.mtime > newest) newest = stat.mtime;
      }
    }
  }

  walk(repoPath);
  return newest;
}
