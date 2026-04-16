/**
 * Persistent observation log — append-only JSONL store of every tool_use
 * event the session watcher extracts from Claude Code session files.
 *
 * Stored at `.klonode/observations.jsonl` per project. This is the raw data
 * the learning model reads to compute confidence (repetition) and urgency
 * (emotion) scores per folder node. Without this, events flow through the
 * 8-second pulse lifetime and are lost.
 *
 * Design constraints:
 * - Append-only: never rewrite the whole file. Rotation at 50 MB.
 * - Dedup by `uuid:toolUseId` so server restarts and reconnects don't
 *   double-record. Dedup state is in-memory with a bounded set.
 * - Paths normalized to forward slashes and relative to the session's cwd
 *   (same normalization the activity store uses) so downstream learning
 *   can join directly against graph node paths.
 *
 * Part of the #77 pivot roadmap. See #79 for the issue.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionActivityEvent } from './session-watcher.js';

export interface ObservationEntry {
  /** ISO timestamp from the JSONL entry (when Claude Code recorded it). */
  at: string;
  /** Claude session id. */
  sessionId: string;
  /** Absolute cwd reported by Claude Code. */
  cwd: string;
  /** Raw tool name. */
  tool: string;
  /** Simplified kind. */
  kind: string;
  /** File path — normalized to forward slashes, relative to cwd. */
  path: string;
  /** True if from a subagent/Task sidechain. */
  isSidechain: boolean;
  /** Dedup key: `uuid:toolUseId`. */
  id: string;
}

/** Max size of the active observations file before rotation. */
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

/** How many dedup IDs we keep in memory. */
const DEDUP_LIMIT = 10_000;

/**
 * Normalize a path to forward slashes and make it relative to cwd.
 */
function normalizePath(rawPath: string, cwd: string): string {
  if (!rawPath) return '';
  let p = rawPath.replace(/\\/g, '/');
  if (cwd) {
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/$/, '');
    if (p.startsWith(normalizedCwd + '/')) {
      p = p.slice(normalizedCwd.length + 1);
    } else if (p === normalizedCwd) {
      p = '.';
    }
  }
  return p;
}

export interface ObservationLog {
  /** Append a single event. Returns false if deduped (already recorded). */
  append: (event: SessionActivityEvent) => boolean;
  /** Read all entries. Optional filters. */
  readAll: (opts?: { sessionId?: string; pathPrefix?: string }) => ObservationEntry[];
  /** Read entries added after a given line offset (for tailing). */
  readFrom: (lineOffset: number) => { entries: ObservationEntry[]; nextOffset: number };
  /** Stats: count per tool, per session, per top-level folder. */
  stats: () => ObservationStats;
  /** Drop everything — start fresh. */
  purge: () => void;
  /** Absolute path to the observations file. */
  filePath: string;
}

export interface ObservationStats {
  totalEvents: number;
  byTool: Record<string, number>;
  bySession: Record<string, number>;
  byTopFolder: Record<string, number>;
  fileSizeBytes: number;
}

/**
 * Create or open an observation log for a project.
 */
export function openObservationLog(repoPath: string): ObservationLog {
  const klonodeDir = join(repoPath, '.klonode');
  if (!existsSync(klonodeDir)) mkdirSync(klonodeDir, { recursive: true });

  const filePath = join(klonodeDir, 'observations.jsonl');
  const archivePath = join(klonodeDir, 'observations.archive.jsonl');

  // In-memory dedup set. Load last DEDUP_LIMIT IDs from the existing file
  // so restarts don't re-record the tail.
  const seen = new Set<string>();
  if (existsSync(filePath)) {
    try {
      const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
      const startIdx = Math.max(0, lines.length - DEDUP_LIMIT);
      for (let i = startIdx; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.id) seen.add(entry.id);
        } catch { /* skip corrupt line */ }
      }
    } catch { /* file may be empty or corrupt */ }
  }

  function maybeRotate(): void {
    try {
      if (!existsSync(filePath)) return;
      const size = statSync(filePath).size;
      if (size < MAX_FILE_BYTES) return;
      // Append current to archive, then truncate current.
      if (existsSync(archivePath)) {
        const current = readFileSync(filePath, 'utf-8');
        appendFileSync(archivePath, current);
      } else {
        renameSync(filePath, archivePath);
      }
      writeFileSync(filePath, '', 'utf-8');
      seen.clear();
    } catch { /* rotation failed — not fatal, just keep appending */ }
  }

  function append(event: SessionActivityEvent): boolean {
    if (!event.id || seen.has(event.id)) return false;

    // Bound the dedup set
    if (seen.size >= DEDUP_LIMIT) {
      const firstKey = seen.values().next().value;
      if (firstKey !== undefined) seen.delete(firstKey);
    }
    seen.add(event.id);

    const entry: ObservationEntry = {
      at: event.at,
      sessionId: event.sessionId,
      cwd: event.cwd,
      tool: event.tool,
      kind: event.kind,
      path: normalizePath(event.path, event.cwd),
      isSidechain: event.isSidechain,
      id: event.id,
    };

    try {
      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch { /* disk full, permissions, etc. — not fatal */ }

    maybeRotate();
    return true;
  }

  function readAll(opts?: { sessionId?: string; pathPrefix?: string }): ObservationEntry[] {
    if (!existsSync(filePath)) return [];
    try {
      const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
      let entries: ObservationEntry[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch { /* skip */ }
      }
      if (opts?.sessionId) {
        entries = entries.filter(e => e.sessionId === opts.sessionId);
      }
      if (opts?.pathPrefix) {
        entries = entries.filter(e => e.path.startsWith(opts.pathPrefix!));
      }
      return entries;
    } catch {
      return [];
    }
  }

  function readFrom(lineOffset: number): { entries: ObservationEntry[]; nextOffset: number } {
    if (!existsSync(filePath)) return { entries: [], nextOffset: 0 };
    try {
      const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
      const entries: ObservationEntry[] = [];
      for (let i = lineOffset; i < lines.length; i++) {
        try {
          entries.push(JSON.parse(lines[i]));
        } catch { /* skip */ }
      }
      return { entries, nextOffset: lines.length };
    } catch {
      return { entries: [], nextOffset: lineOffset };
    }
  }

  function stats(): ObservationStats {
    const entries = readAll();
    const byTool: Record<string, number> = {};
    const bySession: Record<string, number> = {};
    const byTopFolder: Record<string, number> = {};

    for (const e of entries) {
      byTool[e.tool] = (byTool[e.tool] || 0) + 1;
      bySession[e.sessionId] = (bySession[e.sessionId] || 0) + 1;
      if (e.path) {
        const topFolder = e.path.split('/')[0] || '.';
        byTopFolder[topFolder] = (byTopFolder[topFolder] || 0) + 1;
      }
    }

    let fileSizeBytes = 0;
    try {
      if (existsSync(filePath)) fileSizeBytes = statSync(filePath).size;
    } catch { /* ignore */ }

    return {
      totalEvents: entries.length,
      byTool,
      bySession,
      byTopFolder,
      fileSizeBytes,
    };
  }

  function purge(): void {
    try {
      if (existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
      if (existsSync(archivePath)) writeFileSync(archivePath, '', 'utf-8');
      seen.clear();
    } catch { /* ignore */ }
  }

  return { append, readAll, readFrom, stats, purge, filePath };
}
