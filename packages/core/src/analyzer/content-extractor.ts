/**
 * Content extractor — reads actual source files and extracts key information.
 * This is what makes CONTEXT.md useful: exports, API routes, types, patterns.
 *
 * Pure TypeScript, no AI — uses regex patterns to extract structure from code.
 * Designed to be fast and lightweight (reads files but does minimal parsing).
 */

import { readFileSync } from 'fs';
import { join, extname } from 'path';
import type { ScanEntry } from './scanner.js';

export interface FileExport {
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'const' | 'component' | 'enum';
  signature?: string; // e.g., "(userId: string) => Promise<User>"
}

export interface ApiRoute {
  method: string; // GET, POST, PUT, DELETE, PATCH
  handler: string; // function name or "default export"
}

export interface DirectoryContent {
  /** Key exports from all files in this directory */
  exports: FileExport[];
  /** API routes (for route handler directories) */
  apiRoutes: ApiRoute[];
  /** Key file purposes: filename → one-line description */
  filePurposes: Map<string, string>;
  /** Detected patterns (auth checks, prisma usage, etc.) */
  patterns: string[];
  /** Key imports from outside this directory */
  externalImports: string[];
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.svelte', '.vue', '.py', '.go', '.rs',
  '.java', '.kt', '.cs', '.rb', '.php',
]);

/** Schema/config files that get special parsing */
const SCHEMA_EXTENSIONS = new Set([
  '.prisma', '.graphql', '.gql', '.sql',
]);

const MAX_FILE_SIZE = 50 * 1024; // 50KB — skip huge files

/**
 * Extract structured content from all source files in a directory.
 * Does NOT recurse into subdirectories — only direct children.
 */
export function extractDirectoryContent(
  entry: ScanEntry,
  repoRoot: string,
): DirectoryContent {
  const exports: FileExport[] = [];
  const apiRoutes: ApiRoute[] = [];
  const filePurposes = new Map<string, string>();
  const patterns: string[] = [];
  const externalImports: string[] = [];
  const seenPatterns = new Set<string>();

  for (const child of entry.children) {
    if (child.isDirectory) continue;
    const ext = extname(child.name).toLowerCase();
    if (child.sizeBytes > MAX_FILE_SIZE) continue;

    // Handle schema files (prisma, graphql, sql) with dedicated parsers
    if (SCHEMA_EXTENSIONS.has(ext)) {
      try {
        const fullPath = join(repoRoot, child.relativePath);
        const content = readFileSync(fullPath, 'utf-8');
        if (content.includes('\0')) continue;

        const schemaExports = extractSchemaContent(content, child.name, ext);
        exports.push(...schemaExports);

        const purpose = inferSchemaFilePurpose(child.name, ext, schemaExports);
        if (purpose) filePurposes.set(child.name, purpose);

        detectPatterns(content, patterns, seenPatterns);
      } catch { /* skip */ }
      continue;
    }

    if (!CODE_EXTENSIONS.has(ext)) continue;

    try {
      const fullPath = join(repoRoot, child.relativePath);
      const content = readFileSync(fullPath, 'utf-8');

      // Skip binary-looking files
      if (content.includes('\0')) continue;

      // Extract exports
      const fileExports = extractExports(content, child.name);
      exports.push(...fileExports);

      // Extract API routes (Next.js, SvelteKit patterns)
      const routes = extractApiRoutes(content, child.name);
      apiRoutes.push(...routes);

      // Generate file purpose from exports and content
      const purpose = inferFilePurpose(child.name, fileExports, routes, content);
      if (purpose) filePurposes.set(child.name, purpose);

      // Detect patterns
      detectPatterns(content, patterns, seenPatterns);

      // Extract external imports
      extractExternalImports(content, entry.relativePath, externalImports);
    } catch {
      // Skip files we can't read
    }
  }

  return { exports, apiRoutes, filePurposes, patterns, externalImports };
}

function extractExports(content: string, fileName: string): FileExport[] {
  const exports: FileExport[] = [];
  const seen = new Set<string>();

  // TypeScript/JavaScript exports
  // export function name(...)
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      const params = m[2].trim();
      exports.push({
        name: m[1],
        kind: 'function',
        signature: params ? `(${truncate(params, 60)})` : '()',
      });
    }
  }

  // export const name = ...
  for (const m of content.matchAll(/export\s+const\s+(\w+)\s*[=:]/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'const' });
    }
  }

  // export class name
  for (const m of content.matchAll(/export\s+(?:default\s+)?class\s+(\w+)/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'class' });
    }
  }

  // export interface name
  for (const m of content.matchAll(/export\s+interface\s+(\w+)/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'interface' });
    }
  }

  // export type name
  for (const m of content.matchAll(/export\s+type\s+(\w+)\s*[=<{]/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'type' });
    }
  }

  // export enum name
  for (const m of content.matchAll(/export\s+(?:const\s+)?enum\s+(\w+)/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'enum' });
    }
  }

  // React/Svelte components: export default function ComponentName
  if (fileName.match(/\.(tsx|jsx|svelte)$/)) {
    for (const m of content.matchAll(/export\s+default\s+function\s+(\w+)/g)) {
      if (!seen.has(m[1]) && m[1][0] === m[1][0].toUpperCase()) {
        seen.add(m[1]);
        exports.push({ name: m[1], kind: 'component' });
      }
    }
  }

  // Python top-level functions and classes (module exports by convention)
  if (fileName.endsWith('.py')) {
    // def name( or async def name( — anchored to start of line
    for (const m of content.matchAll(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm)) {
      if (m[1].startsWith('_')) continue; // private by convention
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        const params = m[2].trim();
        exports.push({
          name: m[1],
          kind: 'function',
          signature: params ? `(${truncate(params, 60)})` : '()',
        });
      }
    }
    // class Name(BaseClass) — anchored to start of line
    for (const m of content.matchAll(/^class\s+(\w+)/gm)) {
      if (m[1].startsWith('_')) continue;
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        exports.push({ name: m[1], kind: 'class' });
      }
    }
    // Module-level constants (uppercase names at start of line): NAME = or NAME: type =
    for (const m of content.matchAll(/^([A-Z][A-Z0-9_]+)\s*(?::\s*\w+\s*)?=/gm)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        exports.push({ name: m[1], kind: 'const' });
      }
    }
  }

  // Java public types and methods
  if (fileName.endsWith('.java')) {
    // public class/interface/enum Name
    for (const m of content.matchAll(/public\s+(?:abstract\s+|final\s+|sealed\s+)?(class|interface|enum|record)\s+(\w+)/g)) {
      if (!seen.has(m[2])) {
        seen.add(m[2]);
        const kind = m[1] === 'class' || m[1] === 'record' ? 'class'
          : m[1] === 'interface' ? 'interface'
          : 'enum';
        exports.push({ name: m[2], kind });
      }
    }
    // public [static] [final] Type name(args) — methods
    for (const m of content.matchAll(/public\s+(?:static\s+)?(?:final\s+)?(?:[\w<>,\s\[\]]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws[^{]*)?\{/g)) {
      const name = m[1];
      if (seen.has(name)) continue;
      // Skip constructors (same name as class) and keywords
      if (['if', 'for', 'while', 'switch', 'return', 'class', 'new'].includes(name)) continue;
      seen.add(name);
      const params = m[2].trim();
      exports.push({
        name,
        kind: 'function',
        signature: params ? `(${truncate(params, 60)})` : '()',
      });
    }
    // public static final TYPE NAME = ... — constants
    for (const m of content.matchAll(/public\s+static\s+final\s+\w+(?:\s*<[^>]+>)?(?:\s*\[\])?\s+(\w+)\s*=/g)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        exports.push({ name: m[1], kind: 'const' });
      }
    }
  }

  // Ruby module/class/method definitions
  if (fileName.endsWith('.rb')) {
    // module Name — allow leading whitespace (nested modules)
    for (const m of content.matchAll(/^\s*module\s+([A-Z]\w*)/gm)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        exports.push({ name: m[1], kind: 'class' }); // no 'module' kind, map to class
      }
    }
    // class Name [< Parent] — allow leading whitespace (classes inside modules)
    for (const m of content.matchAll(/^\s*class\s+([A-Z]\w*)/gm)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        exports.push({ name: m[1], kind: 'class' });
      }
    }
    // def method_name(args) — top-level or class-level methods
    for (const m of content.matchAll(/^\s*def\s+(?:self\.)?([a-z_]\w*[?!]?)\s*(?:\(([^)]*)\))?/gm)) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const params = (m[2] || '').trim();
      exports.push({
        name,
        kind: 'function',
        signature: params ? `(${truncate(params, 60)})` : '()',
      });
    }
    // Constants (uppercase names) — allow leading whitespace for constants inside modules
    for (const m of content.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*=/gm)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        exports.push({ name: m[1], kind: 'const' });
      }
    }
  }

  return exports;
}

function extractApiRoutes(content: string, fileName: string): ApiRoute[] {
  const routes: ApiRoute[] = [];

  // Next.js App Router: export async function GET/POST/PUT/DELETE/PATCH
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/g)) {
    routes.push({ method: m[1], handler: m[1] });
  }

  // SvelteKit: export const GET/POST/etc: RequestHandler
  for (const m of content.matchAll(/export\s+const\s+(GET|POST|PUT|DELETE|PATCH)\s*[=:]/g)) {
    routes.push({ method: m[1], handler: m[1] });
  }

  // Express-style: router.get/post/put/delete
  for (const m of content.matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/g)) {
    routes.push({ method: m[1].toUpperCase(), handler: m[2] });
  }

  return routes;
}

function inferFilePurpose(
  fileName: string,
  exports: FileExport[],
  routes: ApiRoute[],
  content: string,
): string {
  const parts: string[] = [];

  // Try to extract first JSDoc/comment block as description
  const firstComment = extractFirstComment(content);
  if (firstComment) {
    parts.push(firstComment);
  }

  // API route file
  if (routes.length > 0) {
    parts.push(`API: ${routes.map(r => r.method).join(', ')}`);
  }

  // Component file — try to describe what it renders
  const components = exports.filter(e => e.kind === 'component');
  if (components.length > 0) {
    const desc = inferComponentPurpose(content, components[0].name);
    parts.push(desc || `Component: ${components.map(c => c.name).join(', ')}`);
  }

  // Type-only file
  const types = exports.filter(e => e.kind === 'type' || e.kind === 'interface');
  const functions = exports.filter(e => e.kind === 'function' || e.kind === 'class');
  if (types.length > 0 && functions.length === 0) {
    parts.push(`Types: ${types.map(t => t.name).join(', ')}`);
  }

  // Class-based file
  const classes = exports.filter(e => e.kind === 'class');
  if (classes.length > 0) {
    parts.push(classes.map(c => `class ${c.name}`).join(', '));
  }

  // Functions
  if (functions.length > 0 && classes.length === 0 && components.length === 0) {
    const fnNames = functions.slice(0, 4).map(f => f.name);
    if (functions.length > 4) fnNames.push(`+${functions.length - 4} more`);
    parts.push(fnNames.join(', '));
  }

  // Auth/role requirements
  if (content.includes('ADMIN_EMAILS') || content.includes('role') && content.includes('ADMIN')) {
    parts.push('Requires admin role');
  }
  if (content.includes('getServerSession') || content.includes('useSession')) {
    parts.push('Auth required');
  }

  // If nothing specific, use line count as indicator
  if (parts.length === 0) {
    const lines = content.split('\n').length;
    if (lines > 200) parts.push(`${lines} lines`);
  }

  return parts.join(' · ');
}

/** Extract the first comment block (JSDoc or //) from a file */
function extractFirstComment(content: string): string {
  // JSDoc: /** ... */
  const jsdoc = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+?)(?:\n|\*\/)/);
  if (jsdoc) return truncate(jsdoc[1].replace(/^\*\s*/, '').trim(), 80);

  // First // comment at top of file (skip shebangs and eslint)
  const lines = content.split('\n');
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    if (line.startsWith('//') && !line.includes('eslint') && !line.includes('#!')) {
      return truncate(line.replace(/^\/\/\s*/, ''), 80);
    }
  }

  return '';
}

/** Try to infer what a React/Next.js component does from its content */
function inferComponentPurpose(content: string, name: string): string {
  const parts: string[] = [];

  // Check for page metadata
  const titleMatch = content.match(/(?:title|<h1|<title)[^>]*>([^<]+)/i);
  if (titleMatch) parts.push(titleMatch[1].trim());

  // Check for form/CRUD patterns
  if (content.includes('onSubmit') || content.includes('handleSubmit')) parts.push('form');
  if (content.includes('useState') && content.includes('fetch')) parts.push('data fetching');
  if (content.includes('useEffect')) parts.push('side effects');

  // Check for specific UI patterns
  if (content.includes('table') || content.includes('DataTable') || content.includes('<table')) parts.push('table/list view');
  if (content.includes('modal') || content.includes('Modal') || content.includes('dialog')) parts.push('modal/dialog');
  if (content.includes('map') && (content.includes('Mapbox') || content.includes('leaflet') || content.includes('google.maps'))) parts.push('map view');

  if (parts.length > 0) {
    return `${name}: ${parts.join(', ')}`;
  }
  return '';
}

function detectPatterns(content: string, patterns: string[], seen: Set<string>): void {
  // Auth patterns
  if (content.includes('getServerSession') && !seen.has('auth:session')) {
    seen.add('auth:session');
    patterns.push('Uses getServerSession for authentication');
  }
  if (content.includes('ADMIN_EMAILS') && !seen.has('auth:admin')) {
    seen.add('auth:admin');
    patterns.push('Admin-only: checks ADMIN_EMAILS');
  }
  if (content.includes('NextAuth') && !seen.has('auth:nextauth')) {
    seen.add('auth:nextauth');
    patterns.push('NextAuth integration');
  }

  // Database patterns
  if (content.includes('prisma.') && !seen.has('db:prisma')) {
    seen.add('db:prisma');
    // Extract which models are used
    const models = new Set<string>();
    for (const m of content.matchAll(/prisma\.(\w+)\./g)) {
      if (m[1] !== '$' && m[1] !== 'transaction') models.add(m[1]);
    }
    if (models.size > 0) {
      patterns.push(`Prisma models: ${[...models].slice(0, 5).join(', ')}`);
    }
  }

  // Supabase
  if (content.includes('supabase') && !seen.has('db:supabase')) {
    seen.add('db:supabase');
    patterns.push('Uses Supabase client');
  }

  // Three.js / game
  if (content.includes('THREE.') && !seen.has('3d:three')) {
    seen.add('3d:three');
    patterns.push('Three.js 3D rendering');
  }

  // Error handling
  if (content.includes('NextResponse.json') && content.includes('catch') && !seen.has('pattern:error-handling')) {
    seen.add('pattern:error-handling');
    patterns.push('Standard try/catch with NextResponse.json error responses');
  }
}

function extractExternalImports(content: string, dirPath: string, imports: string[]): void {
  const seen = new Set(imports);

  // import from '../something' or '../../something'
  for (const m of content.matchAll(/from\s+['"](\.\.[^'"]+)['"]/g)) {
    const importPath = m[1];
    // Only track imports that go OUTSIDE this directory
    if (importPath.startsWith('../') && !seen.has(importPath)) {
      // Simplify to just the target directory
      const parts = importPath.split('/');
      const target = parts.slice(0, 3).join('/'); // e.g., "../../lib"
      if (!seen.has(target)) {
        seen.add(target);
        imports.push(target);
      }
    }
  }
}

/**
 * Extract structured content from schema files (.prisma, .graphql, .sql).
 */
function extractSchemaContent(content: string, fileName: string, ext: string): FileExport[] {
  switch (ext) {
    case '.prisma': return extractPrismaSchema(content);
    case '.graphql':
    case '.gql': return extractGraphqlSchema(content);
    case '.sql': return extractSqlSchema(content);
    default: return [];
  }
}

function extractPrismaSchema(content: string): FileExport[] {
  const exports: FileExport[] = [];
  const seen = new Set<string>();

  // Extract models: model User { ... }
  for (const m of content.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);

    // Extract field names and relations
    const fields: string[] = [];
    const relations: string[] = [];
    for (const line of m[2].split('\n')) {
      const fieldMatch = line.match(/^\s+(\w+)\s+(\w+)(\[\])?\s*/);
      if (fieldMatch) {
        fields.push(fieldMatch[1]);
        // Detect relations (field type starts with uppercase = model reference)
        if (fieldMatch[2][0] === fieldMatch[2][0].toUpperCase() && fieldMatch[2] !== 'String'
          && fieldMatch[2] !== 'Int' && fieldMatch[2] !== 'Float' && fieldMatch[2] !== 'Boolean'
          && fieldMatch[2] !== 'DateTime' && fieldMatch[2] !== 'Json' && fieldMatch[2] !== 'Bytes'
          && fieldMatch[2] !== 'BigInt' && fieldMatch[2] !== 'Decimal') {
          relations.push(fieldMatch[2]);
        }
      }
    }

    const sig = fields.length > 0
      ? `{ ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? `, +${fields.length - 6}` : ''} }${relations.length > 0 ? ` → ${relations.join(', ')}` : ''}`
      : undefined;
    exports.push({ name, kind: 'type', signature: sig });
  }

  // Extract enums: enum Role { ... }
  for (const m of content.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const values = m[2].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
    const sig = values.length > 0
      ? `{ ${values.slice(0, 5).join(', ')}${values.length > 5 ? `, +${values.length - 5}` : ''} }`
      : undefined;
    exports.push({ name, kind: 'enum', signature: sig });
  }

  // Extract generators and datasources for patterns
  for (const m of content.matchAll(/generator\s+(\w+)\s*\{/g)) {
    if (!seen.has(`gen:${m[1]}`)) {
      seen.add(`gen:${m[1]}`);
      exports.push({ name: m[1], kind: 'const', signature: 'generator' });
    }
  }

  return exports;
}

function extractGraphqlSchema(content: string): FileExport[] {
  const exports: FileExport[] = [];
  const seen = new Set<string>();

  // Types: type Query { ... }, type User { ... }
  for (const m of content.matchAll(/type\s+(\w+)\s*(?:implements\s+\w+)?\s*\{/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'type' });
    }
  }

  // Input types
  for (const m of content.matchAll(/input\s+(\w+)\s*\{/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'interface' });
    }
  }

  // Enums
  for (const m of content.matchAll(/enum\s+(\w+)\s*\{/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'enum' });
    }
  }

  return exports;
}

function extractSqlSchema(content: string): FileExport[] {
  const exports: FileExport[] = [];
  const seen = new Set<string>();

  // CREATE TABLE
  for (const m of content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'type', signature: 'table' });
    }
  }

  // CREATE INDEX
  for (const m of content.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+["'`]?(\w+)["'`]?/gi)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({ name: m[1], kind: 'const', signature: 'index' });
    }
  }

  return exports;
}

function inferSchemaFilePurpose(fileName: string, ext: string, exports: FileExport[]): string {
  const types = exports.filter(e => e.kind === 'type');
  const enums = exports.filter(e => e.kind === 'enum');
  const parts: string[] = [];

  switch (ext) {
    case '.prisma':
      if (types.length > 0) parts.push(`Prisma models: ${types.map(t => t.name).join(', ')}`);
      if (enums.length > 0) parts.push(`Enums: ${enums.map(e => e.name).join(', ')}`);
      break;
    case '.graphql':
    case '.gql':
      if (types.length > 0) parts.push(`GraphQL types: ${types.map(t => t.name).join(', ')}`);
      break;
    case '.sql':
      if (types.length > 0) parts.push(`Tables: ${types.map(t => t.name).join(', ')}`);
      break;
  }

  return parts.join(' · ') || `${ext.slice(1)} schema`;
}

function truncate(s: string, maxLen: number): string {
  // Clean up whitespace
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + '...';
}
