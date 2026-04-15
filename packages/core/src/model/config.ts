/**
 * Klonode project configuration.
 * Stored as .klonode/config.json in the target repo.
 */

export type ContextDepth = 'minimal' | 'light' | 'standard' | 'heavy' | 'full';

export interface KlonodeConfig {
  version: string;
  mode: 'inline' | 'shadow';
  language: 'nb' | 'en';
  autoOptimize: boolean;
  tokenBudgets: {
    layer0: number;
    layer1: number;
    layer2: number;
    layer3: number;
    layer4: number;
  };
  exclude: string[];
  contextFileMaxLines: number;
  telemetryEnabled: boolean;
  /** Auto-detected tools in the project */
  detectedTools: string[];
  /** Default context depth for new agents */
  defaultContextDepth: ContextDepth;
  /** CO analysis interval (interactions before auto-analysis) */
  coAnalysisInterval: number;
  /** Enable multi-agent mode */
  multiAgentEnabled: boolean;
  /**
   * Maximum file size (in bytes) the content extractor will read.
   * Files larger than this are skipped and reported in the directory's
   * `skippedLargeFiles` list so they show up as a warning in CONTEXT.md.
   * Defaults to 51200 (50KB).
   */
  maxFileSize: number;
}

export const DEFAULT_CONFIG: KlonodeConfig = {
  version: '0.1.0',
  mode: 'inline',
  language: 'nb',
  autoOptimize: false,
  tokenBudgets: {
    layer0: 800,
    layer1: 300,
    layer2: 1500,
    layer3: 2000,
    layer4: 1000,
  },
  exclude: [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.nuxt',
    '__pycache__',
    '.venv',
    'venv',
    'target',
    '.turbo',
    'coverage',
    '.klonode',
  ],
  contextFileMaxLines: 80,
  telemetryEnabled: true,
  detectedTools: [],
  defaultContextDepth: 'standard',
  coAnalysisInterval: 10,
  multiAgentEnabled: false,
  maxFileSize: 51200, // 50KB
};
