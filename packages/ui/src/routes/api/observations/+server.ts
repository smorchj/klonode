/**
 * Observations API — stats, read, and purge for the persistent observation log.
 *
 * GET  — returns stats (counts per tool, session, top folder, file size)
 * POST — actions: `purge` (drop all observations)
 */
import { json } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { openObservationLog } from '$lib/server/observation-log';

function findProjectRoot(startPath: string): string {
  let current = startPath;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(current, '.klonode'))) return current;
    if (existsSync(join(current, '.git'))) return current;
    const parent = current.replace(/[\\/][^\\/]+$/, '');
    if (!parent || parent === current) break;
    current = parent;
  }
  return startPath;
}

export const GET: RequestHandler = async () => {
  const repoPath = findProjectRoot(process.cwd());
  const log = openObservationLog(repoPath);
  const s = log.stats();
  return json(s);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const repoPath = findProjectRoot(process.cwd());
  const log = openObservationLog(repoPath);

  switch (body.action) {
    case 'purge':
      log.purge();
      return json({ purged: true });
    default:
      return json({ error: 'Unknown action' }, { status: 400 });
  }
};
