/**
 * Learning model — the brain of the contextualizer.
 *
 * Works like human memory via two signal families:
 *
 * **Repetition** (boring, accumulative → `confidence` per node):
 *   - Same file read 3+ times across sessions → load-bearing, promote.
 *   - Folder missed by routing → Claude had to grep to find it → gap.
 *   - Same bash command repeated → document as a tool.
 *   - Same grep pattern recurring → missing cross-reference.
 *
 * **Emotion** (rare, high-weight, time-decayed → `urgency` per node):
 *   - User correction ("no", "stop", "wrong") → path Claude was on = wrong.
 *   - Long/expensive turns (high token count) → routing failed.
 *   - max_turns hit → routing definitely failed.
 *   - Fast user acceptance → routing worked, reinforce.
 *
 * Repetition is background hum. Emotion makes the suggestions panel light up.
 *
 * All functions are pure: `(observations, graph) → scores`. No side effects,
 * no ML, no weighting magic — just counted signals with published formulas
 * in the docstrings so the scores are interpretable.
 *
 * Part of the #77 pivot roadmap. See #80 (repetition) and #81 (emotion).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/** Observation entry shape — matches what observation-log.ts produces.
 * Duplicated here to avoid a cross-package import from core→ui. */
export interface ObservationEntry {
  at: string;
  sessionId: string;
  cwd: string;
  tool: string;
  kind: string;
  path: string;
  isSidechain: boolean;
  id: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeScore {
  /** Folder path (forward-slashed, relative to repo root). */
  path: string;
  /** Repetition-driven score in [0, 1]. How load-bearing this folder is. */
  confidence: number;
  /** Emotion-driven score in [0, ∞). How recently/badly something went wrong. */
  urgency: number;
  /** Breakdown of the signals that produced these scores. */
  signals: {
    /** Distinct sessions that touched this folder. */
    sessionsCount: number;
    /** Total reads across all sessions. */
    readCount: number;
    /** Total writes (Edit/Write) across all sessions. */
    writeCount: number;
    /** Total tool calls of any kind in this folder. */
    totalOps: number;
    /** Unique grep patterns used to find things in this folder. */
    grepPatterns: number;
    /** Number of emotion events (corrections, max_turns, etc). */
    emotionEvents: number;
  };
}

export interface LearningState {
  /** ISO timestamp when this state was last computed. */
  computedAt: string;
  /** Per-node scores, keyed by folder path. */
  nodes: Record<string, NodeScore>;
  /** Total observations analyzed. */
  observationCount: number;
  /** Distinct sessions in the observation window. */
  sessionCount: number;
}

// ---------------------------------------------------------------------------
// Emotion event parsing
// ---------------------------------------------------------------------------

/** Keywords in user messages that signal correction/frustration. */
const CORRECTION_KEYWORDS = [
  'no', 'stop', 'actually', 'wrong', 'that\'s wrong', 'not that',
  'nei', 'ikke', 'feil', 'stopp', 'vent', 'galt',
];

/** Keywords in assistant messages that signal routing failure. */
const HEDGE_KEYWORDS = [
  'i couldn\'t find', 'i can\'t locate', 'doesn\'t seem to exist',
  'not found', 'unable to find', 'finner ikke', 'kan ikke finne',
];

/** Keywords in user messages that signal satisfaction. */
const PRAISE_KEYWORDS = [
  'perfect', 'exactly', 'great', 'thanks', 'nailed it', 'good',
  'flott', 'perfekt', 'takk', 'bra',
];

export interface EmotionEvent {
  type: 'correction' | 'hedge' | 'max_turns' | 'expensive_turn' | 'praise';
  weight: number;
  /** ISO timestamp. */
  at: string;
  /** Folder path this event pertains to (from the surrounding tool calls). */
  path: string;
  /** Session id. */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Repetition scoring
// ---------------------------------------------------------------------------

/**
 * Compute `confidence` for every folder that appears in the observations.
 *
 * Formula:
 *   confidence = min(1, sessionFraction * 0.5 + editBoost * 0.3 + diversityBoost * 0.2)
 *
 * Where:
 *   - sessionFraction = (sessions touching this folder) / (total sessions)
 *   - editBoost = min(1, editCount / 10)  — edits weight more than reads
 *   - diversityBoost = min(1, distinctTools / 4) — variety signals importance
 *
 * All factors are in [0, 1]. The formula is deliberately simple and
 * interpretable — no hidden knobs, no training, no gradient descent.
 */
export function computeRepetition(observations: ObservationEntry[]): Map<string, NodeScore> {
  if (observations.length === 0) return new Map();

  // Group by folder path (strip file from path to get containing folder).
  const byFolder = new Map<string, ObservationEntry[]>();
  for (const obs of observations) {
    if (!obs.path || obs.path === '.') continue;
    const folder = toFolderPath(obs.path);
    if (!folder) continue;
    const list = byFolder.get(folder) || [];
    list.push(obs);
    byFolder.set(folder, list);
  }

  const allSessions = new Set(observations.map(o => o.sessionId));
  const totalSessions = Math.max(1, allSessions.size);

  const scores = new Map<string, NodeScore>();

  for (const [folder, entries] of byFolder) {
    const sessions = new Set(entries.map(e => e.sessionId));
    const reads = entries.filter(e => e.kind === 'read' || e.kind === 'search').length;
    const writes = entries.filter(e => e.kind === 'write').length;
    const tools = new Set(entries.map(e => e.tool));
    const grepEntries = entries.filter(e => e.tool === 'Grep');
    const grepPatterns = new Set(grepEntries.map(e => e.id)).size; // rough proxy

    const sessionFraction = sessions.size / totalSessions;
    const editBoost = Math.min(1, writes / 10);
    const diversityBoost = Math.min(1, tools.size / 4);

    const confidence = Math.min(1,
      sessionFraction * 0.5 + editBoost * 0.3 + diversityBoost * 0.2
    );

    scores.set(folder, {
      path: folder,
      confidence,
      urgency: 0, // filled by computeUrgency
      signals: {
        sessionsCount: sessions.size,
        readCount: reads,
        writeCount: writes,
        totalOps: entries.length,
        grepPatterns,
        emotionEvents: 0,
      },
    });
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Emotion scoring
// ---------------------------------------------------------------------------

/**
 * Parse emotion events from raw JSONL session data.
 *
 * This reads the original Claude Code session files (not the observation
 * log) because emotion signals come from user/assistant message text, not
 * just tool_use blocks.
 *
 * Returns a list of EmotionEvents that `computeUrgency` can process.
 */
export function extractEmotionEvents(
  sessionLines: string[],
): EmotionEvent[] {
  const events: EmotionEvent[] = [];
  let lastToolPath = '';

  for (const line of sessionLines) {
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const at = parsed.timestamp || new Date().toISOString();
    const sessionId = parsed.sessionId || '';

    // Track the last tool path for attribution.
    if (parsed.type === 'assistant' && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === 'tool_use' && block.input) {
          const path = block.input.file_path || block.input.path || '';
          if (path) lastToolPath = toFolderPath(normalizePath(path, parsed.cwd || '')) || '';
        }
      }

      // Check for max_turns
      if (parsed.message?.stop_reason === 'max_tokens' || parsed.subtype === 'error_max_turns') {
        if (lastToolPath) {
          events.push({ type: 'max_turns', weight: 3, at, path: lastToolPath, sessionId });
        }
      }

      // Check for hedges in assistant text
      for (const block of parsed.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const lower = block.text.toLowerCase();
          for (const kw of HEDGE_KEYWORDS) {
            if (lower.includes(kw)) {
              if (lastToolPath) {
                events.push({ type: 'hedge', weight: 1, at, path: lastToolPath, sessionId });
              }
              break;
            }
          }
        }
      }
    }

    // User messages: check for corrections or praise
    if (parsed.type === 'user' && parsed.message?.content) {
      let text = '';
      if (typeof parsed.message.content === 'string') {
        text = parsed.message.content;
      } else if (Array.isArray(parsed.message.content)) {
        text = parsed.message.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join(' ');
      }
      const lower = text.toLowerCase().trim();
      if (!lower) continue;

      // Check corrections
      for (const kw of CORRECTION_KEYWORDS) {
        if (lower.startsWith(kw) || lower.includes(` ${kw} `) || lower === kw) {
          if (lastToolPath) {
            events.push({ type: 'correction', weight: 5, at, path: lastToolPath, sessionId });
          }
          break;
        }
      }

      // Check praise
      for (const kw of PRAISE_KEYWORDS) {
        if (lower.includes(kw)) {
          if (lastToolPath) {
            events.push({ type: 'praise', weight: -2, at, path: lastToolPath, sessionId });
          }
          break;
        }
      }
    }
  }

  return events;
}

/**
 * Compute `urgency` for every folder that has emotion events.
 *
 * Formula (per node):
 *   urgency = Σ weight(event) * exp(-λ * ageInDays(event))
 *
 * Where λ = ln(2) / 7 (half-life of 7 days).
 *
 * Positive weights (corrections, max_turns) increase urgency.
 * Negative weights (praise) decrease it (capped at 0).
 */
export function computeUrgency(
  emotionEvents: EmotionEvent[],
  now: Date = new Date(),
): Map<string, number> {
  const HALF_LIFE_DAYS = 7;
  const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;
  const nowMs = now.getTime();

  const byFolder = new Map<string, EmotionEvent[]>();
  for (const ev of emotionEvents) {
    if (!ev.path) continue;
    const list = byFolder.get(ev.path) || [];
    list.push(ev);
    byFolder.set(ev.path, list);
  }

  const urgencyMap = new Map<string, number>();
  for (const [folder, events] of byFolder) {
    let urgency = 0;
    for (const ev of events) {
      const ageMs = nowMs - new Date(ev.at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      urgency += ev.weight * Math.exp(-LAMBDA * ageDays);
    }
    urgencyMap.set(folder, Math.max(0, urgency));
  }

  return urgencyMap;
}

// ---------------------------------------------------------------------------
// Combined scoring
// ---------------------------------------------------------------------------

/**
 * Compute the full learning state from observations and (optionally)
 * emotion events.
 */
export function computeLearningState(
  observations: ObservationEntry[],
  emotionEvents: EmotionEvent[] = [],
): LearningState {
  const repetitionScores = computeRepetition(observations);
  const urgencyScores = computeUrgency(emotionEvents);

  // Merge urgency into repetition scores.
  for (const [folder, urgency] of urgencyScores) {
    const existing = repetitionScores.get(folder);
    if (existing) {
      existing.urgency = urgency;
      existing.signals.emotionEvents = emotionEvents.filter(e => e.path === folder).length;
    } else {
      // Folder only has emotion events, no repetition data.
      repetitionScores.set(folder, {
        path: folder,
        confidence: 0,
        urgency,
        signals: {
          sessionsCount: 0,
          readCount: 0,
          writeCount: 0,
          totalOps: 0,
          grepPatterns: 0,
          emotionEvents: emotionEvents.filter(e => e.path === folder).length,
        },
      });
    }
  }

  const allSessions = new Set(observations.map(o => o.sessionId));

  const nodes: Record<string, NodeScore> = {};
  for (const [folder, score] of repetitionScores) {
    nodes[folder] = score;
  }

  return {
    computedAt: new Date().toISOString(),
    nodes,
    observationCount: observations.length,
    sessionCount: allSessions.size,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Save learning state to `.klonode/learning.json`.
 */
export function saveLearningState(repoPath: string, state: LearningState): void {
  const klonodeDir = join(repoPath, '.klonode');
  if (!existsSync(klonodeDir)) mkdirSync(klonodeDir, { recursive: true });
  writeFileSync(
    join(klonodeDir, 'learning.json'),
    JSON.stringify(state, null, 2),
    'utf-8',
  );
}

/**
 * Load learning state from `.klonode/learning.json`, or null if not computed yet.
 */
export function loadLearningState(repoPath: string): LearningState | null {
  const filePath = join(repoPath, '.klonode', 'learning.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip the file name to get the containing folder. */
function toFolderPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return normalized; // top-level file → folder is "."
  return normalized.slice(0, lastSlash);
}

/** Normalize a path to forward slashes and make it relative to cwd. */
function normalizePath(rawPath: string, cwd: string): string {
  if (!rawPath) return '';
  let p = rawPath.replace(/\\/g, '/');
  if (cwd) {
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/$/, '');
    if (p.startsWith(normalizedCwd + '/')) {
      p = p.slice(normalizedCwd.length + 1);
    }
  }
  return p;
}
