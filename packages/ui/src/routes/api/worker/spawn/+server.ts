/**
 * POST /api/worker/spawn
 *
 * Spawns the Claude CLI as a detached child process whose stdout + stderr are
 * redirected straight into `.klonode/workers/<id>.log`. The child's PID is
 * persisted so a later `/api/worker/[id]/stop` call can SIGTERM it, and a
 * metadata file records the original spawn args for recovery.
 *
 * Because the child is `detached: true` with `stdio: ['ignore', fd, fd]`,
 * it is NOT tied to the Vite dev server's lifetime. When Vite restarts
 * (because the user — or Klonode itself — edited a server-side file) the
 * worker keeps running, its output keeps landing in the log file, and a
 * fresh tail request picks up from the last byte offset the browser
 * acknowledged.
 *
 * This is the minimum viable version of the detached-worker architecture
 * described in #73. Future follow-ups layer on named-pipe / unix-socket IPC
 * for two-way control and a standalone `packages/worker/` binary.
 */

import { json } from '@sveltejs/kit';
import { spawn } from 'child_process';
import { existsSync, openSync, readFileSync, writeFileSync, writeSync, closeSync } from 'fs';
import { join } from 'path';
import type { RequestHandler } from './$types';
import type { WorkerMeta, WorkerSpawnResponse } from '$lib/workers/worker-protocol';
import {
  ensureWorkersDir,
  newWorkerId,
  resolveRepoRoot,
  workerLogPath,
  workerMetaPath,
  workerPidPath,
} from '$lib/workers/worker-paths';

interface SpawnRequest {
  /** Full path to the Claude CLI binary. */
  cliPath: string;
  /** Root of the project Klonode is operating on. Used as the worker's cwd. */
  repoPath: string;
  /** The prompt text to pipe into Claude on stdin. */
  prompt: string;
  /** Max turns the worker is allowed. Defaults to 500. */
  maxTurns?: number;
  /** Allowed tool names. Defaults to the full file-editing set. */
  allowedTools?: string[];
  /** Optional model override (e.g. for CO runs). */
  model?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const body: SpawnRequest = await request.json();

  const cliPath = body.cliPath || 'claude';
  const repoRoot = resolveRepoRoot(body.repoPath);
  const workerId = newWorkerId();

  ensureWorkersDir(repoRoot);
  const logPath = workerLogPath(repoRoot, workerId);
  const pidPath = workerPidPath(repoRoot, workerId);
  const metaPath = workerMetaPath(repoRoot, workerId);

  // Write the prompt to a temp file so we can pipe it to Claude without
  // tangling with cmd.exe / bash shell quoting.
  const promptPath = join(repoRoot, '.klonode', 'workers', `${workerId}.prompt.txt`);
  writeFileSync(promptPath, body.prompt, 'utf-8');

  // Build Claude CLI args. Mirrors the existing stream handler.
  const maxTurns = body.maxTurns ?? 500;
  const tools = body.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
  const args = [
    '-p',
    '--verbose',
    '--max-turns',
    String(maxTurns),
    '--output-format',
    'stream-json',
    '--allowedTools',
    tools.join(','),
  ];
  if (body.model) {
    args.push('--model', body.model);
  }

  // Environment cleanup — avoid polluting the worker with Klonode's own
  // Claude Code env vars that would confuse the spawned instance.
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_AGENT_SDK_VERSION;
  delete cleanEnv.CLAUDE_CODE_DISABLE_CRON;
  delete cleanEnv.CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES;
  delete cleanEnv.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL;
  delete cleanEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
  delete cleanEnv.DEFAULT_LLM_MODEL;
  // Restore the OAuth token from the Klonode-managed file if it isn't
  // already in the env. Without this the spawned Claude returns
  // "Not logged in" because the env cleanup above dropped the parent
  // process's token. Mirrors the logic in the legacy /api/chat/stream.
  if (!cleanEnv.CLAUDE_CODE_OAUTH_TOKEN) {
    try {
      const tokenPath = join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'klonode-oauth-token');
      if (existsSync(tokenPath)) {
        cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = readFileSync(tokenPath, 'utf-8').trim();
      }
    } catch { /* ignore */ }
  }
  if (!cleanEnv.HOME && cleanEnv.USERPROFILE) {
    cleanEnv.HOME = cleanEnv.USERPROFILE;
  }

  // Open the log file ourselves so the child inherits an fd that is
  // decoupled from any file-handle state the parent holds. If we used
  // `openSync(logPath, 'a')` directly in the spawn options the child would
  // inherit *our* lifetime for that handle, which would be closed when the
  // parent Vite process exits — defeating the whole point.
  const outFd = openSync(logPath, 'a');
  // Write a small header so the log is self-documenting.
  writeSync(
    outFd,
    `# klonode-worker ${workerId} started at ${new Date().toISOString()}\n# cli=${cliPath}\n# repo=${repoRoot}\n# args=${args.join(' ')}\n---\n`,
  );

  // Run through bash on Windows (matches the existing stream handler) so
  // the stdin redirect from the prompt file works the same on every OS.
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' : '/bin/bash';
  const bashCliPath = cliPath.replace(/\\/g, '/');
  const bashPromptPath = promptPath.replace(/\\/g, '/');
  const shellCmd = `"${bashCliPath}" ${args.join(' ')} < "${bashPromptPath}"`;

  const child = spawn(shell, ['-c', shellCmd], {
    cwd: repoRoot,
    env: cleanEnv,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    windowsHide: true,
  });

  // `unref()` tells Node not to keep the parent alive on behalf of this
  // child. Combined with `detached: true` and `stdio: ['ignore', fd, fd]`
  // this means the child survives a parent exit — which is the entire
  // point of the detached worker architecture (#73).
  child.unref();

  if (!child.pid) {
    // Spawn failed synchronously. Close the fd we opened and bail.
    try { closeSync(outFd); } catch { /* ignore */ }
    return json({ error: 'failed to spawn Claude CLI worker' }, { status: 500 });
  }

  // We can close the fd on the parent side now — the OS keeps the file
  // open for the child because the dup2 that spawn did transfers
  // ownership. The child writes independently after this.
  try { closeSync(outFd); } catch { /* ignore */ }

  // Persist PID + meta so /stop and /tail can find the worker later.
  writeFileSync(pidPath, String(child.pid), 'utf-8');
  const meta: WorkerMeta = {
    id: workerId,
    pid: child.pid,
    repoPath: repoRoot,
    cwd: repoRoot,
    cliPath,
    startedAt: new Date().toISOString(),
    prompt: body.prompt,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  const response: WorkerSpawnResponse = {
    workerId,
    repoPath: repoRoot,
    logPath,
  };
  return json(response);
};
