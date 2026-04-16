/**
 * SSE endpoint for the live session watcher. The client opens one connection
 * and receives a stream of `event: activity` messages as tool_use entries
 * appear in Claude Code's JSONL session files. See
 * `$lib/server/session-watcher.ts` for the tailing mechanics.
 *
 * Query params:
 * - `scope` — `project` | `machine`. Defaults to `project`.
 * - `cwd`   — absolute repo path to encode into a project-scope watch dir.
 *             When omitted we fall back to the server process cwd, which is
 *             usually the same thing the UI is looking at.
 *
 * Each event carries the parsed tool_use (tool name, kind, path, sessionId,
 * etc). The client feeds these into the `activity.ts` store which drives
 * pulse rings in GraphView and TreeView.
 */
import type { RequestHandler } from './$types';
import {
  createSessionWatcher,
  resolveWatchDirs,
  type SessionActivityEvent,
} from '$lib/server/session-watcher';
import { openObservationLog } from '$lib/server/observation-log';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Walk up from a starting path to find the project root. Prefers a dir
 * with `.klonode/` (already initialized), falls back to `.git` (repo
 * root). Returns null if neither is found. */
function findProjectRoot(startPath: string): string | null {
  let current = startPath;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(current, '.klonode'))) return current;
    if (existsSync(join(current, '.git'))) return current;
    const parent = current.replace(/[\\/][^\\/]+$/, '');
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

export const GET: RequestHandler = async ({ url, request }) => {
  const scope = (url.searchParams.get('scope') === 'machine' ? 'machine' : 'project') as 'project' | 'machine';
  const cwd = url.searchParams.get('cwd') || process.cwd();

  const dirs = resolveWatchDirs(scope, cwd);
  const watcher = createSessionWatcher(dirs);

  // Persistent observation log — every event gets appended to
  // `.klonode/observations.jsonl` so the learning model (#80, #81) can
  // compute cross-session statistics. The log dedupes internally so
  // multiple SSE clients or server restarts don't double-record.
  //
  // Use the *first* resolved watch dir's parent as the repo root (it's
  // the encoded project path whose parent is ~/.claude/projects, not
  // the repo itself). Instead, walk up from the server cwd to find the
  // nearest directory containing `.klonode/` — that's where graph.json
  // lives and where observations should go too.
  const repoRoot = findProjectRoot(cwd) || cwd;
  const observationLog = openObservationLog(repoRoot);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(eventName: string, data: unknown): void {
        try {
          // SSE format: `event: <name>\ndata: <json>\n\n`. Multiline data
          // needs a `data:` prefix per line, but JSON.stringify gives us one
          // line so we don't need to special-case it.
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Controller closed (client disconnected); cleanup happens in
          // cancel().
        }
      }

      // Initial hello so the client can render "connected" immediately
      // without waiting for the first tool call.
      send('hello', {
        scope,
        cwd,
        dirs,
        watchedFileCount: watcher.watchedFileCount(),
      });

      unsubscribe = watcher.onEvent((event: SessionActivityEvent) => {
        observationLog.append(event);
        send('activity', event);
      });

      // Heartbeat keeps proxies and fetch buffering honest — an idle SSE
      // connection can be closed by intermediaries after ~30s without
      // any data. 15s is a common safe interval.
      heartbeat = setInterval(() => {
        send('ping', {
          at: new Date().toISOString(),
          watchedFileCount: watcher.watchedFileCount(),
          eventCount: watcher.eventCount(),
        });
      }, 15_000);

      // When the client aborts (reload, navigate away, EventSource.close),
      // `request.signal` fires and we release the watcher.
      request.signal.addEventListener('abort', () => {
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        watcher.stop();
        try {
          controller.close();
        } catch { /* already closed */ }
      });
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      watcher.stop();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable Nginx/proxy buffering on self-hosted deployments. Harmless
      // in local dev.
      'X-Accel-Buffering': 'no',
    },
  });
};
