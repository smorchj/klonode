/**
 * Agents API — manages agent registry and CO operations.
 *
 * GET: Load agent registry for a project
 * POST: Trigger CO analysis, log interaction
 */

import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { RequestHandler } from './$types';

const execAsync = promisify(exec);

interface AgentRequest {
  action: 'load-registry' | 'log-interaction' | 'analyze' | 'detect-tools';
  repoPath: string;
  data?: Record<string, any>;
}

export const POST: RequestHandler = async ({ request }) => {
  const body: AgentRequest = await request.json();
  const repoPath = body.repoPath || process.cwd();

  try {
    switch (body.action) {
      case 'detect-tools':
        return await handleDetectTools(repoPath);

      case 'log-interaction':
        return await handleLogInteraction(repoPath, body.data || {});

      case 'analyze':
        return await handleAnalyze(repoPath);

      case 'load-registry':
        return await handleLoadRegistry(repoPath);

      default:
        return json({ error: `Ukjent aksjon: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ukjent feil';
    return json({ error: msg }, { status: 500 });
  }
};

async function handleDetectTools(repoPath: string) {
  // Simple tool detection via file existence checks
  const tools: { id: string; name: string; category: string; configPath: string; contextHint: string }[] = [];

  const checks: [string, string, string, string, string][] = [
    ['prisma/schema.prisma', 'prisma', 'Prisma ORM', 'database', 'Prisma ORM: schema defines models/relations'],
    ['tsconfig.json', 'typescript', 'TypeScript', 'language', 'TypeScript: check tsconfig.json for config'],
    ['next.config.js', 'nextjs', 'Next.js', 'framework', 'Next.js: App Router in app/'],
    ['next.config.mjs', 'nextjs', 'Next.js', 'framework', 'Next.js: App Router in app/'],
    ['next.config.ts', 'nextjs', 'Next.js', 'framework', 'Next.js: App Router in app/'],
    ['svelte.config.js', 'sveltekit', 'SvelteKit', 'framework', 'SvelteKit: routes in src/routes/'],
    ['tailwind.config.js', 'tailwind', 'Tailwind CSS', 'styling', 'Tailwind CSS: utility classes'],
    ['tailwind.config.ts', 'tailwind', 'Tailwind CSS', 'styling', 'Tailwind CSS: utility classes'],
    ['Dockerfile', 'docker', 'Docker', 'devops', 'Docker: containerized deployment'],
    ['docker-compose.yml', 'docker', 'Docker', 'devops', 'Docker Compose: multi-container'],
    ['.github/workflows', 'github-actions', 'GitHub Actions', 'devops', 'CI/CD in .github/workflows/'],
    ['turbo.json', 'turbo', 'Turborepo', 'build', 'Monorepo: turbo.json defines pipeline'],
    ['vitest.config.ts', 'vitest', 'Vitest', 'testing', 'Vitest: fast unit tests'],
    ['jest.config.js', 'jest', 'Jest', 'testing', 'Jest: unit tests'],
    ['playwright.config.ts', 'playwright', 'Playwright', 'testing', 'E2E tests'],
  ];

  const seen = new Set<string>();
  for (const [file, id, name, category, hint] of checks) {
    if (seen.has(id)) continue;
    if (existsSync(join(repoPath, file))) {
      seen.add(id);
      tools.push({ id, name, category, configPath: file, contextHint: hint });
    }
  }

  return json({ tools });
}

async function handleLogInteraction(repoPath: string, data: Record<string, any>) {
  const logDir = join(repoPath, '.klonode', 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const logFile = join(logDir, `${today}.jsonl`);

  const entry = {
    timestamp: new Date().toISOString(),
    agentId: data.agentId || 'unknown',
    from: data.from || 'user',
    message: (data.message || '').slice(0, 200),
    tokens: data.tokens,
    contextDepth: data.contextDepth,
    durationMs: data.durationMs,
  };

  const fs = await import('fs');
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');

  // Check if CO should auto-analyze
  const coDir = join(repoPath, '.klonode', 'co');
  if (!existsSync(coDir)) mkdirSync(coDir, { recursive: true });

  const statePath = join(coDir, 'state.json');
  let state = { interactionsSinceAnalysis: 0, analysisInterval: 10 };
  if (existsSync(statePath)) {
    try { state = { ...state, ...JSON.parse(readFileSync(statePath, 'utf-8')) }; } catch { /* */ }
  }
  state.interactionsSinceAnalysis++;
  const shouldAnalyze = state.interactionsSinceAnalysis >= state.analysisInterval;
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  return json({ logged: true, shouldAnalyze });
}

async function handleAnalyze(repoPath: string) {
  const logDir = join(repoPath, '.klonode', 'logs');
  if (!existsSync(logDir)) return json({ suggestions: [], stats: null });

  // Read all logs
  const fs = await import('fs');
  const files = fs.readdirSync(logDir).filter((f: string) => f.endsWith('.jsonl'));
  const allMessages: any[] = [];

  for (const file of files) {
    const lines = fs.readFileSync(join(logDir, file), 'utf-8').split('\n').filter((l: string) => l.trim());
    for (const line of lines) {
      try { allMessages.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }

  // Simple analysis
  const agentUsage: Record<string, number> = {};
  const tokensByAgent: Record<string, number[]> = {};
  let totalTokens = 0;
  let totalCost = 0;

  for (const msg of allMessages) {
    const agent = msg.agentId || 'unknown';
    agentUsage[agent] = (agentUsage[agent] || 0) + 1;
    if (msg.tokens?.total) {
      totalTokens += msg.tokens.total;
      if (!tokensByAgent[agent]) tokensByAgent[agent] = [];
      tokensByAgent[agent].push(msg.tokens.total);
      if (msg.tokens.costUsd) totalCost += msg.tokens.costUsd;
    }
  }

  const avgTokens: Record<string, number> = {};
  for (const [agent, tokens] of Object.entries(tokensByAgent)) {
    avgTokens[agent] = Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length);
  }

  // Generate suggestions
  const suggestions: any[] = [];
  for (const [agent, avg] of Object.entries(avgTokens)) {
    if (avg > 30000) {
      suggestions.push({
        type: 'update-context',
        priority: 'high',
        title: `${agent} bruker snitt ${Math.round(avg / 1000)}k tokens`,
        description: 'Forbedre CONTEXT.md for denne agenten',
      });
    }
  }

  // Reset counter
  const coDir = join(repoPath, '.klonode', 'co');
  const statePath = join(coDir, 'state.json');
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    state.interactionsSinceAnalysis = 0;
    state.lastAnalysis = new Date().toISOString();
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  return json({
    stats: {
      totalInteractions: allMessages.length,
      agentUsage,
      avgTokensByAgent: avgTokens,
      totalTokens,
      totalCost,
    },
    suggestions,
  });
}

async function handleLoadRegistry(repoPath: string) {
  // Check for existing registry
  const registryPath = join(repoPath, '.klonode', 'agents.json');
  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      return json({ registry });
    } catch { /* fall through */ }
  }

  return json({ registry: null });
}
