/**
 * Shared filesystem paths used by the detached Claude worker system.
 *
 * The worker writes its output to a log file on disk and records its PID
 * alongside it. Multiple Klonode components read these paths:
 *   - `/api/worker/spawn` writes them when it starts a worker
 *   - `/api/worker/[id]/tail` reads the log file
 *   - `/api/worker/[id]/stop` reads the PID file
 *   - Boot-time cleanup removes stale entries for workers whose PIDs no
 *     longer exist
 *
 * See #73 for the full architecture.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

/** Directory under the repo root where detached workers write their state. */
export function workersDir(repoRoot: string): string {
  return join(repoRoot, '.klonode', 'workers');
}

/** Ensure the workers directory exists. Returns the resolved path. */
export function ensureWorkersDir(repoRoot: string): string {
  const dir = workersDir(repoRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Log file for a given worker id. stdout + stderr both get redirected here. */
export function workerLogPath(repoRoot: string, workerId: string): string {
  return join(workersDir(repoRoot), `${workerId}.log`);
}

/** PID file so /api/worker/[id]/stop can read it and send SIGTERM. */
export function workerPidPath(repoRoot: string, workerId: string): string {
  return join(workersDir(repoRoot), `${workerId}.pid`);
}

/** Metadata file describing the worker (spawn args, cwd, start time). */
export function workerMetaPath(repoRoot: string, workerId: string): string {
  return join(workersDir(repoRoot), `${workerId}.meta.json`);
}

/** Generate a random worker id. Short enough to embed in URLs. */
export function newWorkerId(): string {
  return `w-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

/** Resolve the repo root from a request. Defaults to process.cwd(). */
export function resolveRepoRoot(explicit: string | null | undefined): string {
  if (explicit && existsSync(explicit)) return explicit;
  return process.cwd();
}
