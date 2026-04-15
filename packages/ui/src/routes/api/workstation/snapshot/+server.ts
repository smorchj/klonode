/**
 * GET /api/workstation/snapshot
 *
 * Returns the most recent workstation snapshot the browser pushed to the
 * cache via /api/workstation/state. This is how Claude (running inside or
 * outside Klonode) reads "what is the user looking at right now" without
 * taking a screenshot and parsing pixels.
 *
 * See #64.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWorkstationSnapshot } from '$lib/workstation/server-cache';

export const GET: RequestHandler = async () => {
  const { snapshot, receivedAt } = getWorkstationSnapshot();
  if (!snapshot) {
    return json(
      {
        error: 'no snapshot yet — the Workstation browser has not pushed its state',
        hint: 'open the Workstation UI in a browser at least once so it can register its components',
      },
      { status: 503 },
    );
  }
  return json({ receivedAt, snapshot });
};
