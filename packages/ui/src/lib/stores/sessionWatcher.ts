/**
 * Client-side session watcher — opens an EventSource to
 * `/api/sessions/stream`, parses activity events, and feeds them into the
 * existing `activity.ts` store so GraphView and TreeView pulse rings light
 * up as Claude Code touches files.
 *
 * Lifecycle: call `startSessionWatcher` once on mount (from +layout.svelte).
 * It reacts to `watchSettings.scope` changes by tearing down and re-opening
 * the EventSource. Returns a cleanup function for onMount.
 *
 * Why EventSource instead of WebSocket or polling? EventSource is built into
 * every browser, automatically reconnects on network hiccups, and the server
 * side is a plain ReadableStream with no framing — much simpler than WS for
 * a unidirectional feed.
 */
import { writable, get } from 'svelte/store';
import { recordActivity } from './activity';
import { graphStore } from './graph';
import { watchSettings, type WatchScope } from './watchSettings';

export interface SessionWatcherStatus {
  /** True while an EventSource is open and the `hello` event has arrived. */
  connected: boolean;
  /** Current scope the watcher is running under (echoed from the server). */
  scope: WatchScope;
  /** How many JSONL files the server is tailing. */
  watchedFileCount: number;
  /** Running tally of events received this session (client side). */
  eventCount: number;
  /** Short message for the UI (last error or connection state). */
  message: string;
  /** Number of pending suggestions after the last learning recompute. */
  pendingSuggestions: number;
}

const initial: SessionWatcherStatus = {
  connected: false,
  scope: 'project',
  watchedFileCount: 0,
  eventCount: 0,
  message: 'idle',
  pendingSuggestions: 0,
};

export const sessionWatcherStatus = writable<SessionWatcherStatus>(initial);

interface WatcherEvent {
  sessionId: string;
  cwd: string;
  tool: string;
  kind: string;
  path: string;
  at: string;
  id: string;
  isSidechain: boolean;
}

/** Currently-open EventSource, if any. Tracked so scope changes can tear it
 * down before opening a new one. */
let current: EventSource | null = null;
/** Dedup set for event ids we've already forwarded to the activity store.
 * Uses a bounded ring buffer via Map-with-insertion-order to avoid unbounded
 * growth on long-running sessions. */
const seenIds = new Map<string, true>();
const SEEN_IDS_LIMIT = 2000;

function rememberId(id: string): boolean {
  if (!id) return false;
  if (seenIds.has(id)) return true;
  seenIds.set(id, true);
  if (seenIds.size > SEEN_IDS_LIMIT) {
    // Drop the oldest ~20% to keep amortized O(1).
    const toDrop = Math.floor(SEEN_IDS_LIMIT / 5);
    let i = 0;
    for (const key of seenIds.keys()) {
      seenIds.delete(key);
      if (++i >= toDrop) break;
    }
  }
  return false;
}

function openStream(scope: WatchScope): void {
  closeStream();

  const graph = get(graphStore);
  const cwd = graph?.repoPath || '';
  const qs = new URLSearchParams({ scope, cwd });
  const url = `/api/sessions/stream?${qs.toString()}`;

  let es: EventSource;
  try {
    es = new EventSource(url);
  } catch (err) {
    sessionWatcherStatus.update(s => ({
      ...s,
      connected: false,
      message: `EventSource failed: ${err instanceof Error ? err.message : 'unknown'}`,
    }));
    return;
  }
  current = es;

  sessionWatcherStatus.update(s => ({ ...s, scope, message: 'connecting...' }));

  es.addEventListener('hello', (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data);
      sessionWatcherStatus.update(s => ({
        ...s,
        connected: true,
        scope,
        watchedFileCount: data.watchedFileCount ?? 0,
        message: `watching ${data.watchedFileCount ?? 0} session file(s)`,
      }));
    } catch { /* ignore malformed hello */ }
  });

  es.addEventListener('ping', (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data);
      sessionWatcherStatus.update(s => ({
        ...s,
        watchedFileCount: data.watchedFileCount ?? s.watchedFileCount,
      }));
    } catch { /* ignore */ }
  });

  es.addEventListener('activity', (ev: MessageEvent) => {
    let data: WatcherEvent;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (rememberId(data.id)) return;

    // The activity store expects a path relative to the repo root. The
    // server sends the raw path as Claude Code recorded it — usually
    // absolute. Pass it through `recordActivity` which already handles
    // normalization against the repo path.
    const graphNow = get(graphStore);
    const repoPath = data.cwd || graphNow?.repoPath || '';
    recordActivity(data.tool, data.path, repoPath);

    sessionWatcherStatus.update(s => ({
      ...s,
      eventCount: s.eventCount + 1,
      message: `${data.tool}: ${data.path || '(no path)'}`,
    }));
  });

  es.addEventListener('session-ended', (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data);
      const nodeCount = data.nodeCount || 0;
      sessionWatcherStatus.update(s => ({
        ...s,
        pendingSuggestions: nodeCount,
        message: data.learningRecomputed
          ? `Session ended — ${nodeCount} nodes scored`
          : `Session ended (learning recompute failed)`,
      }));
    } catch { /* ignore */ }
  });

  es.onerror = () => {
    // EventSource auto-reconnects; we just reflect the state. If it's
    // hopelessly broken the browser will keep retrying — nothing we can do
    // server-side.
    sessionWatcherStatus.update(s => ({ ...s, connected: false, message: 'reconnecting...' }));
  };
}

function closeStream(): void {
  if (current) {
    current.close();
    current = null;
  }
}

/**
 * Start the watcher. Subscribes to scope changes and re-opens the stream
 * whenever the user flips between project-only and machine-wide. Returns a
 * teardown function suitable for Svelte's onMount return value.
 */
export function startSessionWatcher(): () => void {
  let currentScope: WatchScope | null = null;

  const unsubscribe = watchSettings.subscribe(s => {
    if (s.scope === currentScope) return;
    currentScope = s.scope;
    // Reset dedup state when switching scope — different files may expose
    // overlapping ids in theory, and we want a fresh start anyway.
    seenIds.clear();
    openStream(s.scope);
  });

  return () => {
    unsubscribe();
    closeStream();
  };
}
