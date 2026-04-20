/**
 * Shared types between the server-side worker endpoints and the browser-side
 * worker client. The events emitted by the tail endpoint mirror the existing
 * chat-stream SSE events so ChatPanel can reuse the same event handling code
 * when it's connected to a worker.
 *
 * See #73.
 */

/**
 * A metadata record persisted to `.klonode/workers/<id>.meta.json`. The tail
 * endpoint reads this to know where the log file is and whether the worker
 * is still considered alive.
 */
export interface WorkerMeta {
  id: string;
  pid: number;
  repoPath: string;
  cwd: string;
  cliPath: string;
  startedAt: string; // ISO timestamp
  /** The prompt that was passed in. Stored for debugging / recovery. */
  prompt: string;
  /** Set to true by /api/worker/[id]/stop after SIGTERM succeeds. */
  stopped?: boolean;
  /** Set by the tail endpoint when the child exits cleanly. */
  exitCode?: number;
}

/**
 * The events the tail endpoint streams back to the browser. One per
 * `stream-json` line emitted by the Claude CLI, translated through the same
 * mapping the legacy /api/chat/stream endpoint used. Byte offsets into the
 * log file are passed alongside so the browser can resume by offset if the
 * SSE connection drops.
 */
export type WorkerStreamEvent =
  | { type: 'session'; offset: number; sessionId: string }
  | { type: 'tool'; offset: number; tool: string; input: string }
  | { type: 'text'; offset: number; text: string }
  | {
      type: 'result';
      offset: number;
      text: string;
      usage?: unknown;
      costUsd?: number;
      numTurns?: number;
      subtype?: string;
    }
  | { type: 'stderr'; offset: number; text: string }
  | { type: 'error'; offset: number; message: string }
  | { type: 'done'; offset: number; exitCode: number | null };

/** Response shape from POST /api/worker/spawn. */
export interface WorkerSpawnResponse {
  workerId: string;
  repoPath: string;
  logPath: string;
}

/** Response shape from POST /api/worker/[id]/stop. */
export interface WorkerStopResponse {
  stopped: boolean;
  hadPid: boolean;
  wasAlive: boolean;
}
