/**
 * Suggestions API — CRUD for contextualizer suggestions.
 *
 * GET  — list pending suggestions (filters out dismissed/snoozed)
 * POST — actions: `generate` (compute from learning state), `approve`,
 *        `dismiss`, `snooze`
 */
import { json } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { loadLearningState } from '$lib/server/learning';
import {
  generateSuggestions,
  loadSuggestions,
  saveSuggestions,
  updateSuggestionStatus,
} from '$lib/server/suggestions';

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
  const now = new Date().toISOString();
  const suggestions = loadSuggestions(repoPath)
    .filter(s => {
      if (s.status === 'dismissed') return false;
      if (s.status === 'snoozed' && s.snoozedUntil && s.snoozedUntil > now) return false;
      return true;
    });
  return json({ suggestions });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const repoPath = findProjectRoot(process.cwd());

  switch (body.action) {
    case 'generate': {
      const state = loadLearningState(repoPath);
      if (!state) {
        return json({ error: 'No learning state. Run learning model first.' }, { status: 400 });
      }
      const suggestions = generateSuggestions(state);
      // Merge with existing: keep approved/dismissed status for matching ids.
      const existing = loadSuggestions(repoPath);
      const existingMap = new Map(existing.map(s => [s.id, s]));
      const merged = suggestions.map(s => {
        const prev = existingMap.get(s.id);
        if (prev && (prev.status === 'approved' || prev.status === 'dismissed')) {
          return prev; // don't resurrect
        }
        return s;
      });
      saveSuggestions(repoPath, merged);
      return json({ suggestions: merged.filter(s => s.status === 'pending') });
    }

    case 'approve':
    case 'dismiss': {
      if (!body.id) return json({ error: 'Missing suggestion id' }, { status: 400 });
      updateSuggestionStatus(repoPath, body.id, body.action);
      return json({ ok: true });
    }

    case 'snooze': {
      if (!body.id) return json({ error: 'Missing suggestion id' }, { status: 400 });
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      updateSuggestionStatus(repoPath, body.id, 'snoozed', until);
      return json({ ok: true, snoozedUntil: until });
    }

    default:
      return json({ error: 'Unknown action' }, { status: 400 });
  }
};
