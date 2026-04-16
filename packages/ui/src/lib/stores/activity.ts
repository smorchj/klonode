/**
 * Activity store — tracks Claude's live tool calls so tree/graph views can
 * highlight nodes as they're accessed in real time.
 */

import { writable, derived } from 'svelte/store';

export type ActivityKind = 'read' | 'write' | 'command' | 'search' | 'other';

export interface ActivityEvent {
  /** Monotonic id */
  id: number;
  /** Tool name (Read, Edit, Write, Bash, Glob, Grep, ...) */
  tool: string;
  /** Simplified kind for coloring */
  kind: ActivityKind;
  /** Normalized path the tool acted on (relative to repo root), or empty for non-file tools */
  path: string;
  /** When the event happened */
  at: number;
}

/** How long a node stays highlighted after a tool call (ms).
 *
 * Tuned for the JSONL tail watcher introduced in #77. The legacy chat
 * streaming handler pushed events with near-zero latency, so 2.5s was
 * enough. The watcher has measurable end-to-end delay: JSONL append →
 * 500ms poll tick → SSE → client → `recordActivity`, plus whatever time
 * passes before the user's eye lands on the pulsing node. Verified
 * against the current Claude Code session: observed event ages of 5+
 * seconds between tool use and graph render. 8s gives a visible pulse
 * even on the slow edge without cluttering the graph with everything
 * from the last 20s. */
export const ACTIVITY_LIFETIME_MS = 8000;

const MAX_RECENT = 50;
let nextId = 0;

interface ActivityState {
  recent: ActivityEvent[];
  /** Current path (most recent event) */
  current: string | null;
}

export const activityStore = writable<ActivityState>({ recent: [], current: null });

function classifyTool(tool: string): ActivityKind {
  const t = tool.toLowerCase();
  if (t === 'read' || t === 'glob') return 'read';
  if (t === 'grep') return 'search';
  if (t === 'write' || t === 'edit' || t === 'notebookedit') return 'write';
  if (t === 'bash') return 'command';
  return 'other';
}

/** Extract a path-like string from a tool input string (already simplified by the stream server). */
function normalizePath(input: string, repoPath: string): string {
  if (!input) return '';
  // Strip common quoting, take the first path-looking token
  const trimmed = input.trim().replace(/^["'`]|["'`]$/g, '');
  // If the input has multiple segments separated by space (grep pattern + path), try to find a path
  // Simple heuristic: last token that contains a slash or backslash
  const tokens = trimmed.split(/\s+/);
  let pathToken = tokens[0];
  for (const tok of tokens) {
    if (tok.includes('/') || tok.includes('\\')) {
      pathToken = tok;
    }
  }
  // Normalize to forward slashes
  let normalized = pathToken.replace(/\\/g, '/');
  // Make relative to repoPath if possible
  if (repoPath) {
    const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.startsWith(normalizedRepo + '/')) {
      normalized = normalized.slice(normalizedRepo.length + 1);
    } else if (normalized === normalizedRepo) {
      normalized = '.';
    }
  }
  return normalized;
}

/**
 * Record a tool activity event. Called from the session watcher client.
 */
export function recordActivity(tool: string, input: string, repoPath: string = ''): void {
  const path = normalizePath(input, repoPath);
  const event: ActivityEvent = {
    id: nextId++,
    tool,
    kind: classifyTool(tool),
    path,
    at: Date.now(),
  };

  activityStore.update(s => {
    const recent = [event, ...s.recent].slice(0, MAX_RECENT);
    return { recent, current: path || s.current };
  });
}

/** Clear all activity state (on new chat, on clear, etc.) */
export function clearActivity(): void {
  activityStore.set({ recent: [], current: null });
}

/**
 * Derived map from path → {kind, timestamp} for active (not-yet-expired) events.
 * Components subscribe to this to highlight nodes.
 *
 * NOTE on the break vs. continue fix: we used to `break` when we hit the
 * first expired event, on the assumption that `recent` was sorted
 * newest-first by `at`. But `recordActivity` prepends via
 * `[event, ...s.recent]` which keeps insertion order, not timestamp order —
 * so a single out-of-order event (e.g. two events that arrive via SSE in
 * the same tick but with slightly drifted timestamps) would terminate the
 * loop early and drop every subsequent active event. Using `continue`
 * costs one extra iteration per expired entry (cheap, bounded by
 * MAX_RECENT) and is correct regardless of ordering.
 */
// Module-level interval handle so consecutive derived re-runs don't stack
// timers. Every time `activityStore` emits, Svelte calls the derived body
// again — and if we don't clear the previous interval here, each run
// accumulates a new timer that closes over a stale `$s.recent`. Those
// stale timers then clobber the fresh ones with empty activity maps,
// which is why pulse rings never rendered even though events were
// arriving correctly. The cleanup arrow is still returned for the
// last-subscriber-leaves case, but we also defensively clear here.
let _activeNodePathsInterval: ReturnType<typeof setInterval> | null = null;

export const activeNodePaths = derived(activityStore, ($s, set) => {
  function computeActive() {
    const now = Date.now();
    const active = new Map<string, { kind: ActivityKind; at: number }>();
    for (const event of $s.recent) {
      if (!event.path) continue;
      if (now - event.at > ACTIVITY_LIFETIME_MS) continue;
      // Keep the newest event per path
      if (!active.has(event.path)) {
        active.set(event.path, { kind: event.kind, at: event.at });
      }
      // Also mark all ancestor paths as active so parent folders light up too
      const parts = event.path.split('/');
      for (let i = parts.length - 1; i > 0; i--) {
        const ancestor = parts.slice(0, i).join('/');
        if (!active.has(ancestor)) {
          active.set(ancestor, { kind: event.kind, at: event.at });
        }
      }
    }
    set(active);
  }
  if (_activeNodePathsInterval) {
    clearInterval(_activeNodePathsInterval);
    _activeNodePathsInterval = null;
  }
  computeActive();
  // Re-compute every 250ms so expired events fade out even when the store
  // isn't being updated.
  _activeNodePathsInterval = setInterval(computeActive, 250);
  return () => {
    if (_activeNodePathsInterval) {
      clearInterval(_activeNodePathsInterval);
      _activeNodePathsInterval = null;
    }
  };
}, new Map<string, { kind: ActivityKind; at: number }>());

/**
 * Helper: is a node's path currently active?
 */
export function isPathActive(activeMap: Map<string, { kind: ActivityKind; at: number }>, path: string): { kind: ActivityKind } | null {
  const entry = activeMap.get(path);
  if (!entry) return null;
  return { kind: entry.kind };
}
