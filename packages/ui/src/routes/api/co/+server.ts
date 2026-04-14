/**
 * CO API — manages CO memory file and closed session processing.
 *
 * GET: Load CO memory
 * POST: Save CO memory / process closed sessions
 */

import { json } from '@sveltejs/kit';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { RequestHandler } from './$types';

interface CORequest {
  action: 'load-memory' | 'save-memory' | 'compact';
  repoPath: string;
  content?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const body: CORequest = await request.json();
  const repoPath = body.repoPath || process.cwd();
  const coDir = join(repoPath, '.klonode', 'co');

  if (!existsSync(coDir)) mkdirSync(coDir, { recursive: true });

  const memoryPath = join(coDir, 'memory.md');

  switch (body.action) {
    case 'load-memory': {
      let content = '';
      if (existsSync(memoryPath)) {
        content = readFileSync(memoryPath, 'utf-8');
      }
      return json({ content });
    }

    case 'save-memory': {
      writeFileSync(memoryPath, body.content || '', 'utf-8');
      return json({ saved: true });
    }

    case 'compact': {
      // Return the current memory for the UI to display
      // Actual compaction is done by CO itself via CLI
      let content = '';
      if (existsSync(memoryPath)) {
        content = readFileSync(memoryPath, 'utf-8');
      }
      return json({ content });
    }

    default:
      return json({ error: 'Ukjent aksjon' }, { status: 400 });
  }
};
