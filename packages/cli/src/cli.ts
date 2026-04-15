#!/usr/bin/env node

/**
 * Klonode CLI — Auto-generate intelligent AI context routing for any git project.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { optimizeCommand } from './commands/optimize.js';

const program = new Command();

program
  .name('klonode')
  .description('Auto-generate intelligent AI context routing for any git project')
  .version('0.1.0');

program
  .command('init')
  .description('Scan a repository and generate routing structure')
  .argument('[path]', 'Path to the git repository', '.')
  .option('-m, --mode <mode>', 'Output mode: inline or shadow', 'inline')
  .option('--dry-run', 'Show what would be generated without writing files')
  .option('--gitignore-only', 'Append Klonode presets to .gitignore without scanning')
  .action(initCommand);

program
  .command('status')
  .description('Show routing health and coverage')
  .argument('[path]', 'Path to the repository', '.')
  .option('--security', 'Run security scan against CONTEXT.md files for injection patterns')
  .action(statusCommand);

program
  .command('optimize')
  .description('Run self-improvement on routing based on telemetry')
  .argument('[path]', 'Path to the repository', '.')
  .option('--auto', 'Automatically apply recommended changes')
  .action(optimizeCommand);

program
  .command('update')
  .description('Regenerate routing for changed directories')
  .argument('[path]', 'Path to the repository', '.')
  .option('--force', 'Regenerate all routing files, even manually edited ones')
  .action(async (repoPath: string, options: { force?: boolean }) => {
    // TODO: Implement incremental update
    console.log('Update command coming soon. Use `klonode init` to regenerate.');
  });

program
  .command('export')
  .description('Export routing configuration')
  .argument('[path]', 'Path to the repository', '.')
  .option('-o, --output <file>', 'Output file path', 'klonode-export.json')
  .action(async (repoPath: string, options: { output: string }) => {
    const { loadGraph, serializeGraph } = await import('@klonode/core');
    const fs = await import('fs');
    const path = await import('path');

    const resolved = path.resolve(repoPath);
    const graph = loadGraph(resolved);
    if (!graph) {
      console.error('No Klonode routing found. Run `klonode init` first.');
      process.exit(1);
    }
    fs.writeFileSync(options.output, serializeGraph(graph), 'utf-8');
    console.log(`Exported to ${options.output}`);
  });

program.parse();
