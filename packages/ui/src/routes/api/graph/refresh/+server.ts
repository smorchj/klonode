/**
 * Graph refresh endpoint — re-reads CONTEXT.md files from disk and rebuilds the graph.
 * Called after CO writes new context files so the UI reflects the latest state.
 */

import { json } from '@sveltejs/kit';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const repoPath: string = body.repoPath || process.cwd();

  try {
    // Load existing graph
    const graphPath = join(repoPath, '.klonode', 'graph.json');
    if (!existsSync(graphPath)) {
      return json({ error: 'No graph.json found. Run klonode init first.' }, { status: 400 });
    }

    const graphJson = JSON.parse(readFileSync(graphPath, 'utf-8'));
    const nodes = graphJson.nodes || {};
    let updated = 0;

    // Walk all nodes and re-read their CONTEXT.md from disk
    for (const [id, node] of Object.entries(nodes) as [string, any][]) {
      if (node.type === 'file') continue;

      const ctxPath = join(repoPath, node.path, 'CONTEXT.md');
      if (existsSync(ctxPath)) {
        const md = readFileSync(ctxPath, 'utf-8');
        const isManual = md.includes('klonode:manual');

        // Only update if the file on disk differs from what's in the graph
        const currentMd = node.contextFile?.rawMarkdown || '';
        if (md !== currentMd) {
          node.contextFile = {
            inputs: node.contextFile?.inputs || [],
            process: node.contextFile?.process || [],
            outputs: node.contextFile?.outputs || [],
            rawMarkdown: md,
            lineCount: md.split('\n').length,
            tokenCount: Math.ceil(md.length / 4),
            lastGenerated: new Date().toISOString(),
            manuallyEdited: isManual,
          };
          updated++;
        }
      }
    }

    // Save updated graph
    graphJson.updatedAt = new Date().toISOString();
    writeFileSync(graphPath, JSON.stringify(graphJson, null, 2), 'utf-8');

    // Also update the UI's static demo-graph.json
    const uiStaticPath = join(repoPath, '..', 'KlonodeV2', 'packages', 'ui', 'static', 'demo-graph.json');
    if (existsSync(join(repoPath, '..', 'KlonodeV2', 'packages', 'ui', 'static'))) {
      writeFileSync(uiStaticPath, JSON.stringify(graphJson), 'utf-8');
    }

    return json({ updated, total: Object.keys(nodes).length });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 });
  }
};
