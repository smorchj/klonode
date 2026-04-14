/**
 * Chief Organizer (CO) — the oversight agent that improves the project.
 *
 * CO responsibilities:
 * 1. Analyze interaction logs to find pain points
 * 2. Suggest context improvements (better CONTEXT.md, new routing)
 * 3. Detect when new tools are added to the project
 * 4. Remember project decisions across sessions
 * 5. Generate improvement suggestions for the user
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { InteractionAnalysis, InteractionMessage } from './message-bus.js';
import type { DetectedTool } from '../analyzer/tool-detector.js';

export interface CODecision {
  timestamp: string;
  type: 'improvement' | 'observation' | 'tool-detected' | 'routing-change';
  description: string;
  actionTaken?: string;
}

export interface COState {
  /** Known detected tools (last scan) */
  knownTools: string[];
  /** Decisions and observations log */
  decisions: CODecision[];
  /** Last analysis timestamp */
  lastAnalysis: string | null;
  /** Interaction count since last analysis */
  interactionsSinceAnalysis: number;
  /** Analysis interval (number of interactions before auto-analysis) */
  analysisInterval: number;
}

export interface ImprovementSuggestion {
  type: 'add-context' | 'update-context' | 'add-tool' | 'restructure' | 'agent-config';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedPaths: string[];
}

const DEFAULT_STATE: COState = {
  knownTools: [],
  decisions: [],
  lastAnalysis: null,
  interactionsSinceAnalysis: 0,
  analysisInterval: 10,
};

/**
 * Load or initialize CO state for a project.
 */
export function loadCOState(repoPath: string): COState {
  const coDir = join(repoPath, '.klonode', 'co');
  const statePath = join(coDir, 'state.json');

  if (existsSync(statePath)) {
    try {
      return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(statePath, 'utf-8')) };
    } catch { /* corrupt file */ }
  }

  return { ...DEFAULT_STATE };
}

/**
 * Save CO state.
 */
export function saveCOState(repoPath: string, state: COState): void {
  const coDir = join(repoPath, '.klonode', 'co');
  if (!existsSync(coDir)) mkdirSync(coDir, { recursive: true });

  writeFileSync(join(coDir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Record that an interaction happened (CO counts toward auto-analysis threshold).
 */
export function recordInteraction(repoPath: string): { shouldAnalyze: boolean } {
  const state = loadCOState(repoPath);
  state.interactionsSinceAnalysis++;
  const shouldAnalyze = state.interactionsSinceAnalysis >= state.analysisInterval;
  saveCOState(repoPath, state);
  return { shouldAnalyze };
}

/**
 * Check if new tools have been added since last scan.
 */
export function checkForNewTools(
  repoPath: string,
  currentTools: DetectedTool[],
): DetectedTool[] {
  const state = loadCOState(repoPath);
  const knownSet = new Set(state.knownTools);
  const newTools = currentTools.filter(t => !knownSet.has(t.id));

  if (newTools.length > 0) {
    // Update known tools
    state.knownTools = currentTools.map(t => t.id);
    for (const tool of newTools) {
      state.decisions.push({
        timestamp: new Date().toISOString(),
        type: 'tool-detected',
        description: `New tool detected: ${tool.name} (${tool.category}) via ${tool.configPath}`,
      });
    }
    saveCOState(repoPath, state);
  }

  return newTools;
}

/**
 * Generate improvement suggestions based on interaction analysis.
 */
export function generateSuggestions(
  analysis: InteractionAnalysis,
  state: COState,
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  // High token usage agents → need better context
  for (const [agent, avgTokens] of Object.entries(analysis.avgTokensByAgent)) {
    if (avgTokens > 30000) {
      suggestions.push({
        type: 'update-context',
        priority: 'high',
        title: `${agent} bruker for mange tokens (snitt ${Math.round(avgTokens / 1000)}k)`,
        description: 'Agenten bruker mye tokens per interaksjon. CONTEXT.md filene kan forbedres med mer spesifikk routing.',
        affectedPaths: [agent],
      });
    }
  }

  // Failed queries → routing gaps
  if (analysis.failedQueries.length > 0) {
    suggestions.push({
      type: 'add-context',
      priority: 'high',
      title: `${analysis.failedQueries.length} spørsmål brukte for lang tid`,
      description: `Disse spørsmålene tok for lang tid og brukte mange tokens:\n${analysis.failedQueries.map(q => `- "${q}"`).join('\n')}`,
      affectedPaths: [],
    });
  }

  // Unused agents → maybe remove or merge
  const totalInteractions = analysis.totalInteractions;
  if (totalInteractions > 10) {
    for (const [agent, count] of Object.entries(analysis.agentUsage)) {
      if (count < 2 && agent !== 'co') {
        suggestions.push({
          type: 'agent-config',
          priority: 'low',
          title: `${agent} brukes sjelden (${count}/${totalInteractions} interaksjoner)`,
          description: 'Vurder å slå sammen denne agenten med en annen, eller fjern den.',
          affectedPaths: [agent],
        });
      }
    }
  }

  return suggestions;
}

/**
 * Generate the CO's project overview — a CONTEXT.md-style summary for the CO agent.
 */
export function generateCOContext(
  state: COState,
  tools: DetectedTool[],
  analysis?: InteractionAnalysis,
): string {
  const lines: string[] = [
    '# Chief Organizer — Project State',
    '',
    '## Detected Tools',
  ];

  if (tools.length > 0) {
    for (const t of tools) {
      lines.push(`- **${t.name}**${t.version ? ` v${t.version}` : ''} (${t.category}) — ${t.contextHint.slice(0, 80)}`);
    }
  } else {
    lines.push('- No tools detected yet');
  }

  lines.push('', '## Recent Decisions');
  const recent = state.decisions.slice(-10);
  if (recent.length > 0) {
    for (const d of recent) {
      lines.push(`- [${d.timestamp.slice(0, 10)}] ${d.type}: ${d.description}`);
    }
  } else {
    lines.push('- No decisions recorded yet');
  }

  if (analysis) {
    lines.push('', '## Interaction Stats');
    lines.push(`- Total interactions: ${analysis.totalInteractions}`);
    lines.push(`- Total tokens: ${Math.round(analysis.totalTokens / 1000)}k`);
    lines.push(`- Total cost: $${analysis.totalCost.toFixed(2)}`);

    if (Object.keys(analysis.agentUsage).length > 0) {
      lines.push('', '### Agent Usage');
      for (const [agent, count] of Object.entries(analysis.agentUsage)) {
        const avg = analysis.avgTokensByAgent[agent];
        lines.push(`- ${agent}: ${count} queries, avg ${Math.round((avg || 0) / 1000)}k tokens`);
      }
    }
  }

  return lines.join('\n');
}
