/**
 * Generates natural-language summaries for directories.
 * Uses heuristics from file names, exports, and structure.
 * AI-assisted summarization can be layered on top later.
 */

import type { ScanEntry } from './scanner.js';
import type { LanguageProfile } from './language-detect.js';
import { detectLanguages } from './language-detect.js';

// Common directory name → purpose mappings
const DIR_PURPOSE_MAP: Record<string, string> = {
  src: 'Main source code',
  lib: 'Library/shared code',
  app: 'Application entry and routing',
  pages: 'Page components/routes',
  routes: 'Route handlers',
  api: 'API endpoints',
  components: 'UI components',
  hooks: 'Custom hooks',
  utils: 'Utility functions',
  helpers: 'Helper functions',
  services: 'Service layer / business logic',
  models: 'Data models and types',
  types: 'Type definitions',
  interfaces: 'Interface definitions',
  schemas: 'Data schemas and validation',
  controllers: 'Request controllers',
  middleware: 'Middleware functions',
  handlers: 'Event/request handlers',
  config: 'Configuration files',
  constants: 'Constant values',
  assets: 'Static assets (images, fonts, etc.)',
  styles: 'Stylesheets',
  css: 'CSS styles',
  public: 'Public/static files',
  static: 'Static files served directly',
  tests: 'Test files',
  test: 'Test files',
  __tests__: 'Test files',
  spec: 'Test specifications',
  fixtures: 'Test fixtures and mock data',
  mocks: 'Mock implementations',
  docs: 'Documentation',
  scripts: 'Build/utility scripts',
  tools: 'Development tools',
  migrations: 'Database migrations',
  seeds: 'Database seed data',
  prisma: 'Prisma ORM schema and migrations',
  db: 'Database layer',
  database: 'Database layer',
  auth: 'Authentication and authorization',
  store: 'State management',
  stores: 'State management stores',
  state: 'Application state',
  context: 'React context providers',
  providers: 'Service/context providers',
  layouts: 'Layout components',
  templates: 'Templates',
  views: 'View layer',
  features: 'Feature modules',
  modules: 'Application modules',
  plugins: 'Plugin system',
  extensions: 'Extensions',
  i18n: 'Internationalization',
  locales: 'Translation files',
  lang: 'Language files',
};

export interface DirectorySummary {
  path: string;
  summary: string;
  purpose: string;
  languages: LanguageProfile;
  significance: 'high' | 'medium' | 'low';
  fileCount: number;
  childDirCount: number;
}

/**
 * Generate a summary for a single directory.
 */
export function summarizeDirectory(entry: ScanEntry): DirectorySummary {
  const languages = detectLanguages(entry);

  const dirName = entry.name.toLowerCase().replace(/[-_]/g, '');
  const knownPurpose = DIR_PURPOSE_MAP[entry.name] || DIR_PURPOSE_MAP[dirName];

  const fileCount = entry.children.filter(c => !c.isDirectory).length;
  const childDirCount = entry.children.filter(c => c.isDirectory).length;

  // Determine significance
  let significance: 'high' | 'medium' | 'low' = 'medium';
  if (languages.hasBoundaryFile || languages.entryPoints.length > 0) {
    significance = 'high';
  } else if (fileCount === 0 && childDirCount === 0) {
    significance = 'low';
  } else if (languages.totalCodeFiles > 10) {
    significance = 'high';
  }

  // Build summary
  let summary: string;
  if (knownPurpose) {
    summary = knownPurpose;
    if (languages.primary) {
      summary += ` (${languages.primary})`;
    }
    if (fileCount > 0) {
      summary += `. ${fileCount} files`;
    }
  } else {
    // Infer from contents
    const parts: string[] = [];

    if (languages.primary) {
      parts.push(`${languages.primary} code`);
    }

    if (fileCount > 0) {
      parts.push(`${fileCount} files`);
    }

    if (childDirCount > 0) {
      parts.push(`${childDirCount} subdirectories`);
    }

    if (languages.entryPoints.length > 0) {
      parts.push(`entry: ${languages.entryPoints[0]}`);
    }

    summary = parts.length > 0
      ? parts.join(', ')
      : 'Empty or configuration directory';
  }

  const purpose = knownPurpose || inferPurpose(entry, languages);

  return {
    path: entry.relativePath,
    summary,
    purpose,
    languages,
    significance,
    fileCount,
    childDirCount,
  };
}

function inferPurpose(entry: ScanEntry, languages: LanguageProfile): string {
  // Check for test patterns
  const hasTestFiles = entry.children.some(c =>
    c.name.includes('.test.') || c.name.includes('.spec.') || c.name.includes('_test.'),
  );
  if (hasTestFiles) return 'Test files';

  // Check for config patterns
  const hasConfigFiles = entry.children.some(c =>
    c.name.includes('config') || c.name.endsWith('.env') || c.name.endsWith('.rc'),
  );
  if (hasConfigFiles && !languages.primary) return 'Configuration';

  if (languages.hasBoundaryFile) return 'Package/module root';
  if (languages.primary) return `${languages.primary} source code`;

  return 'Project directory';
}

/**
 * Summarize all directories in a scan tree.
 */
export function summarizeAll(root: ScanEntry): Map<string, DirectorySummary> {
  const summaries = new Map<string, DirectorySummary>();

  function walk(entry: ScanEntry): void {
    if (entry.isDirectory) {
      summaries.set(entry.relativePath, summarizeDirectory(entry));
      for (const child of entry.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return summaries;
}
