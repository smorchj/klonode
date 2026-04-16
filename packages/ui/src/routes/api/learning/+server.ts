/**
 * Learning API — read/recompute learning scores.
 *
 * GET  — returns the current learning state (from `.klonode/learning.json`)
 * POST — action: `recompute` — runs the learning model on the observation log
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

import {
  computeLearningState,
  saveLearningState,
  loadLearningState,
} from '$lib/server/learning';

export const GET: RequestHandler = async () => {
  const repoPath = findProjectRoot(process.cwd());
  const state = loadLearningState(repoPath);
  if (!state) {
    return json({ computed: false, message: 'No learning state computed yet. Run `klonode learn` or POST action=recompute.' });
  }
  return json({ computed: true, ...state });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const repoPath = findProjectRoot(process.cwd());

  if (body.action === 'recompute') {
    const log = openObservationLog(repoPath);
    const observations = log.readAll();
    const state = computeLearningState(observations);
    saveLearningState(repoPath, state);
    return json({ computed: true, ...state });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
};
