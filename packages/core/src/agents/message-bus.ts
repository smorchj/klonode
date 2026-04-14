/**
 * Message Bus — logs all interactions between user and CLI agents.
 * CO uses these logs to analyze patterns and improve the project.
 *
 * Storage: .klonode/logs/ as JSONL files (one per session).
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface InteractionMessage {
  /** Unique message ID */
  id: string;
  /** Timestamp */
  timestamp: string;
  /** Who sent the message */
  from: 'user' | string; // 'user' or agentId
  /** Who received the message */
  to: string; // agentId
  /** The message content */
  message: string;
  /** Token usage */
  tokens?: {
    input: number;
    output: number;
    total: number;
    costUsd?: number;
  };
  /** Context depth used */
  contextDepth?: string;
  /** Files that were routed */
  routedFiles?: string[];
  /** Execution mode */
  executionMode?: string;
  /** Duration in ms */
  durationMs?: number;
}

export interface InteractionSession {
  id: string;
  startedAt: string;
  messages: InteractionMessage[];
}

export interface MessageBus {
  /** Project root path */
  repoPath: string;
  /** Current session ID */
  sessionId: string;
  /** Log directory path */
  logDir: string;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Initialize the message bus for a project.
 */
export function createMessageBus(repoPath: string): MessageBus {
  const logDir = join(repoPath, '.klonode', 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  return {
    repoPath,
    sessionId: `session-${Date.now()}`,
    logDir,
  };
}

/**
 * Log an interaction message to the session log.
 */
export function logInteraction(bus: MessageBus, msg: Omit<InteractionMessage, 'id' | 'timestamp'>): InteractionMessage {
  const fullMsg: InteractionMessage = {
    id: makeId(),
    timestamp: new Date().toISOString(),
    ...msg,
  };

  const logFile = join(bus.logDir, `${bus.sessionId}.jsonl`);
  appendFileSync(logFile, JSON.stringify(fullMsg) + '\n', 'utf-8');

  return fullMsg;
}

/**
 * Read all messages from a session log.
 */
export function readSessionLog(bus: MessageBus, sessionId?: string): InteractionMessage[] {
  const logFile = join(bus.logDir, `${sessionId || bus.sessionId}.jsonl`);
  if (!existsSync(logFile)) return [];

  const lines = readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim());
  return lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * List all session IDs available.
 */
export function listSessionLogs(bus: MessageBus): string[] {
  if (!existsSync(bus.logDir)) return [];
  return readdirSync(bus.logDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''))
    .sort()
    .reverse();
}

/**
 * Analyze interaction logs to find patterns for CO improvement suggestions.
 */
export function analyzeInteractions(messages: InteractionMessage[]): InteractionAnalysis {
  const agentUsage = new Map<string, number>();
  const avgTokensByAgent = new Map<string, number[]>();
  const failedQueries: string[] = [];
  let totalTokens = 0;
  let totalCost = 0;

  for (const msg of messages) {
    if (msg.from === 'user') {
      const to = msg.to;
      agentUsage.set(to, (agentUsage.get(to) || 0) + 1);
    }

    if (msg.tokens) {
      totalTokens += msg.tokens.total;
      if (msg.tokens.costUsd) totalCost += msg.tokens.costUsd;

      const list = avgTokensByAgent.get(msg.to) || [];
      list.push(msg.tokens.total);
      avgTokensByAgent.set(msg.to, list);
    }

    // Detect failed interactions (high tokens, likely exploration)
    if (msg.tokens && msg.tokens.total > 50000 && msg.durationMs && msg.durationMs > 120000) {
      failedQueries.push(msg.message.slice(0, 100));
    }
  }

  const avgTokens = new Map<string, number>();
  for (const [agent, tokens] of avgTokensByAgent) {
    avgTokens.set(agent, Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length));
  }

  return {
    totalInteractions: messages.filter(m => m.from === 'user').length,
    agentUsage: Object.fromEntries(agentUsage),
    avgTokensByAgent: Object.fromEntries(avgTokens),
    totalTokens,
    totalCost,
    failedQueries,
  };
}

export interface InteractionAnalysis {
  totalInteractions: number;
  agentUsage: Record<string, number>;
  avgTokensByAgent: Record<string, number>;
  totalTokens: number;
  totalCost: number;
  failedQueries: string[];
}
