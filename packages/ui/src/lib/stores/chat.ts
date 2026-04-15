/**
 * Chat store — manages Claude conversations with Klonode routing.
 *
 * Default mode: normal chat with Klonode routing in the background.
 * Compare mode: sends both with and without Klonode to show token savings.
 */

import { writable, get } from 'svelte/store';
import { graphStore } from './graph';
import { settingsStore } from './settings';
import { sessionsStore } from './agents';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode?: 'with-klonode' | 'without-klonode';
  tokens?: {
    input: number;
    output: number;
    total: number;
    numTurns?: number;
    elapsed?: number;
    costUsd?: number;
  };
  timestamp: Date;
  loading?: boolean;
  /** Which files were routed for this response */
  routedFiles?: string[];
  /** If this is a plan awaiting approval */
  isPlan?: boolean;
  /** The original query + context for re-executing after plan approval */
  planContext?: { query: string; context: string; files: string[]; folderPaths: string[]; repoPath: string };
  /**
   * True if this message was mid-stream (`loading: true`) when the app
   * was reloaded. Set at hydrate time so the UI can render a "response
   * interrupted by reload" indicator instead of a spinner that never
   * resolves.
   */
  interrupted?: boolean;
}

export interface ChatComparison {
  withKlonode: ChatMessage | null;
  withoutKlonode: ChatMessage | null;
}

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  lastComparison: ChatComparison | null;
  error: string | null;
  /** 'chat' = normal working chat, 'compare' = side-by-side comparison */
  chatMode: 'chat' | 'compare';
}

const initial: ChatState = {
  messages: [],
  isLoading: false,
  lastComparison: null,
  error: null,
  chatMode: 'chat',
};

/**
 * Self-hosting survival: persist the user-facing chat conversation to
 * localStorage so reloads (including Vite server restarts triggered by
 * editing a server-side file) preserve the active chat. Cap the persisted
 * list so a long conversation doesn't blow through the localStorage quota,
 * and leave `isLoading` / `error` / `lastComparison` out of the snapshot
 * since they're transient UI state.
 */
const CHAT_STORAGE_KEY = 'klonode-chat';
const MAX_PERSISTED_CHAT_MESSAGES = 80;

function loadChatState(): ChatState {
  if (typeof localStorage === 'undefined') return initial;
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return initial;
    const saved = JSON.parse(raw) as Partial<ChatState>;
    const messages = Array.isArray(saved.messages) ? saved.messages : [];
    // Rehydrate Date timestamps (JSON.stringify turns Date into an ISO
    // string). Any message that was `loading: true` at save time must have
    // been interrupted by the reload — mark it so the UI renders a
    // "response interrupted" indicator instead of a spinner that never
    // resolves.
    const rehydrated: ChatMessage[] = messages.map((m: ChatMessage & { interrupted?: boolean }) => ({
      ...m,
      timestamp: new Date(m.timestamp as unknown as string),
      loading: false,
      interrupted: m.loading === true || m.interrupted === true,
    }));
    return {
      ...initial,
      messages: rehydrated,
      chatMode: saved.chatMode === 'compare' ? 'compare' : 'chat',
    };
  } catch {
    return initial;
  }
}

function saveChatState(state: ChatState): void {
  if (typeof localStorage === 'undefined') return;
  const capped =
    state.messages.length > MAX_PERSISTED_CHAT_MESSAGES
      ? state.messages.slice(-MAX_PERSISTED_CHAT_MESSAGES)
      : state.messages;
  const toSave = { messages: capped, chatMode: state.chatMode };
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // QuotaExceededError — drop messages entirely rather than lose the mode
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ messages: [], chatMode: state.chatMode }));
    } catch { /* nothing more we can do */ }
  }
}

export const chatStore = writable<ChatState>(loadChatState());

// Auto-persist on every change. The update is synchronous and cheap
// relative to a JSON.stringify of under 100 messages so we don't bother
// debouncing.
chatStore.subscribe(saveChatState);

/**
 * Route the query through the graph to find relevant CONTEXT.md files.
 * Returns the routed context string and list of file paths.
 */
function routeQuery(query: string): { context: string; files: string[]; folderPaths: string[]; repoPath: string } {
  const graph = get(graphStore);
  if (!graph) return { context: 'Ingen graf lastet.', files: [], folderPaths: [], repoPath: '' };

  const parts: string[] = [];
  const files: string[] = [];
  const queryLower = query.toLowerCase();

  // Always include root CONTEXT.md (L0/L1)
  const root = graph.nodes.get(graph.rootNodeId);
  if (root?.contextFile?.rawMarkdown) {
    parts.push(`## ${root.path}/CONTEXT.md\n${root.contextFile.rawMarkdown}`);
    files.push(root.path + '/CONTEXT.md');
  }

  // Score each L1 node against the query
  const scored: { id: string; score: number }[] = [];
  for (const childId of root?.children || []) {
    const node = graph.nodes.get(childId);
    if (!node) continue;

    let score = 0;
    const nameLower = node.name.toLowerCase();
    const summaryLower = (node.summary || '').toLowerCase();

    // Direct name match
    if (queryLower.includes(nameLower)) score += 10;
    // Keyword matching
    const keywords = queryLower.split(/\s+/);
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score += 5;
      if (summaryLower.includes(kw)) score += 3;
    }
    // Domain keyword mapping
    const DOMAIN_MAP: Record<string, string[]> = {
      game: ['game', 'physics', 'combat', 'player', 'world', 'map', 'enemy', 'level'],
      api: ['api', 'endpoint', 'route', 'server', 'rest', 'request'],
      components: ['component', 'ui', 'button', 'form', 'layout'],
      auth: ['auth', 'login', 'session', 'token', 'bruker', 'user', 'password'],
      prisma: ['database', 'db', 'prisma', 'schema', 'migration', 'query', 'sql'],
      app: ['app', 'page', 'routing', 'navigation'],
      public: ['asset', 'image', 'model', 'texture', '3d', 'bilde'],
      scripts: ['script', 'agent', 'scraper', 'automation'],
      lib: ['lib', 'util', 'helper', 'shared'],
      types: ['type', 'interface', 'typing'],
    };
    for (const [domain, domainKws] of Object.entries(DOMAIN_MAP)) {
      if (nameLower.includes(domain)) {
        for (const dk of domainKws) {
          if (queryLower.includes(dk)) score += 8;
        }
      }
    }

    if (score > 0) scored.push({ id: childId, score });
  }

  // Sort by score, take top matches
  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, 3);

  // Collect folder paths for actual source file reading
  const folderPaths: string[] = [];

  // Add matched nodes and their children
  for (const match of topMatches) {
    const node = graph.nodes.get(match.id);
    if (!node) continue;
    folderPaths.push(node.path);
    if (node.contextFile?.rawMarkdown) {
      parts.push(`## ${node.path}/CONTEXT.md\n${node.contextFile.rawMarkdown}`);
      files.push(node.path + '/CONTEXT.md');
    }
    // Also include relevant children
    for (const childId of node.children) {
      const child = graph.nodes.get(childId);
      if (!child) continue;
      const childNameLower = child.name.toLowerCase();
      const isRelevant = queryLower.split(/\s+/).some(kw => childNameLower.includes(kw));
      if (isRelevant && child.contextFile?.rawMarkdown) {
        folderPaths.push(child.path);
        parts.push(`## ${child.path}/CONTEXT.md\n${child.contextFile.rawMarkdown}`);
        files.push(child.path + '/CONTEXT.md');
      }
    }
  }

  // CROSS-LAYER ROUTING: follow dependency edges to connected folders
  const includedPaths = new Set(folderPaths);
  for (const match of topMatches) {
    const matchNode = graph.nodes.get(match.id);
    if (!matchNode) continue;
    // Follow outgoing dependencies (what this folder imports from)
    const outEdges = graph.edges.filter(e => e.from === match.id && e.type === 'depends_on');
    for (const edge of outEdges.slice(0, 2)) {
      const depNode = graph.nodes.get(edge.to);
      if (depNode && depNode.contextFile?.rawMarkdown && !includedPaths.has(depNode.path)) {
        includedPaths.add(depNode.path);
        folderPaths.push(depNode.path);
        parts.push(`## ${depNode.path}/CONTEXT.md\n${depNode.contextFile.rawMarkdown}`);
        files.push(depNode.path + '/CONTEXT.md');
      }
    }
  }

  // If no matches, include a broad overview (top 3 by file count)
  if (topMatches.length === 0) {
    const allChildren = (root?.children || [])
      .map(id => graph.nodes.get(id))
      .filter(Boolean)
      .sort((a, b) => (b!.children.length - a!.children.length))
      .slice(0, 3);
    for (const node of allChildren) {
      if (node) folderPaths.push(node.path);
      if (node?.contextFile?.rawMarkdown) {
        parts.push(`## ${node.path}/CONTEXT.md\n${node.contextFile.rawMarkdown}`);
        files.push(node.path + '/CONTEXT.md');
      }
    }
  }

  return { context: parts.join('\n\n---\n\n'), files, folderPaths, repoPath: graph.repoPath };
}

/**
 * Build context string from ALL nodes (without-Klonode mode for comparison).
 */
function buildFullContext(): { context: string; fileCount: number } {
  const graph = get(graphStore);
  if (!graph) return { context: 'Ingen graf lastet.', fileCount: 0 };

  const parts: string[] = [];
  let fileCount = 0;

  parts.push('## Prosjektstruktur');
  const treeLines: string[] = [];
  function walkTree(nodeId: string, depth: number) {
    const node = graph!.nodes.get(nodeId);
    if (!node) return;
    treeLines.push(`${'  '.repeat(depth)}${node.name}/ — ${node.summary || ''}`);
    for (const childId of node.children) {
      walkTree(childId, depth + 1);
    }
  }
  walkTree(graph.rootNodeId, 0);
  parts.push(treeLines.join('\n'));

  for (const [, node] of graph.nodes) {
    if (node.contextFile?.rawMarkdown) {
      parts.push(`## ${node.path}/CONTEXT.md\n${node.contextFile.rawMarkdown}`);
      fileCount++;
    }
  }

  return { context: parts.join('\n\n---\n\n'), fileCount };
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Auto-classify a query by asking Claude to interpret the intent.
 * Returns 'question', 'plan', or 'bypass'.
 */
async function classifyQuery(query: string): Promise<'question' | 'plan' | 'bypass'> {
  const settings = get(settingsStore);

  try {
    const res = await fetch('/api/chat/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: query,
        connectionMode: settings.connectionMode,
        cliPath: settings.cliPath,
        apiKey: settings.apiKey,
      }),
    });
    const data = await res.json();
    const mode = data.mode;
    if (mode === 'question' || mode === 'plan' || mode === 'bypass') {
      console.log(`[Klonode] Auto-classified as: ${mode}`);
      return mode;
    }
  } catch (err) {
    console.warn('[Klonode] Classification failed, defaulting to bypass:', err);
  }
  return 'bypass';
}

/**
 * Send a normal chat message — routes context via Klonode automatically.
 * In plan mode: first generates a read-only plan. In bypass mode: executes directly with full permissions.
 */
/**
 * Check if the current active session is the CO (Chief Organizer).
 */
function isActiveSessionCO(): boolean {
  const state = get(sessionsStore);
  const active = state.sessions.find(s => s.id === state.activeSessionId);
  return active?.isCO === true;
}

export async function sendMessage(userMessage: string): Promise<void> {
  const settings = get(settingsStore);
  const isCO = isActiveSessionCO();

  if (settings.connectionMode === 'cli' && !settings.cliPath) {
    chatStore.update(s => ({ ...s, error: 'Claude CLI-sti mangler. Klikk innstillinger.' }));
    return;
  }
  if (settings.connectionMode === 'api' && !settings.apiKey) {
    chatStore.update(s => ({ ...s, error: 'API-nøkkel mangler. Klikk innstillinger.' }));
    return;
  }

  const { context, files, folderPaths, repoPath } = routeQuery(userMessage);

  const userMsg: ChatMessage = {
    id: makeId(), role: 'user', content: userMessage,
    timestamp: new Date(),
  };
  const loadingMsg: ChatMessage = {
    id: makeId(), role: 'assistant', content: '',
    loading: true, timestamp: new Date(), routedFiles: isCO ? [] : files,
  };

  chatStore.update(s => ({
    ...s, isLoading: true, error: null,
    messages: [...s.messages, userMsg, loadingMsg],
  }));

  try {
    // CO always gets bypass mode with all tools — no classification needed
    // Regular sessions resolve execution mode normally
    const execMode = isCO
      ? 'bypass'
      : (settings.executionMode === 'auto'
        ? await classifyQuery(userMessage)
        : settings.executionMode);
    console.log(`[Klonode] ${isCO ? 'CO' : 'Chat'} mode: ${execMode}`);

    // CO gets heavy context (or routing when relevant), regular sessions use normal routing
    const chatContext = isCO ? '' : context; // CO's context comes from its system prompt
    const data = await callChat(userMessage, chatContext, 'with-klonode', repoPath, folderPaths, execMode, isCO);

    const assistantMsg: ChatMessage = {
      id: loadingMsg.id,
      role: 'assistant',
      content: data.text,
      tokens: { input: data.inputTokens, output: data.outputTokens, total: data.totalTokens },
      timestamp: new Date(),
      routedFiles: files,
      // If plan mode, mark as plan awaiting approval
      isPlan: execMode === 'plan',
      planContext: execMode === 'plan' ? { query: userMessage, context, files, folderPaths, repoPath } : undefined,
    };

    chatStore.update(s => ({
      ...s, isLoading: false,
      messages: s.messages.map(m => m.id === loadingMsg.id ? assistantMsg : m),
    }));
  } catch (err) {
    chatStore.update(s => ({
      ...s, isLoading: false,
      messages: s.messages.map(m => m.id === loadingMsg.id
        ? { ...m, loading: false, content: `Feil: ${err instanceof Error ? err.message : 'Ukjent feil'}` }
        : m),
    }));
  }
}

/**
 * Approve a plan and execute it with full bypass permissions.
 */
export async function approvePlan(planMessageId: string): Promise<void> {
  const state = get(chatStore);
  const planMsg = state.messages.find(m => m.id === planMessageId);
  if (!planMsg?.planContext) return;

  const { query, context, files, folderPaths, repoPath } = planMsg.planContext;

  // Mark plan as approved (no longer a pending plan)
  chatStore.update(s => ({
    ...s,
    messages: s.messages.map(m => m.id === planMessageId ? { ...m, isPlan: false } : m),
  }));

  // Add loading message for execution
  const loadingMsg: ChatMessage = {
    id: makeId(), role: 'assistant', content: '',
    loading: true, timestamp: new Date(), routedFiles: files,
  };

  chatStore.update(s => ({
    ...s, isLoading: true, error: null,
    messages: [...s.messages, loadingMsg],
  }));

  try {
    // Execute the plan with bypass permissions — include the plan as context
    const executePrompt = `Utfør denne planen:\n\n${planMsg.content}\n\nOpprinnelig spørsmål: ${query}`;
    const data = await callChat(executePrompt, context, 'with-klonode', repoPath, folderPaths, 'bypass');

    const resultMsg: ChatMessage = {
      id: loadingMsg.id,
      role: 'assistant',
      content: data.text,
      tokens: { input: data.inputTokens, output: data.outputTokens, total: data.totalTokens },
      timestamp: new Date(),
      routedFiles: files,
    };

    chatStore.update(s => ({
      ...s, isLoading: false,
      messages: s.messages.map(m => m.id === loadingMsg.id ? resultMsg : m),
    }));
  } catch (err) {
    chatStore.update(s => ({
      ...s, isLoading: false,
      messages: s.messages.map(m => m.id === loadingMsg.id
        ? { ...m, loading: false, content: `Feil: ${err instanceof Error ? err.message : 'Ukjent feil'}` }
        : m),
    }));
  }
}

/**
 * Send comparison — fires both with and without Klonode in parallel.
 */
export async function sendComparison(userMessage: string): Promise<void> {
  const settings = get(settingsStore);

  if (settings.connectionMode === 'cli' && !settings.cliPath) {
    chatStore.update(s => ({ ...s, error: 'Claude CLI-sti mangler. Klikk innstillinger.' }));
    return;
  }
  if (settings.connectionMode === 'api' && !settings.apiKey) {
    chatStore.update(s => ({ ...s, error: 'API-nøkkel mangler. Klikk innstillinger.' }));
    return;
  }

  const { context: routedContext, files, folderPaths, repoPath } = routeQuery(userMessage);

  const userMsg: ChatMessage = {
    id: makeId(), role: 'user', content: userMessage,
    timestamp: new Date(),
  };
  const loadingWith: ChatMessage = {
    id: makeId(), role: 'assistant', content: '',
    mode: 'with-klonode', loading: true, timestamp: new Date(), routedFiles: files,
  };
  const loadingWithout: ChatMessage = {
    id: makeId(), role: 'assistant', content: '',
    mode: 'without-klonode', loading: true, timestamp: new Date(),
  };

  chatStore.update(s => ({
    ...s, isLoading: true, error: null,
    messages: [...s.messages, userMsg, loadingWith, loadingWithout],
    lastComparison: null,
  }));

  // Helper to build message from result
  const toMsg = (result: { status: string; value?: any; reason?: any }, loadId: string, mode: 'with-klonode' | 'without-klonode'): ChatMessage => ({
    id: loadId,
    role: 'assistant',
    content: result.status === 'fulfilled' ? result.value.text : `Feil: ${result.reason}`,
    mode,
    tokens: result.status === 'fulfilled' ? {
      input: result.value.inputTokens,
      output: result.value.outputTokens,
      total: result.value.totalTokens,
      numTurns: result.value.numTurns,
      elapsed: result.value.elapsed,
      costUsd: result.value.costUsd,
    } : undefined,
    timestamp: new Date(),
    routedFiles: mode === 'with-klonode' ? files : undefined,
  });

  // Run SEQUENTIALLY — without-Klonode FIRST so it gets no cache benefit from Klonode
  // This ensures a fair comparison: without-Klonode starts cold, just like a normal user
  const withoutResult = await callChat(userMessage, '', 'without-klonode', repoPath)
    .then(r => ({ status: 'fulfilled' as const, value: r }))
    .catch(e => ({ status: 'rejected' as const, reason: e }));

  // Update the without-Klonode message immediately so user sees progress
  const withoutMsg = toMsg(withoutResult, loadingWithout.id, 'without-klonode');
  chatStore.update(s => ({
    ...s,
    messages: s.messages.map(m => m.id === loadingWithout.id ? withoutMsg : m),
  }));

  // Now run with-Klonode (may benefit from some cache, but that's OK — Klonode is the product)
  const withResult = await callChat(userMessage, routedContext, 'with-klonode', repoPath, folderPaths)
    .then(r => ({ status: 'fulfilled' as const, value: r }))
    .catch(e => ({ status: 'rejected' as const, reason: e }));

  const withMsg = toMsg(withResult, loadingWith.id, 'with-klonode');

  chatStore.update(s => ({
    ...s,
    isLoading: false,
    messages: s.messages.map(m => {
      if (m.id === loadingWith.id) return withMsg;
      if (m.id === loadingWithout.id) return withoutMsg;
      return m;
    }),
    lastComparison: { withKlonode: withMsg, withoutKlonode: withoutMsg },
  }));
}

async function callChat(
  message: string,
  context: string,
  mode: 'with-klonode' | 'without-klonode',
  repoPath?: string,
  routedPaths?: string[],
  executionMode?: 'question' | 'plan' | 'bypass',
  isCO?: boolean,
): Promise<{ text: string; inputTokens: number; outputTokens: number; totalTokens: number; numTurns?: number; elapsed?: number; costUsd?: number }> {
  const settings = get(settingsStore);

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      context,
      connectionMode: settings.connectionMode,
      cliPath: settings.cliPath,
      apiKey: settings.apiKey,
      model: settings.model,
      maxTokens: settings.maxTokens,
      mode,
      repoPath,
      routedPaths,
      executionMode: executionMode || (settings.executionMode === 'auto' ? 'bypass' : settings.executionMode),
      isCO: isCO || false,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return {
    text: data.text,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    totalTokens: data.totalTokens,
    numTurns: data.numTurns,
    elapsed: data.elapsed,
    costUsd: data.costUsd,
  };
}

export function setChatMode(mode: 'chat' | 'compare'): void {
  chatStore.update(s => ({ ...s, chatMode: mode }));
}

export function clearChat(): void {
  chatStore.set({ ...initial });
}
