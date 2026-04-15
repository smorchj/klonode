/**
 * Streaming chat endpoint — uses Server-Sent Events to stream CLI progress.
 * Shows tool_use events (file reads, edits, commands) in real-time.
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { RequestHandler } from './$types';

interface StreamRequest {
  message: string;
  context: string;
  cliPath: string;
  model?: string;
  mode: 'with-klonode' | 'without-klonode';
  repoPath?: string;
  routedPaths?: string[];
  executionMode?: 'question' | 'plan' | 'bypass';
  isCO?: boolean;
  /** Session ID for persistent conversations. Same session = Claude remembers history. */
  sessionId?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const body: StreamRequest = await request.json();
  const cliPath = body.cliPath || 'claude';
  // Validate repoPath exists on disk — otherwise fall back to the server's
  // cwd. The shipped demo graph has `/path/to/your/project` as a placeholder,
  // and if the user never configured a real repo path the first chat send
  // would spawn the CLI in a nonexistent directory and fail with an opaque
  // error. Falling back to process.cwd() gives a sane default.
  let cwd = body.repoPath || process.cwd();
  if (body.repoPath && !existsSync(body.repoPath)) {
    console.warn(
      `[Klonode Stream] repoPath "${body.repoPath}" does not exist on disk; ` +
      `falling back to process.cwd() = "${process.cwd()}". ` +
      `Configure a real repo path via settings or reinitialize the graph.`,
    );
    cwd = process.cwd();
  }

  // Build system prompt
  let systemPrompt: string;
  if (body.isCO) {
    systemPrompt = `You are an experienced developer with full access to all tools. Work directly in the project directory.

Answer in Norwegian unless the user writes in English. Write all code and CONTEXT.md files in English.`;
  } else if (body.mode === 'without-klonode') {
    systemPrompt = `Du er en erfaren programvareutvikler. Du jobber direkte i prosjektmappen. Bruk dine verktoy til a utforske kodebasen og lose oppgaven. Svar pa norsk med mindre brukeren skriver pa engelsk.`;
  } else {
    systemPrompt = body.context
      ? `Erfaren utvikler. Minimer verktoybruk.\n${body.context.slice(0, 500)}\nSvar pa norsk med mindre brukeren skriver pa engelsk.`
      : `Erfaren utvikler. Svar pa norsk med mindre brukeren skriver pa engelsk.`;
  }

  // Every message is a fresh spawn — always prepend the system prompt so
  // Claude has routing context. See the note below about why --resume was
  // dropped.
  const fullPrompt = `${systemPrompt}\n\nBrukerens sporsmaal: ${body.message}`;

  // Write prompt to temp file
  const tmpDir = process.env.TEMP || process.env.TMP || '/tmp';
  const tmpFile = join(tmpDir, `klonode-stream-${Date.now()}.txt`);
  writeFileSync(tmpFile, fullPrompt, 'utf-8');

  // Build CLI args
  const isCO = body.isCO;
  // Turn budget. Claude Code's interactive default is effectively unlimited;
  // a real coding task like "add a language extractor + tests" routinely
  // needs 80-150 tool calls. Previously bypass mode was capped at 50, which
  // hit the limit mid-task and made the session appear unresponsive with a
  // generic "Claude brukte alle steg" fallback. Raise bypass to 500 so tasks
  // of that shape actually complete. question/plan stay tight because they
  // exist precisely to cap turn spend.
  const maxTurns = isCO ? 500
    : body.executionMode === 'question' ? 1
    : body.executionMode === 'plan' ? 15
    : 500;
  const tools = body.executionMode === 'question' ? [] :
    body.executionMode === 'plan' ? ['Read', 'Glob', 'Grep'] :
    ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

  const args = ['-p', '--verbose', '--max-turns', String(maxTurns), '--output-format', 'stream-json'];

  // NOTE: `-p` mode session IDs are NOT reliably resumable — Claude CLI
  // returns "No conversation found with session ID: ..." on the second
  // invocation, which Klonode then renders as "Claude brukte alle steg".
  // Every send gets a fresh spawn. Continuity on the user side lives in the
  // persisted chatStore.messages; Claude re-routes against the graph on
  // every message, which matches Klonode's per-query routing philosophy
  // anyway. If/when we add real resume (interactive transport or prompt
  // replay), it goes here.

  if (tools.length > 0) {
    args.push('--allowedTools', tools.join(','));
  }
  if (isCO) {
    args.push('--model', 'claude-opus-4-6');
  }

  // Clean env
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_AGENT_SDK_VERSION;
  delete cleanEnv.CLAUDE_CODE_DISABLE_CRON;
  delete cleanEnv.CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES;
  delete cleanEnv.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL;
  delete cleanEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
  delete cleanEnv.DEFAULT_LLM_MODEL;

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

  const bashCliPath = cliPath.replace(/\\/g, '/');
  const bashTmpPath = tmpFile.replace(/\\/g, '/');

  console.log(`[Klonode Stream] Starting: ${bashCliPath} ${args.join(' ')}`);
  console.log(`[Klonode Stream] cwd: ${cwd}`);

  // Use ReadableStream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: any) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      // Spawn CLI with stdin from file
      const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' : '/bin/bash';
      const shellCmd = `"${bashCliPath}" ${args.join(' ')} < "${bashTmpPath}"`;

      const child = spawn(shell, ['-c', shellCmd], {
        cwd,
        env: cleanEnv as any,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let buffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);

            // Capture session ID from init event
            if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
              send('session', { sessionId: parsed.session_id });
            }

            // Stream different event types
            if (parsed.type === 'assistant' && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === 'tool_use') {
                  send('tool', {
                    tool: block.name,
                    input: summarizeToolInput(block.name, block.input),
                  });
                } else if (block.type === 'text' && block.text) {
                  send('text', { text: block.text });
                }
              }
            } else if (parsed.type === 'result') {
              send('result', {
                text: typeof parsed.result === 'string' ? parsed.result :
                  Array.isArray(parsed.result) ?
                    parsed.result.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '',
                usage: parsed.usage,
                costUsd: parsed.total_cost_usd,
                numTurns: parsed.num_turns,
                subtype: parsed.subtype,
              });
            }
          } catch { /* skip non-JSON lines */ }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) send('stderr', { text: text.slice(0, 200) });
      });

      child.on('close', (code) => {
        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.type === 'result') {
              send('result', {
                text: typeof parsed.result === 'string' ? parsed.result :
                  Array.isArray(parsed.result) ?
                    parsed.result.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '',
                usage: parsed.usage,
                costUsd: parsed.total_cost_usd,
                numTurns: parsed.num_turns,
                subtype: parsed.subtype,
              });
            }
          } catch { /* skip */ }
        }

        send('done', { code });
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        controller.close();
      });

      child.on('error', (err) => {
        send('error', { message: err.message });
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};

/** Summarize tool input for display */
function summarizeToolInput(tool: string, input: any): string {
  if (!input) return '';
  switch (tool) {
    case 'Read': return input.file_path || input.path || '';
    case 'Write': return input.file_path || input.path || '';
    case 'Edit': return input.file_path || input.path || '';
    case 'Glob': return input.pattern || '';
    case 'Grep': return `${input.pattern || ''} ${input.path || ''}`.trim();
    case 'Bash': return (input.command || '').slice(0, 80);
    default: return JSON.stringify(input).slice(0, 80);
  }
}
