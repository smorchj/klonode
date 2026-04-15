/**
 * POST /api/worker/[id]/stop?repoPath=<abs>
 *
 * Sends SIGTERM to the detached Claude worker identified by `id`. Reads the
 * PID from the `.klonode/workers/<id>.pid` file written at spawn time.
 *
 * Returns 200 regardless of whether the worker was actually alive — the
 * idempotent behavior means a UI retry after a failed stop is safe. The
 * response body reports what actually happened so the caller can tell the
 * user whether the Stop click did anything.
 *
 * See #73.
 */

import { json } from '@sveltejs/kit';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { RequestHandler } from './$types';
import type { WorkerMeta, WorkerStopResponse } from '$lib/workers/worker-protocol';
import {
  resolveRepoRoot,
  workerMetaPath,
  workerPidPath,
} from '$lib/workers/worker-paths';

export const POST: RequestHandler = async ({ params, url }) => {
  const workerId = params.id;
  if (!workerId) {
    return json({ error: 'missing worker id' }, { status: 400 });
  }

  const repoRoot = resolveRepoRoot(url.searchParams.get('repoPath'));
  const pidPath = workerPidPath(repoRoot, workerId);
  const metaPath = workerMetaPath(repoRoot, workerId);

  const response: WorkerStopResponse = {
    stopped: false,
    hadPid: false,
    wasAlive: false,
  };

  if (!existsSync(pidPath)) {
    return json(response);
  }

  response.hadPid = true;
  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
  } catch {
    return json(response);
  }
  if (!pid) return json(response);

  // Liveness probe using signal 0 — a platform-portable way to ask "is this
  // PID still a running process I can signal?"
  try {
    process.kill(pid, 0);
    response.wasAlive = true;
  } catch {
    response.wasAlive = false;
  }

  if (!response.wasAlive) {
    // Already dead. Update the meta file so other readers see the terminal
    // state consistently.
    markStopped(metaPath, null);
    return json(response);
  }

  try {
    // SIGTERM first. On Windows this maps to TerminateProcess via Node's
    // signal-handling layer, which is good enough for our wrapped bash.
    process.kill(pid, 'SIGTERM');
    response.stopped = true;
  } catch {
    response.stopped = false;
  }

  if (response.stopped) {
    markStopped(metaPath, null);
  }

  return json(response);
};

function markStopped(metaPath: string, exitCode: number | null): void {
  if (!existsSync(metaPath)) return;
  try {
    const raw = readFileSync(metaPath, 'utf-8');
    const meta = JSON.parse(raw) as WorkerMeta;
    meta.stopped = true;
    if (exitCode !== null) meta.exitCode = exitCode;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}
