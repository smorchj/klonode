/**
 * Browser → server sync for the workstation snapshot.
 *
 * The registry lives in browser memory because that's where the Svelte stores
 * are. The `/api/workstation/snapshot` endpoint runs on the server and has no
 * direct access to those stores. We bridge the gap by debounce-pushing the
 * latest synthesized snapshot from the browser to a server-side cache whenever
 * any of the underlying stores change. The endpoint then returns whatever the
 * cache holds.
 *
 * See #64 for the full design.
 */

import { browser } from '$app/environment';
import { snapshotWorkstation, registeredComponentIds, type WorkstationSnapshot } from './registry';

/** Default minimum gap between two consecutive POSTs, in milliseconds. */
const DEBOUNCE_MS = 500;

/**
 * Hook this once at app boot (e.g. from the root layout's `onMount`). It will
 * subscribe to the registry and to whatever extra stores the caller passes,
 * and POST a fresh snapshot to `/api/workstation/state` whenever any of them
 * fires — debounced so a rapid burst of store updates collapses into one
 * upload.
 *
 * Returns the unsubscribe function.
 */
export function startWorkstationSync(
  /**
   * Extra stores to subscribe to. The registry alone won't cover live state
   * changes — pass the application stores whose values feed the snapshot
   * (selectedNodeId, viewMode, activeSession, etc.) so we re-push when any
   * of them changes.
   */
  extraStores: Array<{ subscribe: (cb: () => void) => () => void }> = [],
): () => void {
  if (!browser) return () => {};

  let pending: ReturnType<typeof setTimeout> | null = null;
  let lastSerialized = '';

  const flush = (): void => {
    pending = null;
    let snapshot: WorkstationSnapshot;
    try {
      snapshot = snapshotWorkstation();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[workstation/sync] snapshot failed', err);
      return;
    }
    // Skip the POST when the new snapshot is byte-identical to the last one
    // we sent — common when an unrelated store fires.
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;

    fetch('/api/workstation/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
      // We don't need the response, and we don't want a failed sync to throw.
      keepalive: true,
    }).catch(() => {
      // Silent — sync failures are not user-visible. The snapshot endpoint
      // will just return whatever it last cached.
    });
  };

  const schedule = (): void => {
    if (pending) return;
    pending = setTimeout(flush, DEBOUNCE_MS);
  };

  const unsubs: Array<() => void> = [];
  unsubs.push(registeredComponentIds.subscribe(schedule));
  for (const store of extraStores) {
    unsubs.push(store.subscribe(schedule));
  }

  // Push once on startup so the cache has a baseline immediately, even if
  // nothing changes for a while.
  schedule();

  return () => {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    for (const unsub of unsubs) unsub();
  };
}
