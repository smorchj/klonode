/**
 * Context Checklist — defines what MUST be covered in CONTEXT.md files.
 *
 * The checklist is dynamic: root-level has mandatory infrastructure sections,
 * folder-level sections adapt based on the folder's purpose and detected tools.
 *
 * This prevents the generator from "forgetting" important context like
 * hosting details, auth flows, storage config, etc.
 */

export interface ChecklistItem {
  /** Section ID */
  id: string;
  /** Section heading for CONTEXT.md */
  heading: string;
  /** What this section should describe */
  description: string;
  /** File patterns to scan for this info */
  scanPatterns: string[];
  /** Keywords that indicate this section is relevant */
  keywords: string[];
}

/**
 * Root-level checklist — ALWAYS included in the root CONTEXT.md.
 * These are the things every developer needs to know about the project.
 */
export const ROOT_CHECKLIST: ChecklistItem[] = [
  {
    id: 'hosting',
    heading: 'Hosting & Deployment',
    description: 'How the app is hosted, deployed, and started. Server config, reverse proxy, domains.',
    scanPatterns: ['server.js', 'server.ts', 'Caddyfile', 'nginx.conf', 'Dockerfile', 'docker-compose.*', 'vercel.json', 'fly.toml', 'railway.json', 'render.yaml', 'start.bat', 'start.sh', 'Procfile', '.platform/**'],
    keywords: ['server', 'host', 'deploy', 'caddy', 'nginx', 'docker', 'vercel', 'domain', 'ssl', 'proxy', 'port'],
  },
  {
    id: 'auth',
    heading: 'Authentication & Authorization',
    description: 'How users authenticate, session management, roles/permissions, OAuth providers.',
    scanPatterns: ['**/auth/**', '**/middleware.*', 'lib/auth.*', 'app/api/auth/**'],
    keywords: ['auth', 'session', 'login', 'oauth', 'jwt', 'role', 'permission', 'nextauth', 'passport', 'clerk'],
  },
  {
    id: 'database',
    heading: 'Database',
    description: 'Database type, ORM, connection, schema location, migration strategy.',
    scanPatterns: ['prisma/schema.prisma', 'drizzle.config.*', 'knexfile.*', 'database.*', 'db/**', 'migrations/**'],
    keywords: ['prisma', 'database', 'postgres', 'mysql', 'sqlite', 'mongo', 'supabase', 'migration', 'schema'],
  },
  {
    id: 'storage',
    heading: 'File Storage',
    description: 'Where files/images/assets are stored. Cloud storage, local filesystem, CDN.',
    scanPatterns: ['lib/storage.*', 'lib/blob.*', 'lib/r2*', 'lib/s3*', '**/upload/**', 'data/uploads/**'],
    keywords: ['storage', 'upload', 'blob', 'r2', 's3', 'cdn', 'cloudflare', 'vercel blob', 'local file'],
  },
  {
    id: 'env',
    heading: 'Environment Variables',
    description: 'Required env vars, where they are configured, what each one does.',
    scanPatterns: ['.env.example', '.env.local', '.env'],
    keywords: ['env', 'secret', 'api key', 'token', 'database_url', 'nextauth'],
  },
  {
    id: 'external-services',
    heading: 'External Services & APIs',
    description: 'Third-party services the app depends on (payment, email, AI, analytics, etc).',
    scanPatterns: ['lib/**', 'app/api/**'],
    keywords: ['stripe', 'vipps', 'sendgrid', 'email', 'claude', 'openai', 'discord', 'slack', 'analytics', 'webhook', 'push notification', 'vapid'],
  },
  {
    id: 'build',
    heading: 'Build & Run',
    description: 'How to install, build, and run the project locally. Dev vs production commands.',
    scanPatterns: ['package.json', 'Makefile', 'turbo.json', 'start.bat', 'start.sh'],
    keywords: ['npm', 'pnpm', 'yarn', 'build', 'dev', 'start', 'install'],
  },
];

/**
 * Folder-level checklist — sections that apply based on folder purpose.
 * Matched by folder name and content patterns.
 */
export const FOLDER_CHECKLISTS: Record<string, ChecklistItem[]> = {
  // API routes
  api: [
    {
      id: 'endpoints',
      heading: 'API Endpoints',
      description: 'HTTP methods, paths, request/response types, auth requirements.',
      scanPatterns: ['**/route.ts', '**/route.js'],
      keywords: ['get', 'post', 'put', 'delete', 'endpoint', 'api'],
    },
    {
      id: 'middleware',
      heading: 'Middleware & Auth',
      description: 'What middleware runs, auth checks, rate limiting.',
      scanPatterns: ['middleware.*', 'lib/auth.*'],
      keywords: ['middleware', 'auth', 'session', 'rate limit'],
    },
    {
      id: 'error-handling',
      heading: 'Error Handling',
      description: 'Error response patterns, status codes, validation.',
      scanPatterns: [],
      keywords: ['error', 'catch', 'validation', 'status'],
    },
  ],
  // Game engine
  game: [
    {
      id: 'architecture',
      heading: 'Engine Architecture',
      description: 'Main game loop, scene management, rendering pipeline.',
      scanPatterns: ['Game.ts', 'core/**'],
      keywords: ['game loop', 'scene', 'render', 'update', 'tick'],
    },
    {
      id: 'physics',
      heading: 'Physics & Collision',
      description: 'Physics engine, collision detection, movement system.',
      scanPatterns: ['physics/**', 'world/**'],
      keywords: ['physics', 'collision', 'movement', 'velocity', 'gravity'],
    },
    {
      id: 'state',
      heading: 'Game State',
      description: 'How game state is managed, saved, synced with server.',
      scanPatterns: ['services/**', 'db/**'],
      keywords: ['state', 'save', 'sync', 'player data', 'inventory'],
    },
    {
      id: 'assets',
      heading: 'Asset Loading',
      description: 'How 3D models, textures, and audio are loaded and managed.',
      scanPatterns: ['world/**', 'utils/**'],
      keywords: ['model', 'texture', 'gltf', 'audio', 'loader', 'asset'],
    },
  ],
  // Components
  components: [
    {
      id: 'patterns',
      heading: 'Component Patterns',
      description: 'Shared patterns, prop conventions, state management approach.',
      scanPatterns: [],
      keywords: ['props', 'state', 'hook', 'context', 'provider'],
    },
    {
      id: 'styling',
      heading: 'Styling',
      description: 'CSS approach (modules, tailwind, styled-components), theme system.',
      scanPatterns: ['**/*.css', '**/*.module.css'],
      keywords: ['css', 'style', 'tailwind', 'theme', 'className'],
    },
  ],
  // Database / Prisma
  prisma: [
    {
      id: 'models',
      heading: 'Data Models',
      description: 'All models, their relationships, and key fields.',
      scanPatterns: ['schema.prisma'],
      keywords: ['model', 'relation', 'field', '@id', '@unique'],
    },
    {
      id: 'migrations',
      heading: 'Migrations',
      description: 'Migration strategy, how to create and apply migrations.',
      scanPatterns: ['migrations/**'],
      keywords: ['migration', 'migrate', 'prisma db push'],
    },
  ],
  // Scripts / automation
  scripts: [
    {
      id: 'agents',
      heading: 'Agent System',
      description: 'AI agents, their roles, how they are orchestrated.',
      scanPatterns: ['agents/**'],
      keywords: ['agent', 'orchestrat', 'claude', 'prompt'],
    },
    {
      id: 'scrapers',
      heading: 'Scrapers',
      description: 'What data is scraped, from where, how often.',
      scanPatterns: ['scrapers/**'],
      keywords: ['scrape', 'puppeteer', 'cheerio', 'fetch', 'cron'],
    },
  ],
  // Lib / shared utilities
  lib: [
    {
      id: 'shared-utils',
      heading: 'Shared Utilities',
      description: 'Key shared functions, what they do, who uses them.',
      scanPatterns: ['*.ts', '*.js'],
      keywords: ['util', 'helper', 'shared', 'common'],
    },
    {
      id: 'integrations',
      heading: 'Service Integrations',
      description: 'Third-party service clients and their configuration.',
      scanPatterns: ['*.ts', '*.js'],
      keywords: ['client', 'service', 'api', 'integration'],
    },
  ],
};

/**
 * Get the applicable checklist for a directory based on its name and parent.
 */
export function getChecklistForDirectory(dirName: string, parentPath: string): ChecklistItem[] {
  const nameLower = dirName.toLowerCase();

  // Direct match
  if (FOLDER_CHECKLISTS[nameLower]) {
    return FOLDER_CHECKLISTS[nameLower];
  }

  // Parent-based matching (e.g., app/api/game → game checklist)
  const parentLower = parentPath.toLowerCase();
  if (parentLower.includes('/api') || nameLower === 'api') {
    return FOLDER_CHECKLISTS.api || [];
  }
  if (parentLower.includes('/game') || nameLower.includes('game')) {
    return FOLDER_CHECKLISTS.game || [];
  }
  if (nameLower.includes('component')) {
    return FOLDER_CHECKLISTS.components || [];
  }

  return [];
}

/**
 * Validate a generated CONTEXT.md against the applicable checklist.
 * Returns missing sections that should be added.
 */
export function validateContext(
  markdown: string,
  checklist: ChecklistItem[],
): { missing: ChecklistItem[]; covered: string[] } {
  const mdLower = markdown.toLowerCase();
  const missing: ChecklistItem[] = [];
  const covered: string[] = [];

  for (const item of checklist) {
    // Check if the heading or key keywords appear in the markdown
    const headingPresent = mdLower.includes(item.heading.toLowerCase());
    const keywordsPresent = item.keywords.some(kw => mdLower.includes(kw.toLowerCase()));

    if (headingPresent || keywordsPresent) {
      covered.push(item.id);
    } else {
      missing.push(item);
    }
  }

  return { missing, covered };
}
