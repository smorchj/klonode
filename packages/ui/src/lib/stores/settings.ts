/**
 * Settings store — persisted to localStorage.
 * Users configure their Claude connection here (CLI path or API key).
 */

import { writable } from 'svelte/store';

export interface KlonodeSettings {
  /** 'cli' uses Claude Code CLI, 'api' uses Anthropic API directly */
  connectionMode: 'cli' | 'api';
  /** Path to claude CLI binary (auto-detected or user-set) */
  cliPath: string;
  /** Anthropic API key (only used if connectionMode === 'api') */
  apiKey: string;
  /** Model to use */
  model: string;
  /** Max tokens for response */
  maxTokens: number;
  /** Execution mode for chat */
  executionMode: 'auto' | 'plan' | 'question' | 'bypass';
}

const STORAGE_KEY = 'klonode-settings';

const defaults: KlonodeSettings = {
  connectionMode: 'cli',
  cliPath: '',  // auto-detected on first open via /api/chat GET
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 1024,
  executionMode: 'auto',
};

const VALID_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
];

function loadSettings(): KlonodeSettings {
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = { ...defaults, ...JSON.parse(raw) };
      // Reset model if it's stale/invalid
      if (!VALID_MODELS.includes(saved.model)) {
        saved.model = defaults.model;
      }
      return saved;
    }
  } catch { /* ignore */ }
  return defaults;
}

function saveSettings(settings: KlonodeSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const settingsStore = writable<KlonodeSettings>(loadSettings());

// Auto-persist on change
settingsStore.subscribe(saveSettings);

export function updateSettings(partial: Partial<KlonodeSettings>): void {
  settingsStore.update(s => ({ ...s, ...partial }));
}
