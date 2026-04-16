/**
 * Suggestion engine — converts learning model scores into actionable
 * CONTEXT.md improvement proposals.
 *
 * Pure functions: `(learningState, graph) → Suggestion[]`. No side effects.
 * Each suggestion type is a separate strategy function so new types can be
 * added without touching the core loop.
 *
 * See #83 for the issue.
 */

import type { LearningState, NodeScore } from './learning.js';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type SuggestionType =
  | 'add-routing'     // folder missed by routing, Claude had to find it
  | 'remove-stale'    // folder in routing but never accessed
  | 'document-tool'   // repeated bash command should be in CONTEXT.md
  | 'split-node'      // folder gets too many reads, split into sub-nodes
  | 'add-reference';  // repeated grep pattern → add cross-reference

export type SuggestionStatus = 'pending' | 'approved' | 'dismissed' | 'snoozed';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  status: SuggestionStatus;
  /** Urgency score — controls sort order. Higher = more prominent. */
  urgency: number;
  /** Human-readable title. */
  title: string;
  /** Why the contextualizer thinks this. */
  reason: string;
  /** Folder path this suggestion pertains to. */
  path: string;
  /** When this suggestion was generated. */
  createdAt: string;
  /** When status was last changed. */
  updatedAt: string;
  /** If snoozed, until when. */
  snoozedUntil?: string;
}

// ---------------------------------------------------------------------------
// Strategy functions
// ---------------------------------------------------------------------------

/**
 * Detect folders that Claude reads/edits frequently but that don't have
 * their own CONTEXT.md mentioned in the parent's routing.
 */
function addRoutingSuggestions(state: LearningState): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const [path, score] of Object.entries(state.nodes)) {
    if (score.confidence >= 0.4 && score.signals.totalOps >= 3) {
      suggestions.push({
        id: `add-routing:${path}`,
        type: 'add-routing',
        status: 'pending',
        urgency: score.confidence + (score.urgency || 0),
        title: `Add routing for ${path}`,
        reason: `Claude accessed this folder ${score.signals.totalOps} times across ${score.signals.sessionsCount} session(s) (${score.signals.readCount} reads, ${score.signals.writeCount} writes). Confidence: ${(score.confidence * 100).toFixed(0)}%.`,
        path,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return suggestions;
}

/**
 * Detect folders with high urgency from emotion signals.
 */
function urgentFixSuggestions(state: LearningState): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const [path, score] of Object.entries(state.nodes)) {
    if (score.urgency > 1) {
      suggestions.push({
        id: `urgent-fix:${path}`,
        type: 'add-routing',
        status: 'pending',
        urgency: score.urgency,
        title: `Fix routing for ${path} (${score.signals.emotionEvents} correction events)`,
        reason: `Claude encountered problems in this folder: ${score.signals.emotionEvents} emotion events detected (corrections, hedges, or max_turns hits). Urgency score: ${score.urgency.toFixed(1)}.`,
        path,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate suggestions from learning state.
 */
export function generateSuggestions(state: LearningState): Suggestion[] {
  const all = [
    ...addRoutingSuggestions(state),
    ...urgentFixSuggestions(state),
  ];

  // Dedup by id (prefer higher urgency).
  const byId = new Map<string, Suggestion>();
  for (const s of all) {
    const existing = byId.get(s.id);
    if (!existing || s.urgency > existing.urgency) {
      byId.set(s.id, s);
    }
  }

  // Sort by urgency descending.
  return [...byId.values()].sort((a, b) => b.urgency - a.urgency);
}

// ---------------------------------------------------------------------------
// Persistence (`.klonode/suggestions.json`)
// ---------------------------------------------------------------------------

export interface SuggestionsFile {
  suggestions: Suggestion[];
  generatedAt: string;
}

export function saveSuggestions(repoPath: string, suggestions: Suggestion[]): void {
  const klonodeDir = join(repoPath, '.klonode');
  if (!existsSync(klonodeDir)) mkdirSync(klonodeDir, { recursive: true });
  const data: SuggestionsFile = {
    suggestions,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(klonodeDir, 'suggestions.json'), JSON.stringify(data, null, 2), 'utf-8');
}

export function loadSuggestions(repoPath: string): Suggestion[] {
  const filePath = join(repoPath, '.klonode', 'suggestions.json');
  if (!existsSync(filePath)) return [];
  try {
    const data: SuggestionsFile = JSON.parse(readFileSync(filePath, 'utf-8'));
    return data.suggestions || [];
  } catch {
    return [];
  }
}

export function updateSuggestionStatus(
  repoPath: string,
  suggestionId: string,
  status: SuggestionStatus,
  snoozedUntil?: string,
): void {
  const suggestions = loadSuggestions(repoPath);
  const idx = suggestions.findIndex(s => s.id === suggestionId);
  if (idx === -1) return;
  suggestions[idx].status = status;
  suggestions[idx].updatedAt = new Date().toISOString();
  if (snoozedUntil) suggestions[idx].snoozedUntil = snoozedUntil;
  saveSuggestions(repoPath, suggestions);
}
