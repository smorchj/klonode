/**
 * `klonode status` — Show routing health, coverage, and telemetry summary.
 */

import * as path from 'path';
import chalk from 'chalk';

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
  console.log(chalk.gray(`Generated: ${graph.metadata.generatedAt}`));
  console.log('');

  // Node count by layer
  const layerCounts = new Map<number, number>();
  let nodesWithContext = 0;
  let manuallyEdited = 0;

  for (const node of graph.nodes.values()) {
    layerCounts.set(node.layer, (layerCounts.get(node.layer) || 0) + 1);
    if (node.contextFile) {
      nodesWithContext++;
      if (node.contextFile.manuallyEdited) manuallyEdited++;
    }
  }

  console.log(chalk.white('Routing Coverage:'));
  for (const [layer, count] of Array.from(layerCounts.entries()).sort()) {
    const label = ['CLAUDE.md (root)', 'CONTEXT.md (top)', 'CONTEXT.md (stage)', 'References', 'Artifacts'][layer];
    console.log(chalk.gray(`  Layer ${layer} (${label}): ${count} nodes`));
  }

  console.log(chalk.gray(`  Nodes with CONTEXT.md: ${nodesWithContext}`));
  console.log(chalk.gray(`  Manually edited: ${manuallyEdited}`));
  console.log('');

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
