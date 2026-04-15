/**
 * Session watcher — tails Claude Code session JSONL files and emits activity
 * events. This is the data source that feeds the live node graph after the
 * contextualizer pivot (#77, PR #78). See feat: pivot to contextualizer-only
 * for the motivation.
 *
 * Claude Code appends to `~/.claude/projects/<path-hash>/<session-id>.jsonl`
 * after every message and every tool call, before the tool even returns. That
 * means polling the file size and reading new bytes is enough to stream tool
 * use events in near-real-time (verified manually in #77 — a `tail -1` saw a
 * Bash call recorded before the command itself returned).
 *
 * Why polling instead of `fs.watch`? `fs.watch` on Windows is flaky for files
 * being appended to by another process — events drop, sizes lie, and we'd
 * miss tool calls. A 500ms poll on `fs.stat` is cheap (we have at most a
 * handful of files to watch) and reliable across platforms.
 */
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** How often we poll each session file for new bytes. */
const POLL_INTERVAL_MS = 500;

/** Max bytes to read per poll — prevents runaway memory if a session file
 * grows thousands of lines in one tick (unlikely but cheap to guard). */
const MAX_READ_PER_POLL = 1_000_000;

export type ActivityKind = 'read' | 'write' | 'command' | 'search' | 'other';

export interface SessionActivityEvent {
  /** Claude session id (filename without extension). */
  sessionId: string;
  /** Absolute cwd reported by Claude Code in the JSONL message. */
  cwd: string;
  /** Raw tool name (Read, Edit, Write, Bash, Glob, Grep, NotebookEdit...). */
  tool: string;
  /** Simplified kind for coloring in the graph. */
  kind: ActivityKind;
  /** File path the tool acted on — absolute or relative, as Claude saw it.
   * Empty string when the tool has no path (e.g. Bash with a non-file
   * command). */
  path: string;
  /** ISO timestamp from the JSONL entry. */
  at: string;
  /** Unique event id for client-side dedup (JSONL message uuid + tool_use id). */
  id: string;
  /** True if the tool_use came from a subagent / Task sidechain. */
  isSidechain: boolean;
}

interface WatchedFile {
  /** Absolute path to the JSONL file. */
  path: string;
  /** Bytes we've already parsed. */
  offset: number;
  /** Leftover bytes from a previous poll that didn't end on a newline. */
  buffer: string;
  /** Session id (filename without .jsonl). */
  sessionId: string;
}

interface WatcherHandle {
  /** Stop polling and release resources. */
  stop: () => void;
  /** Add a listener that receives every event as it's parsed. */
  onEvent: (listener: (event: SessionActivityEvent) => void) => () => void;
  /** Current count of watched files (observability for the UI). */
  watchedFileCount: () => number;
  /** Approximate events emitted so far. */
  eventCount: () => number;
}

/** Root directory Claude Code stores sessions in. */
export function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Encode a repo cwd to the folder name Claude Code uses.
 *
 * Observed rule (verified against the current worktree's session file): every
 * occurrence of `:`, `\`, `/`, or `.` becomes `-`. Note the leading drive
 * letter encoding: `C:\Users` → `C--Users` (colon + backslash become two
 * dashes). This matches what we saw at
 * `~/.claude/projects/C--Users-smorc-Desktop-KlonodeV2--claude-worktrees-laughing-poincare/`.
 */
export function encodeCwdToProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/.]/g, '-');
}

/**
 * Resolve the JSONL directory for a specific cwd. Returns null if Claude Code
 * hasn't created one for that repo yet (no sessions run there) or if the
 * path encoding rule above doesn't match an existing directory.
 */
export function projectDirForCwd(cwd: string): string | null {
  const encoded = encodeCwdToProjectDir(cwd);
  const dir = join(claudeProjectsDir(), encoded);
  return existsSync(dir) ? dir : null;
}

/**
 * Resolve the JSONL directory for a cwd, or the nearest ancestor. Walks up
 * the path one segment at a time until it finds a matching encoded dir or
 * runs out of segments.
 *
 * This handles two real cases:
 * - The dev server's `process.cwd()` is a subdirectory (`packages/ui`)
 *   while Claude Code recorded the session under the repo root.
 * - The graph was generated in the main checkout but the user is running
 *   the server from a git worktree sibling — the worktree's own dir is
 *   what we want to tail.
 */
export function projectDirForCwdOrAncestor(cwd: string): string | null {
  if (!cwd) return null;
  let current = cwd;
  // Safety bound: no sane repo path is more than 20 deep.
  for (let i = 0; i < 20; i++) {
    const direct = projectDirForCwd(current);
    if (direct) return direct;
    const parent = current.replace(/[\\/][^\\/]+$/, '');
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

/** Classify a raw tool name into a coarser kind the graph uses for colors. */
function classifyTool(tool: string): ActivityKind {
  const t = tool.toLowerCase();
  if (t === 'read' || t === 'glob') return 'read';
  if (t === 'grep') return 'search';
  if (t === 'write' || t === 'edit' || t === 'notebookedit') return 'write';
  if (t === 'bash') return 'command';
  return 'other';
}

/**
 * Extract a path from a tool_use input block. The field name varies per tool
 * and we want the one most likely to correspond to a node in the folder
 * graph. Returns an empty string when there's nothing meaningful to attach
 * the event to (e.g. `Bash: ls` with no path argument).
 */
function extractPath(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return '';

  // Most file tools agree on `file_path`.
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.notebook_path === 'string') return input.notebook_path;

  // Grep/Glob either has a path root or a pattern we can use as a hint.
  if (typeof input.path === 'string' && input.path.length > 0) return input.path;
  if (typeof input.pattern === 'string' && (input.pattern.includes('/') || input.pattern.includes('\\'))) {
    return input.pattern;
  }

  // Bash has no first-class path field. Heuristically pull the first
  // path-looking token out of the command. This is a best effort — if Claude
  // runs `npm install` there's nothing to highlight, and that's fine.
  if (toolName.toLowerCase() === 'bash' && typeof input.command === 'string') {
    const match = input.command.match(/[\w.\-@]+[\\/][\w.\-/\\]+/);
    if (match) return match[0];
  }

  return '';
}

/**
 * Parse a single JSONL line and emit zero or more activity events. Each
 * assistant message can contain multiple tool_use blocks so one input line
 * maps to N events.
 */
function parseLine(line: string): SessionActivityEvent[] {
  if (!line.trim()) return [];

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  // We only care about assistant messages that carry tool_use content.
  if (parsed.type !== 'assistant') return [];
  const message = parsed.message;
  if (!message || !Array.isArray(message.content)) return [];

  const cwd: string = typeof parsed.cwd === 'string' ? parsed.cwd : '';
  const sessionId: string = typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
  const at: string = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString();
  const baseUuid: string = typeof parsed.uuid === 'string' ? parsed.uuid : '';
  const isSidechain: boolean = parsed.isSidechain === true;

  const events: SessionActivityEvent[] = [];

  for (const block of message.content) {
    if (!block || block.type !== 'tool_use') continue;
    const toolName: string = typeof block.name === 'string' ? block.name : 'Unknown';
    const input: Record<string, unknown> | undefined = block.input && typeof block.input === 'object' ? block.input : undefined;
    const path = extractPath(toolName, input);
    const toolUseId: string = typeof block.id === 'string' ? block.id : '';

    events.push({
      sessionId,
      cwd,
      tool: toolName,
      kind: classifyTool(toolName),
      path,
      at,
      id: `${baseUuid}:${toolUseId}`,
      isSidechain,
    });
  }

  return events;
}

/**
 * Create a watcher that tails every JSONL file in one or more project
 * directories and emits activity events as new tool_use entries appear.
 *
 * @param dirs Absolute paths to project directories (the `<path-hash>` dirs
 *   under `~/.claude/projects/`). Use one for project-only scope, or pass
 *   every subdirectory for machine-wide scope.
 */
export function createSessionWatcher(dirs: string[]): WatcherHandle {
  const emitter = new EventEmitter();
  // Practically unlimited — SSE responses attach a listener each and we'd
  // rather not accidentally cap simultaneous clients at 10.
  emitter.setMaxListeners(0);

  /** path -> watched state */
  const watched = new Map<string, WatchedFile>();
  let events = 0;
  let stopped = false;

  function discoverFiles(): void {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const full = join(dir, entry);
        if (watched.has(full)) continue;

        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
        // On first discovery of a session file, start at the current size so
        // we don't replay the whole session history. The live graph only
        // cares about what happens from "now" forward. Replay of past
        // sessions will be a separate mode later (time scrub).
        watched.set(full, {
          path: full,
          offset: size,
          buffer: '',
          sessionId: entry.replace(/\.jsonl$/, ''),
        });
      }
    }
  }

  function pollFile(state: WatchedFile): void {
    let size: number;
    try {
      size = statSync(state.path).size;
    } catch {
      // File was deleted or rotated — drop it, re-discovery will add it back
      // if it reappears.
      watched.delete(state.path);
      return;
    }
    if (size === state.offset) return;
    if (size < state.offset) {
      // File truncated (rare — probably a Claude Code reset). Reset offset.
      state.offset = 0;
      state.buffer = '';
    }

    const readLen = Math.min(size - state.offset, MAX_READ_PER_POLL);
    if (readLen <= 0) return;

    // Read a slice from offset. Node doesn't have a fs.readSync-with-offset
    // helper that plays nicely here, so we read the whole file and slice.
    // These files stay small enough (tens of MB max for long sessions) that
    // this is fine. If profiling shows this hurts, switch to
    // fs.createReadStream with { start: offset } and accumulate.
    let chunk: string;
    try {
      const buf = readFileSync(state.path);
      chunk = buf.subarray(state.offset, state.offset + readLen).toString('utf-8');
    } catch {
      return;
    }
    state.offset += readLen;

    const combined = state.buffer + chunk;
    const lines = combined.split(/\r?\n/);
    // Keep the trailing partial line for the next poll.
    state.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = parseLine(line);
      for (const event of parsed) {
        events++;
        emitter.emit('event', event);
      }
    }
  }

  const interval = setInterval(() => {
    if (stopped) return;
    discoverFiles();
    for (const state of watched.values()) {
      pollFile(state);
    }
  }, POLL_INTERVAL_MS);

  // Discover immediately so the caller doesn't have to wait POLL_INTERVAL_MS
  // before knowing how many files we're watching.
  discoverFiles();

  return {
    stop(): void {
      stopped = true;
      clearInterval(interval);
      emitter.removeAllListeners();
      watched.clear();
    },
    onEvent(listener): () => void {
      emitter.on('event', listener);
      return () => emitter.off('event', listener);
    },
    watchedFileCount(): number {
      return watched.size;
    },
    eventCount(): number {
      return events;
    },
  };
}

/**
 * Resolve the list of directories to watch given a scope and repo cwd.
 *
 * - `project`: the dir matching the requested cwd, with a fallback to the
 *   server process cwd if the requested one doesn't resolve. This matters
 *   when the graph was generated for one checkout (e.g. the main worktree)
 *   but the server is running in a sibling worktree — without the fallback
 *   we'd silently watch the wrong session files.
 * - `machine`: every subdirectory of `~/.claude/projects/`.
 */
export function resolveWatchDirs(scope: 'project' | 'machine', cwd: string): string[] {
  if (scope === 'project') {
    const dirs = new Set<string>();
    // Try the client-supplied cwd (usually the graph's repoPath) and also
    // the server process cwd. For each, walk up ancestors until we find a
    // matching Claude projects dir. This covers three cases together:
    // - graph repoPath matches the worktree root → direct hit
    // - dev server launched from `packages/ui` → ancestor walk finds root
    // - graph generated for a sibling worktree → server cwd fallback hits
    //   the one we actually want
    const primary = projectDirForCwdOrAncestor(cwd);
    if (primary) dirs.add(primary);
    const serverCwd = process.cwd();
    if (serverCwd && serverCwd !== cwd) {
      const secondary = projectDirForCwdOrAncestor(serverCwd);
      if (secondary) dirs.add(secondary);
    }
    return [...dirs];
  }

  // Machine-wide: enumerate every subdirectory of ~/.claude/projects.
  const root = claudeProjectsDir();
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(root, e.name));
  } catch {
    return [];
  }
}
