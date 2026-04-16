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
  .command('observations')
  .description('View or manage the persistent observation log')
  .argument('[path]', 'Path to the repository', '.')
  .option('--purge', 'Drop all observations and start fresh')
  .action(async (repoPath: string, options: { purge?: boolean }) => {
    const path = await import('path');
    const resolved = path.resolve(repoPath);

    // Dynamically import the observation log from the UI package server
    // module. This works because the CLI and UI share a workspace and
    // the module has no Svelte/browser deps.
    const { openObservationLog } = await import('../../ui/src/lib/server/observation-log.js');
    const log = openObservationLog(resolved);

    if (options.purge) {
      log.purge();
      console.log('Observations purged.');
      return;
    }

    const s = log.stats();
    console.log(`Observation log: ${log.filePath}`);
    console.log(`Total events: ${s.totalEvents}`);
    console.log(`File size: ${(s.fileSizeBytes / 1024).toFixed(1)} KB`);

    if (Object.keys(s.byTool).length > 0) {
      console.log('\nBy tool:');
      for (const [tool, count] of Object.entries(s.byTool).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${tool}: ${count}`);
      }
    }

    if (Object.keys(s.bySession).length > 0) {
      console.log(`\nSessions: ${Object.keys(s.bySession).length}`);
    }

    if (Object.keys(s.byTopFolder).length > 0) {
      console.log('\nBy top folder:');
      for (const [folder, count] of Object.entries(s.byTopFolder).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        console.log(`  ${folder}: ${count}`);
      }
    }
  });

program
  .command('learn')
  .description('Compute learning scores from observation log')
  .argument('[path]', 'Path to the repository', '.')
  .option('--json', 'Output raw JSON instead of formatted text')
  .action(async (repoPath: string, options: { json?: boolean }) => {
    const path = await import('path');
    const resolved = path.resolve(repoPath);

    const { openObservationLog } = await import('../../ui/src/lib/server/observation-log.js');
    const { computeLearningState, saveLearningState } = await import('../../ui/src/lib/server/learning.js');

    const log = openObservationLog(resolved);
    const observations = log.readAll();

    if (observations.length === 0) {
      console.log('No observations recorded yet. Use Klonode with the live watcher to accumulate data.');
      return;
    }

    // Compute learning state from observations (emotion events from JSONL
    // parsing is a separate, heavier step — for now we compute repetition only).
    const state = computeLearningState(observations);
    saveLearningState(resolved, state);

    if (options.json) {
      console.log(JSON.stringify(state, null, 2));
      return;
    }

    console.log(`Learning state computed from ${state.observationCount} observations across ${state.sessionCount} session(s).\n`);

    // Sort by confidence descending.
    const sorted = Object.values(state.nodes).sort((a, b) => b.confidence - a.confidence);

    if (sorted.length === 0) {
      console.log('No folder-level data yet.');
      return;
    }

    console.log('Top folders by confidence:\n');
    for (const node of sorted.slice(0, 15)) {
      const bar = '█'.repeat(Math.round(node.confidence * 20));
      const urgencyStr = node.urgency > 0 ? ` urgency: ${node.urgency.toFixed(1)}` : '';
      console.log(`  ${node.path.padEnd(45)} ${bar} ${(node.confidence * 100).toFixed(0)}%  (${node.signals.readCount}R ${node.signals.writeCount}W ${node.signals.sessionsCount}S)${urgencyStr}`);
    }

    console.log(`\nSaved to .klonode/learning.json`);
  });

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
