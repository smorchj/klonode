/**
 * Auto-tool detection — scans a project and identifies which tools/frameworks are used.
 * This lets Klonode automatically configure the right parsers and context generation.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import type { ScanEntry } from './scanner.js';

export interface DetectedTool {
  /** Tool identifier (e.g., 'prisma', 'docker', 'nextjs') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Tool category */
  category: 'database' | 'framework' | 'build' | 'testing' | 'devops' | 'styling' | 'language' | 'api';
  /** Version if detectable */
  version?: string;
  /** Path to config file that triggered detection */
  configPath: string;
  /** Relevant file patterns to watch */
  filePatterns: string[];
  /** Extra context to inject into CONTEXT.md generation */
  contextHint: string;
}

interface ToolSignature {
  id: string;
  name: string;
  category: DetectedTool['category'];
  /** Files/dirs whose existence signals this tool */
  signals: string[];
  /** Glob patterns for relevant files */
  filePatterns: string[];
  /** How to extract version */
  versionFrom?: 'package.json' | 'config';
  /** Package name in package.json (for version extraction) */
  packageName?: string;
  /** Context hint template */
  contextHint: string;
}

const TOOL_SIGNATURES: ToolSignature[] = [
  // Databases
  {
    id: 'prisma', name: 'Prisma ORM', category: 'database',
    signals: ['prisma/schema.prisma', 'schema.prisma'],
    filePatterns: ['*.prisma', 'prisma/migrations/**'],
    versionFrom: 'package.json', packageName: 'prisma',
    contextHint: 'Prisma ORM: schema defines models/relations, migrations in prisma/migrations/, client at @prisma/client',
  },
  {
    id: 'drizzle', name: 'Drizzle ORM', category: 'database',
    signals: ['drizzle.config.ts', 'drizzle.config.js'],
    filePatterns: ['drizzle/**', '*.schema.ts'],
    versionFrom: 'package.json', packageName: 'drizzle-orm',
    contextHint: 'Drizzle ORM: schema-first TypeScript ORM with SQL-like query builder',
  },
  {
    id: 'supabase', name: 'Supabase', category: 'database',
    signals: ['supabase/config.toml', '.supabase'],
    filePatterns: ['supabase/**'],
    contextHint: 'Supabase: PostgreSQL + Auth + Storage + Realtime, config in supabase/',
  },
  // Frameworks
  {
    id: 'nextjs', name: 'Next.js', category: 'framework',
    signals: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    filePatterns: ['app/**', 'pages/**', 'next.config.*'],
    versionFrom: 'package.json', packageName: 'next',
    contextHint: 'Next.js: App Router in app/, API routes in app/api/, layouts/pages pattern',
  },
  {
    id: 'sveltekit', name: 'SvelteKit', category: 'framework',
    signals: ['svelte.config.js', 'svelte.config.ts'],
    filePatterns: ['src/routes/**', 'src/lib/**', 'svelte.config.*'],
    versionFrom: 'package.json', packageName: '@sveltejs/kit',
    contextHint: 'SvelteKit: routes in src/routes/, lib in src/lib/, +page/+server pattern',
  },
  {
    id: 'nuxt', name: 'Nuxt', category: 'framework',
    signals: ['nuxt.config.ts', 'nuxt.config.js'],
    filePatterns: ['pages/**', 'composables/**', 'server/**'],
    versionFrom: 'package.json', packageName: 'nuxt',
    contextHint: 'Nuxt: auto-imports, pages in pages/, server in server/',
  },
  {
    id: 'astro', name: 'Astro', category: 'framework',
    signals: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'],
    filePatterns: ['src/pages/**/*.astro', 'src/components/**/*.astro', 'src/layouts/**/*.astro', 'astro.config.*'],
    versionFrom: 'package.json', packageName: 'astro',
    contextHint: 'Astro: content-first framework, pages in src/pages/, components in src/components/, layouts in src/layouts/',
  },
  {
    id: 'express', name: 'Express', category: 'framework',
    signals: [],  // detected via package.json only
    filePatterns: ['routes/**', 'middleware/**'],
    versionFrom: 'package.json', packageName: 'express',
    contextHint: 'Express: middleware + router pattern, routes in routes/',
  },
  {
    id: 'django', name: 'Django', category: 'framework',
    signals: ['manage.py'],
    filePatterns: ['**/models.py', '**/views.py', '**/urls.py', '**/settings.py'],
    contextHint: 'Django: Python web framework, models/views/urls per app, settings.py for config, manage.py for CLI',
  },
  // Runtimes
  {
    id: 'deno', name: 'Deno', category: 'language',
    signals: ['deno.json', 'deno.jsonc', 'import_map.json'],
    filePatterns: ['deno.json*', '**/*.ts'],
    contextHint: 'Deno: secure TypeScript runtime, std lib at jsr:@std, permissions required',
  },
  {
    id: 'bun', name: 'Bun', category: 'language',
    signals: ['bunfig.toml', 'bun.lockb', 'bun.lock'],
    filePatterns: ['bunfig.toml', '**/*.ts', '**/*.tsx'],
    versionFrom: 'package.json', packageName: 'bun',
    contextHint: 'Bun: fast all-in-one JavaScript runtime, package manager, and bundler',
  },
  // Build tools
  {
    id: 'typescript', name: 'TypeScript', category: 'language',
    signals: ['tsconfig.json'],
    filePatterns: ['tsconfig*.json', '**/*.ts', '**/*.tsx'],
    contextHint: 'TypeScript: strict types, check tsconfig.json for paths/aliases',
  },
  {
    id: 'turbo', name: 'Turborepo', category: 'build',
    signals: ['turbo.json'],
    filePatterns: ['turbo.json', 'packages/**'],
    versionFrom: 'package.json', packageName: 'turbo',
    contextHint: 'Turborepo monorepo: packages in packages/, turbo.json defines pipeline',
  },
  // Testing
  {
    id: 'vitest', name: 'Vitest', category: 'testing',
    signals: ['vitest.config.ts', 'vitest.config.js'],
    filePatterns: ['**/*.test.ts', '**/*.spec.ts', 'vitest.config.*'],
    versionFrom: 'package.json', packageName: 'vitest',
    contextHint: 'Vitest: fast unit tests, config in vitest.config.ts',
  },
  {
    id: 'jest', name: 'Jest', category: 'testing',
    signals: ['jest.config.js', 'jest.config.ts'],
    filePatterns: ['**/*.test.ts', '**/*.spec.ts', 'jest.config.*'],
    versionFrom: 'package.json', packageName: 'jest',
    contextHint: 'Jest: unit tests, config in jest.config.*',
  },
  {
    id: 'playwright', name: 'Playwright', category: 'testing',
    signals: ['playwright.config.ts', 'playwright.config.js'],
    filePatterns: ['e2e/**', 'tests/**', 'playwright.config.*'],
    versionFrom: 'package.json', packageName: '@playwright/test',
    contextHint: 'Playwright: E2E tests, config in playwright.config.ts',
  },
  // DevOps
  {
    id: 'docker', name: 'Docker', category: 'devops',
    signals: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
    filePatterns: ['Dockerfile*', 'docker-compose.*', 'compose.*', '.dockerignore'],
    contextHint: 'Docker: containerized deployment, check Dockerfile for build steps',
  },
  {
    id: 'github-actions', name: 'GitHub Actions', category: 'devops',
    signals: ['.github/workflows'],
    filePatterns: ['.github/workflows/**'],
    contextHint: 'GitHub Actions: CI/CD in .github/workflows/',
  },
  // Styling
  {
    id: 'tailwind', name: 'Tailwind CSS', category: 'styling',
    signals: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'],
    filePatterns: ['tailwind.config.*'],
    versionFrom: 'package.json', packageName: 'tailwindcss',
    contextHint: 'Tailwind CSS: utility classes, config in tailwind.config.*',
  },
  // API
  {
    id: 'trpc', name: 'tRPC', category: 'api',
    signals: [],
    filePatterns: ['**/*.router.ts', 'server/trpc/**'],
    versionFrom: 'package.json', packageName: '@trpc/server',
    contextHint: 'tRPC: type-safe API, routers define endpoints',
  },
  {
    id: 'graphql', name: 'GraphQL', category: 'api',
    signals: ['codegen.yml', 'codegen.ts', '.graphqlrc.yml'],
    filePatterns: ['**/*.graphql', '**/*.gql'],
    contextHint: 'GraphQL: schema-first API, types/queries/mutations in .graphql files',
  },
];

/**
 * Detect tools/frameworks used in a project by scanning for known config files and patterns.
 */
export function detectTools(repoRoot: string, scanResult?: ScanEntry): DetectedTool[] {
  const detected: DetectedTool[] = [];
  const seenIds = new Set<string>();

  // Read package.json for version info and dependency-only detection
  let packageJson: Record<string, any> = {};
  try {
    packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
  } catch { /* no package.json */ }

  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  for (const sig of TOOL_SIGNATURES) {
    let configPath = '';

    // Check file signals
    for (const signal of sig.signals) {
      const fullPath = join(repoRoot, signal);
      if (existsSync(fullPath)) {
        configPath = signal;
        break;
      }
    }

    // Check package.json deps (for tools without config files, like Express)
    if (!configPath && sig.packageName && allDeps[sig.packageName]) {
      configPath = 'package.json';
    }

    if (!configPath) continue;
    if (seenIds.has(sig.id)) continue;
    seenIds.add(sig.id);

    // Extract version
    let version: string | undefined;
    if (sig.versionFrom === 'package.json' && sig.packageName) {
      const raw = allDeps[sig.packageName];
      if (raw) version = raw.replace(/[\^~>=<]/g, '');
    }

    detected.push({
      id: sig.id,
      name: sig.name,
      category: sig.category,
      version,
      configPath,
      filePatterns: sig.filePatterns,
      contextHint: sig.contextHint,
    });
  }

  return detected;
}

/**
 * Get a summary of detected tools suitable for CONTEXT.md injection.
 */
export function toolsSummary(tools: DetectedTool[]): string {
  if (tools.length === 0) return '';

  const grouped = new Map<string, DetectedTool[]>();
  for (const t of tools) {
    const list = grouped.get(t.category) || [];
    list.push(t);
    grouped.set(t.category, list);
  }

  const lines: string[] = ['## Detected Tools'];
  for (const [cat, catTools] of grouped) {
    const items = catTools.map(t => `${t.name}${t.version ? ` v${t.version}` : ''}`);
    lines.push(`- **${cat}**: ${items.join(', ')}`);
  }

  return lines.join('\n');
}
