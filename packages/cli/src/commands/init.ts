/**
 * `klonode init` — Scan a repo and generate the full routing structure.
 */

import * as path from 'path';
import chalk from 'chalk';

export async function initCommand(
  repoPath: string,
  options: { mode?: string; dryRun?: boolean; gitignoreOnly?: boolean },
): Promise<void> {
  const resolved = path.resolve(repoPath);

  if (options.gitignoreOnly) {
    const fs = await import('fs');
    const gitignorePath = path.join(resolved, '.gitignore');
    const snippet = '\n# Klonode auto-generated routing\nCLAUDE.md\nCONTEXT.md\n.klonode/\n';
    
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (!content.includes('# Klonode auto-generated routing')) {
        fs.appendFileSync(gitignorePath, snippet);
        console.log(chalk.green('✓ Appended Klonode preset to .gitignore'));
      } else {
        console.log(chalk.yellow('⚠ .gitignore already contains the Klonode preset'));
      }
    } else {
      fs.writeFileSync(gitignorePath, snippet.trimStart());
      console.log(chalk.green('✓ Created .gitignore and added Klonode preset'));
    }
    return;
  }
  const {
    generateRouting,
    writeGeneratedFiles,
    saveConfig,
    saveGraph,
    DEFAULT_CONFIG,
    scanRepositoryForInjection,
    formatInjectionReport,
  } = await import('@klonode/core');


  const mode = (options.mode === 'shadow' ? 'shadow' : 'inline') as 'inline' | 'shadow';

  console.log(chalk.blue.bold('\n⟐ Klonode — AI Context Routing Generator\n'));
  console.log(chalk.gray(`Scanning: ${resolved}`));
  console.log(chalk.gray(`Mode: ${mode}\n`));

  const config = { ...DEFAULT_CONFIG, mode };

  try {
    const result = await generateRouting(resolved, config);

    console.log(chalk.green('✓ Analysis complete'));
    console.log(chalk.gray(`  Files scanned: ${result.graph.metadata.totalFiles}`));
    console.log(chalk.gray(`  Directories: ${result.graph.metadata.totalDirectories}`));

    const langs = Object.entries(result.graph.metadata.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count]) => `${lang}(${count})`)
      .join(', ');
    if (langs) {
      console.log(chalk.gray(`  Languages: ${langs}`));
    }

    console.log('');
    console.log(chalk.green('✓ Generated routing files:'));
    for (const file of result.files) {
      const layerLabel = `L${file.layer}`;
      console.log(chalk.gray(`  [${layerLabel}] ${file.relativePath}`));
    }

    console.log('');
    console.log(chalk.gray(`  Total files: ${result.stats.totalFilesGenerated}`));
    console.log(chalk.gray(`  Total tokens: ~${result.stats.totalTokens}`));
    console.log(chalk.gray(`  Duration: ${result.stats.durationMs}ms`));

    if (options.dryRun) {
      console.log(chalk.yellow('\n⚠ Dry run — no files written.'));
      console.log(chalk.gray('Remove --dry-run to write files to disk.'));
      return;
    }

    // Write files
    writeGeneratedFiles(resolved, result.files, mode);
    saveConfig(resolved, config);
    saveGraph(resolved, result.graph);

    // Security: scan generated + any hand-edited CONTEXT.md files for injection patterns
    const scanReport = scanRepositoryForInjection(resolved);
    if (scanReport.totalHits > 0) {
      console.log('');
      console.log(chalk.yellow('⚠ Security scan:'));
      console.log(chalk.gray(formatInjectionReport(scanReport)));
    }

    console.log(chalk.green.bold('\n✓ Routing generated successfully!'));
    console.log(chalk.gray(`\nClaude will now read CLAUDE.md → CONTEXT.md → directory CONTEXT.md`));
    console.log(chalk.gray('to find exactly what it needs. No more wasted tokens.\n'));

    console.log(chalk.blue('Next steps:'));
    console.log(chalk.gray('  • Review generated CLAUDE.md at the repo root'));
    console.log(chalk.gray('  • Edit any CONTEXT.md to add <!-- klonode:manual --> to protect from regeneration'));
    console.log(chalk.gray('  • Run `klonode status` to see routing coverage'));
    console.log(chalk.gray('  • Run `klonode optimize` after a few sessions to improve routing'));
    console.log('');
  } catch (error) {
    console.error(chalk.red('\n✗ Error generating routing:'));
    console.error(chalk.red(`  ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}
