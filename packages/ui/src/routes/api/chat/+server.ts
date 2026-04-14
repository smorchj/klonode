/**
 * Chat API endpoint — proxies to Claude CLI or Anthropic API.
 * CLI mode: spawns claude CLI with -p flag
 * API mode: calls Anthropic API directly
 */

import { json } from '@sveltejs/kit';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { RequestHandler } from './$types';

const execAsync = promisify(exec);

interface ChatRequest {
  message: string;
  context: string;
  connectionMode: 'cli' | 'api';
  cliPath?: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  mode: 'with-klonode' | 'without-klonode';
  /** Absolute path to the project root (from graph.repoPath) */
  repoPath?: string;
  /** Relative folder paths to read source files from (routed folders) */
  routedPaths?: string[];
  /** Execution mode: question (context only), plan (read+plan), bypass (full access) */
  executionMode?: 'question' | 'plan' | 'bypass';
  /** Whether this is the Chief Organizer session */
  isCO?: boolean;
}

export const POST: RequestHandler = async ({ request }) => {
  const body: ChatRequest = await request.json();

  try {
    // Build prompt based on execution mode
    const execMode = body.executionMode || 'bypass';
    let systemPrompt: string;

    if (body.isCO) {
      systemPrompt = `You are an experienced developer with full access to all tools. Work directly in the project directory.

Answer in Norwegian unless the user writes in English. Write all code and CONTEXT.md files in English.`;
    } else if (body.mode === 'without-klonode') {
      // Comparison mode: NO Klonode context — raw Claude, like normal users
      systemPrompt = `Du er en erfaren programvareutvikler. Du jobber direkte i prosjektmappen. Bruk dine verktøy (Read, Grep, Edit, etc.) til å utforske kodebasen og løse oppgaven. Svar på norsk med mindre brukeren skriver på engelsk.`;
    } else {
      systemPrompt = buildKlonodePrompt(body.context, execMode);
    }

    console.log(`[Klonode] Prompt size: ${systemPrompt.length} chars, repo: ${body.repoPath || 'none'}`);

    if (body.connectionMode === 'cli') {
      return await handleCli(body, systemPrompt);
    } else {
      return await handleApi(body, systemPrompt);
    }
  } catch (err) {
    console.error('[Klonode] Error:', err);
    const msg = err instanceof Error ? err.message : 'Ukjent feil';
    return json({ error: msg }, { status: 500 });
  }
};

/**
 * Auto-detect Claude CLI location on the system.
 * Scans known install paths directly via filesystem (fast, no PowerShell).
 */
export const GET: RequestHandler = async () => {
  const fs = await import('fs');
  const path = await import('path');

  // 1. Check versioned paths under AppData/Roaming/Claude/claude-code/
  const appDataDir = process.env.APPDATA;
  if (appDataDir) {
    const codeDir = path.join(appDataDir, 'Claude', 'claude-code');
    try {
      const versions = fs.readdirSync(codeDir)
        .filter((d: string) => /^\d+\.\d+/.test(d))
        .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));
      for (const ver of versions) {
        const exe = path.join(codeDir, ver, 'claude.exe');
        if (fs.existsSync(exe)) {
          return json({ cliPath: exe, detected: true });
        }
      }
    } catch { /* dir doesn't exist */ }
  }

  // 2. Check common flat paths
  const candidates = [
    appDataDir && path.join(appDataDir, 'Claude', 'claude-code', 'claude.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'),
    // macOS/Linux
    '/usr/local/bin/claude',
    path.join(process.env.HOME || '', '.claude', 'bin', 'claude'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return json({ cliPath: c, detected: true });
    }
  }

  // 3. Try running 'claude' directly (in PATH)
  try {
    await execAsync('claude --version', { timeout: 5000 });
    return json({ cliPath: 'claude', detected: true });
  } catch { /* not in PATH */ }

  return json({ cliPath: '', detected: false });
};

async function handleCli(body: ChatRequest, systemPrompt: string): Promise<Response> {
  const cliPath = body.cliPath || 'claude';

  if (!cliPath) {
    return json({ error: 'Claude CLI-sti er ikke konfigurert. Gå til innstillinger.' }, { status: 400 });
  }

  const fullPrompt = `${systemPrompt}\n\nBrukerens spørsmål: ${body.message}`;

  const startTime = Date.now();

  // Write prompt to temp file, use bash stdin redirection to feed it to CLI
  // Clean env removes CLAUDECODE (nesting flag) and ensures HOME is set
  const fs = await import('fs');
  const pathMod = await import('path');
  const tmpDir = process.env.TEMP || process.env.TMP || '/tmp';
  const tmpFile = pathMod.join(tmpDir, `klonode-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, fullPrompt, 'utf-8');

  const bashTmpPath = tmpFile.replace(/\\/g, '/');
  const bashCliPath = cliPath.replace(/\\/g, '/');

  // Build CLI flags based on execution mode
  const execMode = body.executionMode || 'bypass';
  let maxTurns: number;
  let allowedTools: string;

  if (body.isCO) {
    // CO: same as a real Claude Code session — no turn limit, all tools, opus 1M
    maxTurns = 200;
    allowedTools = '--allowedTools "Read,Write,Edit,Bash,Glob,Grep" --model claude-opus-4-6';
  } else {
    switch (execMode) {
      case 'question':
        maxTurns = 1;
        allowedTools = '';
        break;
      case 'plan':
        maxTurns = body.mode === 'with-klonode' ? 6 : 15;
        allowedTools = '--allowedTools "Read,Glob,Grep"';
        break;
      case 'bypass':
      default:
        maxTurns = body.mode === 'with-klonode' ? 4 : 25;
        allowedTools = '--allowedTools "Read,Write,Edit,Bash,Glob,Grep"';
        break;
    }
  }

  const shellCmd = `"${bashCliPath}" -p --max-turns ${maxTurns} ${allowedTools} --output-format json < "${bashTmpPath}"`.replace(/  +/g, ' ');
  // Build clean env for CLI subprocess
  // Must include CLAUDE_CODE_OAUTH_TOKEN for auth but remove CLAUDECODE (nesting block)
  const cleanEnv = { ...process.env };
  // Remove ALL Claude nesting flags to prevent subprocess from being blocked
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_AGENT_SDK_VERSION;
  delete cleanEnv.CLAUDE_CODE_DISABLE_CRON;
  delete cleanEnv.CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES;
  delete cleanEnv.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL;
  delete cleanEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
  delete cleanEnv.DEFAULT_LLM_MODEL;

  // If OAuth token not in env (e.g. server started by preview tool), try reading from token file
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

  console.log(`[Klonode CLI] cmd: ${shellCmd}`);
  console.log(`[Klonode CLI] has oauth token: ${!!cleanEnv.CLAUDE_CODE_OAUTH_TOKEN}`);

  // Run CLI from the repo directory so it can access project files with tools
  const cwd = body.repoPath || process.cwd();
  console.log(`[Klonode CLI] cwd: ${cwd}`);

  let result: { stdout: string; stderr: string };
  try {
    result = await execAsync(shellCmd, {
      timeout: body.isCO ? 1800000 : 300000, // CO: 30 min, regular: 5 min
      maxBuffer: 10 * 1024 * 1024, // 10MB — tool use generates more output
      shell: process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' : '/bin/bash',
      env: cleanEnv as any,
      cwd,
    });
  } catch (execErr: any) {
    // exec throws on non-zero exit — capture stdout/stderr anyway
    console.error(`[Klonode CLI] exec error:`, execErr.message);
    console.error(`[Klonode CLI] exec stdout:`, (execErr.stdout || '').slice(0, 500));
    console.error(`[Klonode CLI] exec stderr:`, (execErr.stderr || '').slice(0, 500));
    console.error(`[Klonode CLI] exec code:`, execErr.code, 'signal:', execErr.signal, 'killed:', execErr.killed);
    if (execErr.stdout || execErr.stderr) {
      result = { stdout: execErr.stdout || '', stderr: execErr.stderr || '' };
    } else {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      throw new Error(execErr.stderr || execErr.message || 'CLI feilet');
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Klonode CLI] stdout (first 500): ${result.stdout.slice(0, 500)}`);
  console.log(`[Klonode CLI] stderr (first 500): ${result.stderr.slice(0, 500)}`);

  // Parse CLI JSON output — format: { type: "result", result: "...", usage: {...}, ... }
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let costUsd = 0;
  let numTurns = 0;
  let model = 'claude-cli';

  try {
    const lines = result.stdout.trim().split('\n');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        // Extract text from result field
        if (parsed.result !== undefined && parsed.result !== null) {
          console.log(`[Klonode CLI] result type: ${typeof parsed.result}, subtype: ${parsed.subtype}`);
          if (typeof parsed.result === 'string') {
            text = parsed.result;
          } else if (Array.isArray(parsed.result)) {
            // Content blocks: [{type: "text", text: "..."}, {type: "tool_use", ...}]
            const textBlocks = parsed.result
              .filter((b: any) => b.type === 'text' && b.text)
              .map((b: any) => b.text);
            if (textBlocks.length > 0) {
              text = textBlocks.join('\n');
            }
          }
        }

        // If result is missing but we hit max_turns, that's OK — Claude was working with tools
        // The work was done (files read/edited), just no final summary text
        if (parsed.subtype === 'error_max_turns' && !text) {
          text = 'Claude brukte alle tilgjengelige steg på å lese og analysere koden. Prøv å stille et mer spesifikt spørsmål, eller øk maks-steg i innstillingene.';
        }

        if (parsed.usage) {
          inputTokens = parsed.usage.input_tokens || 0;
          outputTokens = parsed.usage.output_tokens || 0;
          cacheCreationTokens = parsed.usage.cache_creation_input_tokens || 0;
          cacheReadTokens = parsed.usage.cache_read_input_tokens || 0;
        }
        if (parsed.total_cost_usd) {
          costUsd = parsed.total_cost_usd;
        }
        if (parsed.num_turns) {
          numTurns = parsed.num_turns;
        }
        if (parsed.modelUsage) {
          const models = Object.keys(parsed.modelUsage);
          if (models.length > 0) model = models[0];
        }
      } catch { /* skip non-JSON lines */ }
    }
  } catch {
    text = result.stdout.trim();
  }

  // Extract file operations from the result text
  const fileOps: { type: string; path?: string; command?: string }[] = [];
  // Look for common patterns in Claude's output mentioning files
  const fileRefPatterns = [
    // "I read file.ts" / "Reading file.ts"
    /(?:read|reading|les(?:er|te)|opened)\s+[`"']?([^\s`"']+\.\w{1,5})[`"']?/gi,
    // "edited file.ts" / "wrote to file.ts"
    /(?:edit(?:ed|ing)|wrote|writ(?:ing|ten)|endret|opprettet|updated)\s+(?:to\s+)?[`"']?([^\s`"']+\.\w{1,5})[`"']?/gi,
    // backtick file references like `src/components/Foo.tsx`
    /`((?:[\w.-]+\/)+[\w.-]+\.\w{1,5})`/g,
  ];
  const seenFiles = new Set<string>();
  for (const pattern of fileRefPatterns) {
    for (const m of text.matchAll(pattern)) {
      const filePath = m[1];
      if (filePath && !seenFiles.has(filePath) && filePath.includes('/') || filePath.includes('.')) {
        seenFiles.add(filePath);
        const isWrite = /edit|writ|endr|opprett|updat/i.test(m[0]);
        fileOps.push({ type: isWrite ? 'edit' : 'read', path: filePath });
      }
    }
  }

  // Total input = direct + cache creation + cache read
  const totalInput = inputTokens + cacheCreationTokens + cacheReadTokens;

  return json({
    text: text || result.stderr.trim() || 'Ingen respons fra Claude CLI',
    inputTokens: totalInput,
    outputTokens,
    totalTokens: totalInput + outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    fileOps,
    costUsd,
    numTurns,
    model,
    mode: body.mode,
    elapsed,
  });
}

async function handleApi(body: ChatRequest, systemPrompt: string): Promise<Response> {
  if (!body.apiKey) {
    return json({ error: 'API-nøkkel mangler. Legg til din Anthropic API-nøkkel i innstillinger.' }, { status: 400 });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': body.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: body.model || 'claude-sonnet-4-20250514',
      max_tokens: body.maxTokens || 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: body.message }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return json({ error: `Anthropic API feil: ${response.status} — ${err}` }, { status: response.status });
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || 'Ingen respons';
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

  return json({
    text,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    model: data.model,
    mode: body.mode,
  });
}

function getModeInstructions(execMode: string): string {
  switch (execMode) {
    case 'question':
      return `Du er i SPØRSMÅLS-MODUS. Svar BARE basert på konteksten ovenfor. Ikke bruk verktøy — du har all info du trenger. Gi et konsist, nyttig svar.`;
    case 'plan':
      return `Du er i PLAN-MODUS. Les koden med Read/Grep og lag en detaljert plan for hva som må endres. IKKE gjør noen endringer — bare les, analyser og beskriv planen steg-for-steg med filstier og linjenummer. Brukeren godkjenner planen før du utfører.`;
    case 'bypass':
    default:
      return `Du har FULL TILGANG til å lese og skrive filer. Utfør endringene direkte med Edit/Write. Les relevante filer først med Read, gjør endringene, og bekreft hva du har gjort.`;
  }
}

function buildKlonodePrompt(routedContext: string, execMode: string): string {
  // Extract just the file paths and key one-liners from routed context
  // Keep the hint ultra-concise (<500 chars) to minimize per-turn overhead
  const microHint = extractMicroHint(routedContext);

  return `Erfaren utvikler. Minimer verktøybruk — svar direkte fra konteksten når mulig.
${microHint}
${getModeInstructions(execMode)}
Svar på norsk med mindre brukeren skriver på engelsk.`;
}

function buildFullPrompt(fullContext: string, execMode: string): string {
  return `Du er en erfaren programvareutvikler som jobber med en kodebase.

Her er en oversikt over hele prosjektet:

--- PROSJEKTOVERSIKT ---
${fullContext}
--- SLUTT OVERSIKT ---

${getModeInstructions(execMode)}

VIKTIG:
- Du jobber direkte i prosjektmappen — alle filstier er relative
- Gi konkrete svar med eksakt kode, filstier og linjenummer
- Svar på norsk med mindre brukeren skriver på engelsk`;
}

/**
 * Extract a micro routing hint from the full CONTEXT.md content.
 * Keeps only: folder paths, API methods, key exports, patterns.
 * Target: <500 chars total to minimize per-turn token overhead.
 */
function extractMicroHint(routedContext: string): string {
  if (!routedContext || routedContext === 'Ingen graf lastet.') return '';

  const hints: string[] = [];

  // Extract folder paths from ## headers
  const folderPaths: string[] = [];
  for (const m of routedContext.matchAll(/^## (.+?)\/CONTEXT\.md$/gm)) {
    folderPaths.push(m[1]);
  }

  // Extract API routes
  const apiMethods: string[] = [];
  for (const m of routedContext.matchAll(/Methods: \*\*(.+?)\*\*/g)) {
    apiMethods.push(m[1]);
  }

  // Extract key patterns (auth, prisma models, etc)
  const patterns: string[] = [];
  for (const m of routedContext.matchAll(/^- (Uses |Admin|Prisma models|Three\.js|NextAuth|Standard).+$/gm)) {
    patterns.push(m[1].trim());
  }

  // Extract key exports (just function/class names, not signatures)
  const exports: string[] = [];
  for (const m of routedContext.matchAll(/^\- \*\*(function|class|component)\*\*: (.+)$/gm)) {
    const names = m[2].split(', ').slice(0, 3).map(n => n.replace(/\(.*/, ''));
    exports.push(...names);
  }

  // Build concise hint
  if (folderPaths.length > 0) {
    hints.push(`Start i: ${folderPaths.join(', ')}`);
  }
  if (apiMethods.length > 0) {
    hints.push(`API: ${apiMethods.join('; ')}`);
  }
  if (patterns.length > 0) {
    hints.push(patterns.slice(0, 3).join('. '));
  }
  if (exports.length > 0) {
    hints.push(`Nøkkeleksporter: ${exports.slice(0, 5).join(', ')}`);
  }

  // Also tell Claude about CONTEXT.md files it can read for more detail
  if (folderPaths.length > 0) {
    hints.push(`Les CONTEXT.md i disse mappene for detaljer.`);
  }

  const hint = hints.join('\n');

  // Hard cap at 500 chars
  if (hint.length > 500) return hint.slice(0, 497) + '...';
  return hint;
}

