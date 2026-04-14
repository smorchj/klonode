/**
 * Telemetry collection for self-improvement.
 * Tracks which files Claude reads/writes per session to optimize routing over time.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TaskCategory } from '../model/routing-graph.js';

export interface SessionEvent {
  timestamp: Date;
  type: 'read' | 'write' | 'search';
  filePath: string;
  taskCategory: TaskCategory;
  tokenCount: number;
}

export interface SessionLog {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  events: SessionEvent[];
  taskDescription: string;
  success: boolean | null;
}

const SESSION_LOG_DIR = '.klonode/telemetry';

/**
 * Record a file access event.
 */
export function recordEvent(
  repoPath: string,
  sessionId: string,
  event: SessionEvent,
): void {
  const logDir = path.join(repoPath, SESSION_LOG_DIR);
  fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(logDir, `${sessionId}.jsonl`);
  const line = JSON.stringify({
    ...event,
    timestamp: event.timestamp.toISOString(),
  }) + '\n';

  fs.appendFileSync(logFile, line, 'utf-8');
}

/**
 * Load all session events from a session log.
 */
export function loadSession(repoPath: string, sessionId: string): SessionEvent[] {
  const logFile = path.join(repoPath, SESSION_LOG_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(logFile)) return [];

  const content = fs.readFileSync(logFile, 'utf-8');
  return content
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const parsed = JSON.parse(line);
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
      };
    });
}

/**
 * List all session IDs.
 */
export function listSessions(repoPath: string): string[] {
  const logDir = path.join(repoPath, SESSION_LOG_DIR);
  if (!fs.existsSync(logDir)) return [];

  return fs
    .readdirSync(logDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''));
}

/**
 * Build an access frequency map: filePath -> accessCount.
 */
export function buildAccessMap(
  repoPath: string,
): Map<string, number> {
  const accessMap = new Map<string, number>();
  const sessions = listSessions(repoPath);

  for (const sessionId of sessions) {
    const events = loadSession(repoPath, sessionId);
    for (const event of events) {
      const normalized = event.filePath.replace(/\\/g, '/');
      accessMap.set(normalized, (accessMap.get(normalized) || 0) + 1);
    }
  }

  return accessMap;
}

/**
 * Build directory-level access frequency from file access data.
 */
export function buildDirAccessMap(
  repoPath: string,
): Map<string, number> {
  const fileAccess = buildAccessMap(repoPath);
  const dirAccess = new Map<string, number>();

  for (const [filePath, count] of fileAccess) {
    const dir = path.dirname(filePath).replace(/\\/g, '/');
    dirAccess.set(dir, (dirAccess.get(dir) || 0) + count);
  }

  return dirAccess;
}

/**
 * Generate the CLAUDE.md instruction that tells Claude to log its file access.
 * This is the "Approach B" self-improvement hook.
 */
export function generateTelemetryInstruction(): string {
  return `
## Session Logging (Klonode Self-Improvement)
After completing each task, append a brief log entry to \`.klonode/session-log.md\`:
\`\`\`
### [task description]
- Files read: [list of file paths]
- Files modified: [list of file paths]
- Task type: feature|bugfix|refactor|test|docs|config
- Success: yes|no
\`\`\`
This helps Klonode optimize routing for future sessions.
`.trim();
}
