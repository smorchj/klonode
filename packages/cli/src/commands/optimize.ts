/**
 * `klonode optimize` — Analyze telemetry and improve routing.
 */

import * as path from 'path';
import chalk from 'chalk';

export async function optimizeCommand(
  repoPath: string,
  options: { auto?: boolean },
): Promise<void> {
  const { loadGraph, optimize, saveGraph } = await import('@klonode/core');

  const resolved = path.resolve(repoPath);
  const graph = loadGraph(resolved);

  if (!graph) {
    console.log(chalk.yellow('\n⚠ No Klonode routing found.'));
    console.log(chalk.gray('Run `klonode init` first.\n'));
    return;
  }

  console.log(chalk.blue.bold('\n⟐ Klonode Optimizer\n'));
  console.log(chalk.gray('Analyzing telemetry data...\n'));

  const result = optimize(graph, resolved);

  // Display report
  console.log(result.report);
  console.log('');

  if (result.promotions.length === 0 && result.prunings.length === 0) {
    console.log(chalk.gray('No changes needed. Keep working to build more data.\n'));
    return;
  }

  // Summary
  console.log(chalk.white(`Recommendations:`));
  console.log(chalk.green(`  Promotions: ${result.promotions.length}`));
  console.log(chalk.yellow(`  Prunings: ${result.prunings.length}`));
  console.log(chalk.gray(`  Nodes updated: ${result.updatedNodes}`));
  console.log('');

  if (options.auto) {
    // Auto-apply changes
    graph.metadata.lastOptimized = new Date();
    saveGraph(resolved, graph);
    console.log(chalk.green('✓ Changes applied and graph saved.\n'));
    console.log(chalk.gray('Run `klonode init` to regenerate routing files with optimized data.\n'));
  } else {
    console.log(chalk.gray('Run with --auto to apply these changes automatically.'));
    console.log(chalk.gray('Or manually edit the CONTEXT.md files to adjust routing.\n'));
  }
}
