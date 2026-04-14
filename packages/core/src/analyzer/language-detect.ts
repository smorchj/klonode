/**
 * Detects programming languages per directory based on file extensions.
 * Lightweight approach — no tree-sitter needed for detection, only for deep analysis.
 */

import type { ScanEntry } from './scanner.js';

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.c': 'C',
  '.h': 'C',
  '.hpp': 'C++',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.lua': 'Lua',
  '.zig': 'Zig',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.scala': 'Scala',
  '.r': 'R',
  '.R': 'R',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
};

// Files that indicate a project boundary / architectural boundary
const BOUNDARY_FILES = new Set([
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  'pubspec.yaml',
  'mix.exs',
  'CMakeLists.txt',
  'Makefile',
  'Dockerfile',
]);

// Files that indicate an entry point
const ENTRY_POINT_PATTERNS = [
  /^index\./,
  /^main\./,
  /^app\./,
  /^server\./,
  /^mod\./,
  /^lib\./,
  /^__init__\.py$/,
  /^Program\.cs$/,
  /^Main\.java$/,
];

export interface LanguageProfile {
  primary: string | null;
  breakdown: Record<string, number>;
  totalCodeFiles: number;
  hasBoundaryFile: boolean;
  boundaryFiles: string[];
  entryPoints: string[];
}

/**
 * Analyze a directory's language profile from its scan entries.
 */
export function detectLanguages(entry: ScanEntry): LanguageProfile {
  const breakdown: Record<string, number> = {};
  let totalCodeFiles = 0;
  const boundaryFiles: string[] = [];
  const entryPoints: string[] = [];

  function collect(e: ScanEntry): void {
    if (!e.isDirectory && e.extension) {
      const lang = EXTENSION_MAP[e.extension];
      if (lang && !isConfigLanguage(lang)) {
        breakdown[lang] = (breakdown[lang] || 0) + 1;
        totalCodeFiles++;
      }
    }

    if (!e.isDirectory && BOUNDARY_FILES.has(e.name)) {
      boundaryFiles.push(e.name);
    }

    if (!e.isDirectory) {
      for (const pattern of ENTRY_POINT_PATTERNS) {
        if (pattern.test(e.name)) {
          entryPoints.push(e.relativePath);
          break;
        }
      }
    }

    for (const child of e.children) {
      collect(child);
    }
  }

  collect(entry);

  // Find primary language
  let primary: string | null = null;
  let maxCount = 0;
  for (const [lang, count] of Object.entries(breakdown)) {
    if (count > maxCount) {
      maxCount = count;
      primary = lang;
    }
  }

  return {
    primary,
    breakdown,
    totalCodeFiles,
    hasBoundaryFile: boundaryFiles.length > 0,
    boundaryFiles,
    entryPoints,
  };
}

function isConfigLanguage(lang: string): boolean {
  return ['JSON', 'YAML', 'TOML', 'XML', 'Markdown'].includes(lang);
}

/**
 * Get the full language breakdown for the entire repo.
 */
export function getRepoLanguages(root: ScanEntry): Record<string, number> {
  return detectLanguages(root).breakdown;
}
