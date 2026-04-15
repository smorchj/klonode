/**
 * Server-side cache for the most recent workstation snapshot.
 *
 * The browser pushes snapshots to `/api/workstation/state` via the sync
 * subscription, and the GET endpoint at `/api/workstation/snapshot` reads
 * from this cache. In-memory only — there's no value in persisting because
 * it always represents "right now" and gets refreshed on every store update.
 *
 * The cache lives at module scope so SvelteKit's per-request handlers share
 * it within one server process. If we ever go multi-process (e.g. clustering)
 * this will need to move to a shared store, but for the workstation use case
 * a single dev-server process is fine.
 */

import type { WorkstationSnapshot } from './registry';

let cached: WorkstationSnapshot | null = null;
let receivedAt: string | null = null;

export function setWorkstationSnapshot(snapshot: WorkstationSnapshot): void {
  cached = snapshot;
  receivedAt = new Date().toISOString();
}

export function getWorkstationSnapshot(): {
  snapshot: WorkstationSnapshot | null;
  receivedAt: string | null;
} {
  return { snapshot: cached, receivedAt };
}

export function clearWorkstationSnapshot(): void {
  cached = null;
  receivedAt = null;
}
