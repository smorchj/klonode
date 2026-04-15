/**
 * POST /api/workstation/state
 *
 * The browser pushes its current synthesized snapshot here whenever any
 * underlying store changes. The handler stuffs it into the in-memory cache
 * that `/api/workstation/snapshot` reads from. There is no validation
 * beyond requiring a parseable JSON body — we trust the same-origin browser.
 *
 * See #64.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { WorkstationSnapshot } from '$lib/workstation/registry';
import { setWorkstationSnapshot } from '$lib/workstation/server-cache';

export const POST: RequestHandler = async ({ request }) => {
  let body: WorkstationSnapshot;
  try {
    body = (await request.json()) as WorkstationSnapshot;
  } catch (err) {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.components)) {
    return json({ error: 'snapshot is missing components[]' }, { status: 400 });
  }
  setWorkstationSnapshot(body);
  return json({ ok: true });
};
