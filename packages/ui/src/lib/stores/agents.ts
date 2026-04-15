/**
 * Sessions store — manages multiple concurrent CLI chat sessions.
 * Each session is an independent chat with full Klonode routing.
 * Context routing happens automatically — user just picks which session to talk to.
 */

import { writable, derived } from 'svelte/store';

export type ContextDepth = 'minimal' | 'light' | 'standard' | 'heavy' | 'full';

export interface ChatSession {
  id: string;
  /** Short label for the tab (auto-generated from first message, or "Chat N") */
  label: string;
  /** When the session was created */
  createdAt: Date;
  /** Whether this is the CO (Chief Organizer) session */
  isCO?: boolean;
}

/** Tracked file operations from CLI tool use */
export interface FileOperation {
  type: 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'bash';
  path?: string;
  /** For grep: the pattern searched */
  pattern?: string;
  /** For bash: the command run */
  command?: string;
}

/** Metadata about what happened in a session (for CO analysis) */
export interface SessionMeta {
  /** Files that were read during this session */
  filesRead: string[];
  /** Files that were written or edited */
  filesChanged: string[];
  /** Commands that were run */
  commandsRun: string[];
  /** All file operations in order */
  operations: FileOperation[];
  /** Total tokens used across all messages */
  totalTokens: number;
  /** Total cost */
  totalCost: number;
  /** Estimated context usage (tokens) for CO */
  contextUsage?: number;
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens?: { input: number; output: number; total: number; costUsd?: number; numTurns?: number; elapsed?: number };
  timestamp: Date;
  loading?: boolean;
  routedFiles?: string[];
  isPlan?: boolean;
  planContext?: { query: string; context: string; files: string[]; folderPaths: string[]; repoPath: string };
  /** File operations extracted from this message's CLI response */
  fileOps?: FileOperation[];
  /**
   * True if this message was mid-stream (`loading: true`) when the app was
   * reloaded. Set on hydrate so the UI can render a "response interrupted by
   * reload" indicator instead of a spinner that never resolves. Cleared on
   * the next successful assistant response.
   */
  interrupted?: boolean;
}

interface SessionsState {
  sessions: ChatSession[];
  activeSessionId: string;
  messages: Record<string, SessionMessage[]>;
  metadata: Record<string, SessionMeta>;
  contextDepth: ContextDepth;
  nextNum: number;
  /** CO memory content (persisted) */
  coMemory: string;
  /** Closed session summaries waiting for CO to process */
  closedSessionQueue: { label: string; meta: SessionMeta; messageCount: number; summary: string }[];
  /**
   * Klonode session tab ID → Claude CLI session ID. Persisted so that after a
   * page reload or Vite server restart the next message in a tab resumes the
   * same Claude conversation instead of spawning a fresh one. See
   * self-hosting session survival work (#53 follow-up / #65 sibling).
   */
  cliSessionIds: Record<string, string>;
}

const STORAGE_KEY = 'klonode-sessions';

/**
 * Maximum messages kept per session in localStorage. When a session exceeds
 * this, the oldest messages are dropped at save time. Keeps the storage
 * footprint bounded so a long conversation doesn't blow through the ~5 MB
 * localStorage quota.
 */
const MAX_PERSISTED_MESSAGES_PER_SESSION = 50;

function makeId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function createCO(): ChatSession {
  return {
    id: 'co',
    label: 'CO',
    createdAt: new Date(),
    isCO: true,
  };
}

function createSession(num: number): ChatSession {
  return {
    id: makeId(),
    label: `Chat ${num}`,
    createdAt: new Date(),
  };
}

function emptyMeta(): SessionMeta {
  return { filesRead: [], filesChanged: [], commandsRun: [], operations: [], totalTokens: 0, totalCost: 0 };
}

function loadState(): SessionsState {
  const co = createCO();
  const first = createSession(1);
  const defaults: SessionsState = {
    sessions: [co, first],
    activeSessionId: first.id,
    messages: {},
    metadata: {},
    contextDepth: 'standard',
    nextNum: 2,
    coMemory: '',
    closedSessionQueue: [],
    cliSessionIds: {},
  };

  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.sessions?.length > 0) {
        const hasCO = saved.sessions.some((s: ChatSession) => s.isCO);
        if (!hasCO) saved.sessions.unshift(co);
        // Rehydrate Date objects that JSON.stringify turned into strings on
        // save — otherwise any code that calls .toISOString() on a message
        // timestamp throws after a reload.
        const rehydratedMessages: Record<string, SessionMessage[]> = {};
        for (const [sid, list] of Object.entries(saved.messages || {})) {
          rehydratedMessages[sid] = (list as SessionMessage[]).map(m => ({
            ...m,
            timestamp: new Date(m.timestamp as unknown as string),
            // A message flagged as loading at save time must have been
            // interrupted by the reload — mark it so the UI can render a
            // "this response was interrupted" indicator instead of a spinner
            // that never resolves.
            loading: false,
            interrupted: m.loading === true || (m as SessionMessage & { interrupted?: boolean }).interrupted === true,
          } as SessionMessage));
        }
        return {
          ...defaults, ...saved,
          messages: rehydratedMessages,
          metadata: saved.metadata || {},
          closedSessionQueue: saved.closedSessionQueue || [],
          coMemory: saved.coMemory || '',
          cliSessionIds: saved.cliSessionIds || {},
        };
      }
    }
  } catch { /* ignore */ }
  return defaults;
}

function saveState(state: SessionsState): void {
  if (typeof localStorage === 'undefined') return;
  // Persist messages with a per-session cap so a long conversation doesn't
  // blow through the localStorage quota. Keeps the last N messages per
  // session, drops everything older. Session list, CLI session IDs, metadata,
  // and CO memory are all persisted in full.
  const cappedMessages: Record<string, SessionMessage[]> = {};
  for (const [sid, list] of Object.entries(state.messages)) {
    if (list.length > MAX_PERSISTED_MESSAGES_PER_SESSION) {
      cappedMessages[sid] = list.slice(-MAX_PERSISTED_MESSAGES_PER_SESSION);
    } else {
      cappedMessages[sid] = list;
    }
  }
  const toSave = { ...state, messages: cappedMessages };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (err) {
    // QuotaExceededError — drop messages and try again with session list
    // only. Better to lose the backlog than to silently fail to persist the
    // session list and CLI session IDs (which are the critical path for
    // self-hosting survival).
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...toSave, messages: {} }));
    } catch { /* nothing more we can do */ }
  }
}

export const sessionsStore = writable<SessionsState>(loadState());

let skipSave = false;
sessionsStore.subscribe(s => {
  if (!skipSave) saveState(s);
});

// For backwards compatibility with ChatPanel imports
export const agentsStore = derived(sessionsStore, $s => ({
  agents: $s.sessions.map(s => ({
    id: s.id,
    name: s.label,
    role: 'worker' as const,
    description: '',
    contextPaths: ['*'],
    toolPermissions: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    maxTurns: 25,
    defaultContextDepth: $s.contextDepth,
    icon: '',
    color: '',
    tools: [],
  })),
  activeAgentId: $s.activeSessionId,
}));

export const activeSession = derived(sessionsStore, $s =>
  $s.sessions.find(s => s.id === $s.activeSessionId) || $s.sessions[0]
);

export const activeMessages = derived(sessionsStore, $s =>
  $s.messages[$s.activeSessionId] || []
);

export const contextDepth = derived(sessionsStore, $s => $s.contextDepth);

export function setActiveSession(sessionId: string): void {
  sessionsStore.update(s => ({ ...s, activeSessionId: sessionId }));
}

// Alias for ChatPanel compatibility
export function setActiveAgent(sessionId: string): void {
  setActiveSession(sessionId);
}

export function setContextDepth(depth: ContextDepth): void {
  sessionsStore.update(s => ({ ...s, contextDepth: depth }));
}

/**
 * Look up the Claude CLI session ID associated with a Klonode tab, or
 * `undefined` if there's no mapping yet (i.e. next message will start a
 * fresh conversation). Persisted via `saveState` so reloads and server
 * restarts preserve conversation continuity.
 */
export function getCliSessionId(klonodeSessionId: string): string | undefined {
  return get(sessionsStore).cliSessionIds[klonodeSessionId];
}

/**
 * Record the Claude CLI session ID for a Klonode tab. Called whenever a
 * streaming response emits its session id so follow-up messages in the
 * same tab resume the same Claude conversation.
 */
export function setCliSessionId(klonodeSessionId: string, cliSessionId: string): void {
  sessionsStore.update(s => ({
    ...s,
    cliSessionIds: { ...s.cliSessionIds, [klonodeSessionId]: cliSessionId },
  }));
}

/**
 * Drop the CLI session ID mapping for a tab. Called when the user clears
 * the chat so the next message starts fresh.
 */
export function clearCliSessionId(klonodeSessionId: string): void {
  sessionsStore.update(s => {
    if (!(klonodeSessionId in s.cliSessionIds)) return s;
    const next = { ...s.cliSessionIds };
    delete next[klonodeSessionId];
    return { ...s, cliSessionIds: next };
  });
}

/**
 * Clear the `interrupted` flag on a message once a new response has
 * successfully arrived for the same session. The flag is set at hydrate
 * time (see loadState) for any message that was `loading: true` when the
 * page unloaded.
 */
export function clearInterruptedFlag(sessionId: string, messageId: string): void {
  sessionsStore.update(s => {
    const list = s.messages[sessionId];
    if (!list) return s;
    const idx = list.findIndex(m => m.id === messageId);
    if (idx === -1 || !list[idx].interrupted) return s;
    const nextList = list.slice();
    nextList[idx] = { ...nextList[idx], interrupted: false };
    return { ...s, messages: { ...s.messages, [sessionId]: nextList } };
  });
}

export function addSession(): string {
  let newId = '';
  sessionsStore.update(s => {
    const session = createSession(s.nextNum);
    newId = session.id;
    return {
      ...s,
      sessions: [...s.sessions, session],
      activeSessionId: session.id,
      nextNum: s.nextNum + 1,
    };
  });
  return newId;
}

export function removeSession(sessionId: string): void {
  sessionsStore.update(s => {
    const session = s.sessions.find(sess => sess.id === sessionId);
    if (!session || session.isCO) return s;
    if (s.sessions.length <= 2) return s;

    // Capture session data for CO before removing
    const sessionMessages = s.messages[sessionId] || [];
    const meta = s.metadata[sessionId] || emptyMeta();

    // Build a summary of what happened in this session
    const userMsgs = sessionMessages.filter(m => m.role === 'user').map(m => m.content);
    const summary = [
      `Sesjon: "${session.label}"`,
      `Meldinger: ${sessionMessages.length}`,
      `Tokens: ${meta.totalTokens}`,
      meta.filesRead.length > 0 ? `Leste filer: ${meta.filesRead.join(', ')}` : '',
      meta.filesChanged.length > 0 ? `Endrede filer: ${meta.filesChanged.join(', ')}` : '',
      meta.commandsRun.length > 0 ? `Kommandoer: ${meta.commandsRun.join(', ')}` : '',
      userMsgs.length > 0 ? `Oppgaver: ${userMsgs.map(m => m.slice(0, 80)).join(' | ')}` : '',
    ].filter(Boolean).join('\n');

    const remaining = s.sessions.filter(sess => sess.id !== sessionId);
    const newMessages = { ...s.messages };
    delete newMessages[sessionId];
    const newMeta = { ...s.metadata };
    delete newMeta[sessionId];

    return {
      ...s,
      sessions: remaining,
      activeSessionId: s.activeSessionId === sessionId ? remaining[remaining.length - 1].id : s.activeSessionId,
      messages: newMessages,
      metadata: newMeta,
      closedSessionQueue: [...s.closedSessionQueue, {
        label: session.label,
        meta,
        messageCount: sessionMessages.length,
        summary,
      }],
    };
  });
}

export function renameSession(sessionId: string, label: string): void {
  sessionsStore.update(s => ({
    ...s,
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, label } : sess
    ),
  }));
}

/** Auto-label a session from its first user message */
export function autoLabelSession(sessionId: string, firstMessage: string): void {
  const label = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? '...' : '');
  renameSession(sessionId, label);
}

export function addSessionMessage(sessionId: string, msg: SessionMessage): void {
  skipSave = true;
  sessionsStore.update(s => {
    const existing = s.messages[sessionId] || [];
    return { ...s, messages: { ...s.messages, [sessionId]: [...existing, msg] } };
  });
  skipSave = false;
}

export function updateSessionMessage(sessionId: string, msgId: string, update: Partial<SessionMessage>): void {
  skipSave = true;
  sessionsStore.update(s => {
    const existing = s.messages[sessionId] || [];
    return {
      ...s,
      messages: {
        ...s.messages,
        [sessionId]: existing.map(m => m.id === msgId ? { ...m, ...update } : m),
      },
    };
  });
  skipSave = false;
}

export function clearSessionMessages(sessionId: string): void {
  sessionsStore.update(s => ({
    ...s,
    messages: { ...s.messages, [sessionId]: [] },
  }));
}

/** Track a file operation in a session's metadata */
export function trackFileOp(sessionId: string, op: FileOperation): void {
  sessionsStore.update(s => {
    const meta = s.metadata[sessionId] || emptyMeta();
    meta.operations.push(op);

    if (op.path) {
      if (op.type === 'read' || op.type === 'glob' || op.type === 'grep') {
        if (!meta.filesRead.includes(op.path)) meta.filesRead.push(op.path);
      } else if (op.type === 'write' || op.type === 'edit') {
        if (!meta.filesChanged.includes(op.path)) meta.filesChanged.push(op.path);
      }
    }
    if (op.type === 'bash' && op.command) {
      meta.commandsRun.push(op.command.slice(0, 100));
    }

    return { ...s, metadata: { ...s.metadata, [sessionId]: meta } };
  });
}

/** Update token totals for a session */
export function trackSessionTokens(sessionId: string, tokens: number, cost: number): void {
  sessionsStore.update(s => {
    const meta = s.metadata[sessionId] || emptyMeta();
    meta.totalTokens += tokens;
    meta.totalCost += cost;
    return { ...s, metadata: { ...s.metadata, [sessionId]: meta } };
  });
}

/** Get CO memory content */
export function getCOMemory(): string {
  const state = get(sessionsStore);
  return state.coMemory;
}

/** Update CO memory */
export function setCOMemory(content: string): void {
  sessionsStore.update(s => ({ ...s, coMemory: content }));
}

/** Get and clear the closed session queue */
export function popClosedSessions(): typeof get extends (s: any) => infer R ? R extends { closedSessionQueue: infer Q } ? Q : never : never {
  let queue: any[] = [];
  sessionsStore.update(s => {
    queue = s.closedSessionQueue;
    return { ...s, closedSessionQueue: [] };
  });
  return queue;
}

/** Get closed session queue without clearing */
export const closedSessionQueue = derived(sessionsStore, $s => $s.closedSessionQueue);

/** Get metadata for a session */
export const activeSessionMeta = derived(sessionsStore, $s =>
  $s.metadata[$s.activeSessionId] || emptyMeta()
);

/** Estimate CO context usage in tokens */
export const coContextUsage = derived(sessionsStore, $s => {
  const coMessages = $s.messages['co'] || [];
  let tokens = 0;
  for (const msg of coMessages) {
    // Rough estimate: 4 chars per token
    tokens += Math.ceil(msg.content.length / 4);
    if (msg.tokens) tokens += msg.tokens.total;
  }
  // Add CO memory
  tokens += Math.ceil($s.coMemory.length / 4);
  return tokens;
});

/** Max context for CO (1M tokens) */
export const CO_MAX_CONTEXT = 1_000_000;

// Keep old exports for compatibility
export function setAgents(_agents: any[]): void {
  // No-op — sessions are not generated from graph agents anymore
}

export type AgentDef = ChatSession & { role: string; icon: string; color: string; description: string; contextPaths: string[]; toolPermissions: string[]; maxTurns: number; defaultContextDepth: ContextDepth; tools: string[] };

export const CONTEXT_DEPTH_LABELS: Record<ContextDepth, { name: string; desc: string }> = {
  minimal: { name: 'Minimal', desc: 'Bare CLAUDE.md' },
  light: { name: 'Lett', desc: 'Root + L1 routing' },
  standard: { name: 'Standard', desc: 'Root + relevante mapper' },
  heavy: { name: 'Tung', desc: 'Alt + referanser + deps' },
  full: { name: 'Full', desc: 'Hele prosjektet' },
};
