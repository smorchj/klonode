/**
 * Browser-side client for the detached Claude worker system.
 *
 * Replaces the direct `fetch('/api/chat/stream')` path in ChatPanel with a
 * three-step dance: spawn → connect SSE → resume-on-reconnect. The critical
 * property is that the browser can drop its connection (because of a Vite
 * HMR, a page reload, or the user closing the tab) and a later `connect()`
 * call with the same `workerId` and last-seen byte offset will pick up
 * exactly where it left off.
 *
 * See #73.
 */

import type {
  WorkerStreamEvent,
  WorkerSpawnResponse,
  WorkerStopResponse,
} from './worker-protocol';

export interface WorkerSpawnParams {
  cliPath: string;
  repoPath: string;
  prompt: string;
  maxTurns?: number;
  allowedTools?: string[];
  model?: string;
}

/**
 * Event callbacks the caller registers on `connect()`. All are optional —
 * ChatPanel only needs a subset at any given moment.
 */
export interface WorkerHandlers {
  onSession?: (sessionId: string) => void;
  onTool?: (tool: string, input: string) => void;
  onText?: (text: string) => void;
  onResult?: (result: {
    text: string;
    usage?: unknown;
    costUsd?: number;
    numTurns?: number;
    subtype?: string;
  }) => void;
  onStderr?: (text: string) => void;
  onError?: (message: string) => void;
  /** Fired when the worker exits. After this the EventSource is closed. */
  onDone?: (exitCode: number | null) => void;
  /**
   * Called after every processed event with the current byte offset. The
   * caller persists this into the store so a reconnect can pass `since=`.
   */
  onOffset?: (offset: number) => void;
}

/** Open connection returned from `connect()`. Call `close()` to abort. */
export interface WorkerConnection {
  close(): void;
  /** Current byte offset — useful for a one-shot snapshot. */
  getOffset(): number;
}

/**
 * POST /api/worker/spawn. Returns the worker id the caller should store.
 */
export async function spawnWorker(params: WorkerSpawnParams): Promise<WorkerSpawnResponse> {
  const res = await fetch('/api/worker/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`spawnWorker: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as WorkerSpawnResponse;
}

/**
 * Connect (or reconnect) to an existing worker's tail endpoint and stream
 * events into the handlers. `since` is the byte offset to resume from —
 * pass 0 on first connect, pass the last offset the browser persisted on a
 * reconnect after HMR / reload.
 */
export function connectWorker(
  workerId: string,
  since: number,
  repoPath: string,
  handlers: WorkerHandlers,
): WorkerConnection {
  let offset = since;
  let closed = false;

  const params = new URLSearchParams({
    since: String(since),
    repoPath,
  });
  const es = new EventSource(`/api/worker/${encodeURIComponent(workerId)}/tail?${params}`);

  function updateOffset(ev: WorkerStreamEvent): void {
    if (typeof ev.offset === 'number' && ev.offset > offset) {
      offset = ev.offset;
      handlers.onOffset?.(offset);
    }
  }

  function addTypedListener<K extends WorkerStreamEvent['type']>(
    type: K,
    handler: (ev: Extract<WorkerStreamEvent, { type: K }>) => void,
  ): void {
    es.addEventListener(type, (raw: MessageEvent) => {
      if (closed) return;
      try {
        const data = JSON.parse(raw.data) as Extract<WorkerStreamEvent, { type: K }>;
        updateOffset(data);
        handler(data);
      } catch {
        // ignore bad JSON
      }
    });
  }

  addTypedListener('session', ev => handlers.onSession?.(ev.sessionId));
  addTypedListener('tool', ev => handlers.onTool?.(ev.tool, ev.input));
  addTypedListener('text', ev => handlers.onText?.(ev.text));
  addTypedListener('result', ev =>
    handlers.onResult?.({
      text: ev.text,
      usage: ev.usage,
      costUsd: ev.costUsd,
      numTurns: ev.numTurns,
      subtype: ev.subtype,
    }),
  );
  addTypedListener('stderr', ev => handlers.onStderr?.(ev.text));
  addTypedListener('error', ev => handlers.onError?.(ev.message));
  addTypedListener('done', ev => {
    handlers.onDone?.(ev.exitCode);
    try { es.close(); } catch { /* ignore */ }
    closed = true;
  });

  // Generic error (network failure, server unreachable). The EventSource
  // will auto-retry, so we don't close here — we just tell the caller so
  // they can show a "reconnecting" banner if they want.
  es.addEventListener('error', () => {
    if (!closed) handlers.onError?.('EventSource dropped connection (auto-retrying)');
  });

  return {
    close(): void {
      if (closed) return;
      closed = true;
      try { es.close(); } catch { /* ignore */ }
    },
    getOffset(): number {
      return offset;
    },
  };
}

/**
 * POST /api/worker/[id]/stop. Used by the Stop button.
 */
export async function stopWorker(
  workerId: string,
  repoPath: string,
): Promise<WorkerStopResponse> {
  const params = new URLSearchParams({ repoPath });
  const res = await fetch(
    `/api/worker/${encodeURIComponent(workerId)}/stop?${params}`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error(`stopWorker: ${res.status}`);
  }
  return (await res.json()) as WorkerStopResponse;
}
