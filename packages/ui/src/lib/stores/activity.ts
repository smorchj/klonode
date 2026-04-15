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

/** How long a node stays highlighted after a tool call (ms). */
export const ACTIVITY_LIFETIME_MS = 2500;

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
 * Record a tool activity event. Called from the chat streaming handler.
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
 */
export const activeNodePaths = derived(activityStore, ($s, set) => {
  function computeActive() {
    const now = Date.now();
    const active = new Map<string, { kind: ActivityKind; at: number }>();
    for (const event of $s.recent) {
      if (!event.path) continue;
      if (now - event.at > ACTIVITY_LIFETIME_MS) break; // recent is sorted newest-first
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
  computeActive();
  // Re-compute every 250ms so expired events fade out
  const interval = setInterval(computeActive, 250);
  return () => clearInterval(interval);
}, new Map<string, { kind: ActivityKind; at: number }>());

/**
 * Helper: is a node's path currently active?
 */
export function isPathActive(activeMap: Map<string, { kind: ActivityKind; at: number }>, path: string): { kind: ActivityKind } | null {
  const entry = activeMap.get(path);
  if (!entry) return null;
  return { kind: entry.kind };
}
