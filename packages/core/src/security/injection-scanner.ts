/**
 * Injection scanner — scans CONTEXT.md files for likely prompt injection
 * content, including hand-edited ones that bypass the sanitizer.
 *
 * Runs during `klonode init`, `klonode status --security`, and can be
 * called directly from the UI to audit a repository.
 *
 * See #48 and the broader #45 threat model.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface ScanHit {
  /** Relative path to the scanned file */
  file: string;
  /** The pattern that matched (for logging) */
  pattern: string;
  /** A short excerpt of the matched content */
  excerpt: string;
  /** Severity — high for direct instruction overrides, medium for suspicious, low for minor */
  severity: 'high' | 'medium' | 'low';
  /** Human-readable description of what was detected */
  reason: string;
}

export interface ScanReport {
  /** Total number of files scanned */
  filesScanned: number;
  /** Total hits across all files */
  totalHits: number;
  /** Hits grouped by file path */
  hits: ScanHit[];
  /** Files flagged as suspicious (at least one high-severity hit) */
  suspiciousFiles: string[];
}

interface DetectorRule {
  pattern: RegExp;
  severity: ScanHit['severity'];
  reason: string;
}

/** Scanner rules — ordered by severity. */
const RULES: DetectorRule[] = [
  // High severity — direct instruction overrides
  {
    pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i,
    severity: 'high',
    reason: 'Direct instruction override attempt',
  },
  {
    pattern: /<\s*system\b|<\s*assistant\b|<\|im_start\|>|<\|system\|>/i,
    severity: 'high',
    reason: 'System prompt spoofing tags',
  },
  {
    pattern: /^\s*(?:system|assistant|user)\s*:/im,
    severity: 'high',
    reason: 'Role-prefix line (system/assistant/user: ...)',
  },

  // Medium severity — role override and jailbreak attempts
  {
    pattern: /\byou\s+are\s+now\s+|pretend\s+(?:to\s+be|you\s+are)|act\s+as\s+(?:if|a|an)\b/i,
    severity: 'medium',
    reason: 'Role-override phrase',
  },
  {
    pattern: /\b(?:DAN|developer|jailbreak|unrestricted)\s+mode\b/i,
    severity: 'medium',
    reason: 'Known jailbreak phrase',
  },
  {
    pattern: /\b(?:leak|exfiltrate)\s+(?:env|environment|secret|token|credential|api\s*key)/i,
    severity: 'medium',
    reason: 'Data exfiltration request',
  },

  // Low severity — suspicious but may be legitimate
  {
    pattern: /^#{4,}\s/m,
    severity: 'low',
    reason: 'Excessive markdown heading depth (H4+)',
  },
  {
    pattern: /[A-Za-z0-9+/]{200,}={0,2}/,
    severity: 'low',
    reason: 'Large base64-like blob (possible data smuggling)',
  },
  {
    pattern: /[\u202A-\u202E\u2066-\u2069]/,
    severity: 'low',
    reason: 'Bidirectional override character',
  },
  {
    pattern: /[\u{E0020}-\u{E007F}]/u,
    severity: 'low',
    reason: 'Invisible tag character (text smuggling)',
  },
];

/**
 * Scan a single file for injection patterns.
 * Returns empty array if nothing suspicious found.
 */
export function scanFile(filePath: string, relativePath: string): ScanHit[] {
  const hits: ScanHit[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return hits;
  }

  for (const rule of RULES) {
    const match = content.match(rule.pattern);
    if (match) {
      const idx = content.indexOf(match[0]);
      const start = Math.max(0, idx - 20);
      const end = Math.min(content.length, idx + match[0].length + 20);
      hits.push({
        file: relativePath,
        pattern: rule.pattern.source.slice(0, 60),
        excerpt: content.slice(start, end).replace(/\s+/g, ' ').trim(),
        severity: rule.severity,
        reason: rule.reason,
      });
    }
  }

  return hits;
}

/**
 * Recursively scan a repository for CONTEXT.md and CLAUDE.md files
 * and report any injection patterns found.
 */
export function scanRepository(repoPath: string, excludeDirs: string[] = []): ScanReport {
  const defaultExcludes = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    '.svelte-kit', '.turbo', 'coverage', '.klonode', ...excludeDirs,
  ]);

  const hits: ScanHit[] = [];
  let filesScanned = 0;
  const suspiciousFiles = new Set<string>();

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (defaultExcludes.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(full);
      } else if (entry === 'CONTEXT.md' || entry === 'CLAUDE.md') {
        const rel = full.startsWith(repoPath)
          ? full.slice(repoPath.length + 1).replace(/\\/g, '/')
          : full.replace(/\\/g, '/');
        filesScanned++;
        const fileHits = scanFile(full, rel);
        if (fileHits.length > 0) {
          hits.push(...fileHits);
          if (fileHits.some(h => h.severity === 'high')) {
            suspiciousFiles.add(rel);
          }
        }
      }
    }
  }

  if (existsSync(repoPath)) {
    walk(repoPath);
  }

  return {
    filesScanned,
    totalHits: hits.length,
    hits,
    suspiciousFiles: Array.from(suspiciousFiles),
  };
}

/**
 * Format a scan report as a human-readable CLI string.
 */
export function formatReport(report: ScanReport): string {
  if (report.totalHits === 0) {
    return `✓ Scanned ${report.filesScanned} CONTEXT/CLAUDE.md files. No injection patterns detected.`;
  }

  const lines: string[] = [];
  lines.push(`Scanned ${report.filesScanned} files. Found ${report.totalHits} suspicious pattern(s).`);
  if (report.suspiciousFiles.length > 0) {
    lines.push('');
    lines.push(`HIGH severity (${report.suspiciousFiles.length} file${report.suspiciousFiles.length > 1 ? 's' : ''}):`);
    for (const file of report.suspiciousFiles) {
      const fileHits = report.hits.filter(h => h.file === file && h.severity === 'high');
      lines.push(`  ${file}`);
      for (const hit of fileHits) {
        lines.push(`    - ${hit.reason}: "${hit.excerpt}"`);
      }
    }
  }
  const medium = report.hits.filter(h => h.severity === 'medium');
  if (medium.length > 0) {
    lines.push('');
    lines.push(`MEDIUM severity (${medium.length} hit${medium.length > 1 ? 's' : ''}):`);
    const byFile = new Map<string, ScanHit[]>();
    for (const h of medium) {
      const list = byFile.get(h.file) || [];
      list.push(h);
      byFile.set(h.file, list);
    }
    for (const [file, list] of byFile) {
      lines.push(`  ${file} (${list.length})`);
    }
  }
  const low = report.hits.filter(h => h.severity === 'low');
  if (low.length > 0) {
    lines.push('');
    lines.push(`LOW severity: ${low.length} hit${low.length > 1 ? 's' : ''} across ${new Set(low.map(h => h.file)).size} file${new Set(low.map(h => h.file)).size > 1 ? 's' : ''}`);
  }
  lines.push('');
  lines.push('Review these files before running Claude against this repository.');
  return lines.join('\n');
}
