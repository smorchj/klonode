/**
 * GET /api/worker/[id]/tail?since=<bytes>&repoPath=<abs>
 *
 * Server-sent-events stream that tails the log file a detached Claude worker
 * is writing to. Starts at the caller-supplied byte offset so a reconnecting
 * browser doesn't replay events it has already rendered.
 *
 * The tail loop:
 *   1. `open` the log file read-only (separate fd from the child's write fd).
 *   2. Seek to `since`, read what's there, parse any complete `stream-json`
 *      lines, emit mapped SSE events with the byte offset advancing.
 *   3. Use `fs.watch` to get notified on subsequent appends; re-read, re-emit.
 *   4. When the worker's PID stops existing AND the file has no more unread
 *      data, emit `{ type: 'done', exitCode: null }` and close the stream.
 *   5. If the SSE connection itself is closed by the browser, `fs.watch` is
 *      unregistered but the worker keeps running — the browser can reconnect
 *      later from the new offset.
 *
 * See #73.
 */

import { existsSync, openSync, fstatSync, readSync, closeSync, watch, readFileSync } from 'fs';
import type { RequestHandler } from './$types';
import type { WorkerStreamEvent } from '$lib/workers/worker-protocol';
import {
  resolveRepoRoot,
  workerLogPath,
  workerPidPath,
  workerMetaPath,
} from '$lib/workers/worker-paths';

/** Poll interval for the liveness probe when fs.watch doesn't fire. */
const POLL_MS = 500;

export const GET: RequestHandler = async ({ params, url, request }) => {
  const workerId = params.id;
  if (!workerId) {
    return new Response(
      JSON.stringify({ error: 'missing worker id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const repoRoot = resolveRepoRoot(url.searchParams.get('repoPath'));
  const logPath = workerLogPath(repoRoot, workerId);
  const pidPath = workerPidPath(repoRoot, workerId);
  const metaPath = workerMetaPath(repoRoot, workerId);

  if (!existsSync(logPath)) {
    return new Response(
      JSON.stringify({
        error: 'no log file for this worker id — has it been spawned?',
        logPath,
        repoPath: repoRoot,
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const startOffset = Number.parseInt(url.searchParams.get('since') || '0', 10) || 0;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let offset = startOffset;
      let closed = false;
      let watcher: ReturnType<typeof watch> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      function send(ev: WorkerStreamEvent): void {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`),
          );
        } catch {
          closed = true;
        }
      }

      function close(): void {
        if (closed) return;
        closed = true;
        if (watcher) {
          try { watcher.close(); } catch { /* ignore */ }
          watcher = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        try { controller.close(); } catch { /* ignore */ }
      }

      // Abort handler — if the browser disconnects, stop tailing but leave
      // the worker alive. Next reconnect picks up from whatever offset the
      // browser last persisted.
      request.signal.addEventListener('abort', close);

      // Buffer for partial lines across reads.
      let buffer = '';

      function translateLine(line: string, lineOffset: number): WorkerStreamEvent[] {
        const events: WorkerStreamEvent[] = [];
        if (!line.trim()) return events;
        // Skip our own header lines.
        if (line.startsWith('#') || line.startsWith('---')) return events;

        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          // Not valid JSON — treat as stderr so the UI can at least show it.
          events.push({ type: 'stderr', offset: lineOffset, text: line.slice(0, 200) });
          return events;
        }

        // Session init
        if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
          events.push({ type: 'session', offset: lineOffset, sessionId: parsed.session_id });
        }

        // Assistant content — tool_use and text blocks
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === 'tool_use') {
              events.push({
                type: 'tool',
                offset: lineOffset,
                tool: block.name,
                input: summarizeToolInput(block.name, block.input),
              });
            } else if (block.type === 'text' && block.text) {
              events.push({ type: 'text', offset: lineOffset, text: block.text });
            }
          }
        }

        // Final result
        if (parsed.type === 'result') {
          events.push({
            type: 'result',
            offset: lineOffset,
            text:
              typeof parsed.result === 'string'
                ? parsed.result
                : Array.isArray(parsed.result)
                ? parsed.result
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text)
                    .join('\n')
                : '',
            usage: parsed.usage,
            costUsd: parsed.total_cost_usd,
            numTurns: parsed.num_turns,
            subtype: parsed.subtype,
          });
        }

        return events;
      }

      function drainLog(): void {
        if (closed) return;
        let fd = -1;
        try {
          fd = openSync(logPath, 'r');
        } catch {
          return;
        }
        try {
          const stat = fstatSync(fd);
          if (stat.size <= offset) return; // nothing new
          const toRead = stat.size - offset;
          const buf = Buffer.alloc(toRead);
          readSync(fd, buf, 0, toRead, offset);
          offset += toRead;

          buffer += buf.toString('utf-8');
          const lines = buffer.split('\n');
          // Keep the last (possibly incomplete) line in the buffer.
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            for (const ev of translateLine(line, offset)) {
              send(ev);
            }
          }
        } finally {
          try { closeSync(fd); } catch { /* ignore */ }
        }
      }

      function pidAlive(): boolean {
        if (!existsSync(pidPath)) return false;
        try {
          const pid = Number.parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
          if (!pid) return false;
          // `process.kill(pid, 0)` is a posix/win32 idiom to test existence.
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }

      function checkDoneOrKeepGoing(): void {
        if (closed) return;
        drainLog();
        if (!pidAlive()) {
          // Child has exited. Drain one more time to catch the tail, then
          // signal done to the client.
          drainLog();
          let exitCode: number | null = null;
          try {
            const metaRaw = readFileSync(metaPath, 'utf-8');
            const meta = JSON.parse(metaRaw);
            if (typeof meta.exitCode === 'number') exitCode = meta.exitCode;
          } catch { /* ignore */ }
          send({ type: 'done', offset, exitCode });
          close();
        }
      }

      // Initial drain — emit anything already in the log since the
      // caller-supplied offset.
      drainLog();

      // If the worker is already dead and drain caught up, we're done.
      if (!pidAlive()) {
        send({ type: 'done', offset, exitCode: null });
        close();
        return;
      }

      // Watch the log file for appends. `fs.watch` is fast-path; the poll
      // interval is a belt-and-suspenders fallback because fs.watch is
      // unreliable on Windows network drives and some filesystems.
      try {
        watcher = watch(logPath, { persistent: false }, () => {
          drainLog();
        });
      } catch {
        // fs.watch not supported — rely on polling only.
      }
      pollTimer = setInterval(checkDoneOrKeepGoing, POLL_MS);
    },

    cancel() {
      // Browser aborted — nothing to do; the close() handler in start() will
      // fire via the AbortSignal listener.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};

/**
 * Condense a tool's input object into a short human-readable string. Copy of
 * the helper in /api/chat/stream. Kept local to avoid cross-importing a
 * server-only function from the legacy handler.
 */
function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    return String(o.file_path ?? '').slice(0, 200);
  }
  if (name === 'Bash') {
    return String(o.command ?? '').slice(0, 200);
  }
  if (name === 'Glob') {
    return String(o.pattern ?? '').slice(0, 200);
  }
  if (name === 'Grep') {
    return `${o.pattern ?? ''}${o.path ? ` in ${o.path}` : ''}`.slice(0, 200);
  }
  return JSON.stringify(o).slice(0, 200);
}
