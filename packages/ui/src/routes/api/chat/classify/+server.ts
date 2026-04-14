/**
 * Classify endpoint — asks Claude to determine the best execution mode for a query.
 * Uses a tiny prompt with --max-turns 1 and no tools for speed.
 * Returns { mode: 'question' | 'plan' | 'bypass' }
 */

import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { RequestHandler } from './$types';

const execAsync = promisify(exec);

const CLASSIFY_PROMPT = `You are a query classifier. Given a user message about a codebase, respond with EXACTLY one word — the best execution mode:

- "question" — The user just wants information, an explanation, or an overview. No code changes needed.
- "plan" — The user wants complex changes that affect multiple files, need careful planning, or carry risk (refactoring, migrations, architecture changes, setting up new systems).
- "bypass" — The user wants a direct code change: a fix, adding something, removing something, updating code. Straightforward enough to just do it.

Respond with ONLY the single word: question, plan, or bypass. Nothing else.

User message:`;

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, connectionMode, cliPath, apiKey } = body;

  try {
    let mode = 'bypass'; // default fallback

    if (connectionMode === 'cli') {
      mode = await classifyViaCli(message, cliPath);
    } else if (connectionMode === 'api' && apiKey) {
      mode = await classifyViaApi(message, apiKey);
    }

    return json({ mode });
  } catch (err) {
    console.warn('[Klonode Classify] Error, defaulting to bypass:', err);
    return json({ mode: 'bypass' });
  }
};

async function classifyViaCli(message: string, cliPath: string): Promise<string> {
  const fs = await import('fs');
  const pathMod = await import('path');
  const tmpDir = process.env.TEMP || process.env.TMP || '/tmp';
  const tmpFile = pathMod.join(tmpDir, `klonode-classify-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, `${CLASSIFY_PROMPT}\n${message}`, 'utf-8');

  const bashTmpPath = tmpFile.replace(/\\/g, '/');
  const bashCliPath = (cliPath || 'claude').replace(/\\/g, '/');
  const shellCmd = `"${bashCliPath}" -p --max-turns 1 --output-format json < "${bashTmpPath}"`;

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_AGENT_SDK_VERSION;
  delete cleanEnv.CLAUDE_CODE_DISABLE_CRON;
  delete cleanEnv.CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES;
  delete cleanEnv.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL;

  if (!cleanEnv.CLAUDE_CODE_OAUTH_TOKEN) {
    try {
      const tokenPath = pathMod.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'klonode-oauth-token');
      if (fs.existsSync(tokenPath)) {
        cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = fs.readFileSync(tokenPath, 'utf-8').trim();
      }
    } catch { /* ignore */ }
  }

  if (!cleanEnv.HOME && cleanEnv.USERPROFILE) {
    cleanEnv.HOME = cleanEnv.USERPROFILE;
  }

  try {
    const result = await execAsync(shellCmd, {
      timeout: 15000, // 15 sec max for classification
      maxBuffer: 512 * 1024,
      shell: process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' : '/bin/bash',
      env: cleanEnv as any,
    });

    // Parse the result
    const lines = result.stdout.trim().split('\n');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.result === 'string') {
          const word = parsed.result.trim().toLowerCase();
          if (word === 'question' || word === 'plan' || word === 'bypass') {
            return word;
          }
        }
      } catch { /* skip */ }
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }

  return 'bypass';
}

async function classifyViaApi(message: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022', // Use cheapest model for classification
      max_tokens: 10,
      messages: [{ role: 'user', content: `${CLASSIFY_PROMPT}\n${message}` }],
    }),
  });

  if (!response.ok) return 'bypass';

  const data = await response.json();
  const text = (data.content?.[0]?.text || '').trim().toLowerCase();
  if (text === 'question' || text === 'plan' || text === 'bypass') {
    return text;
  }
  return 'bypass';
}
