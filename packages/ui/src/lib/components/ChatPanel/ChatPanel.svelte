<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { chatStore, sendMessage, sendComparison, clearChat, setChatMode, approvePlan } from '../../stores/chat';
  import { settingsStore, updateSettings } from '../../stores/settings';
  import {
    sessionsStore, activeSession, contextDepth,
    setActiveSession, setContextDepth, addSession, removeSession,
    coContextUsage, CO_MAX_CONTEXT, closedSessionQueue,
    CONTEXT_DEPTH_LABELS,
    getCliSessionId, setCliSessionId, clearCliSessionId,
    type ContextDepth as CtxDepth,
  } from '../../stores/agents';
  import { recordActivity, clearActivity } from '../../stores/activity';
  import { graphStore } from '../../stores/graph';
  import {
    defineComponent,
    defineComponentAction,
    defineComponentState,
  } from '../../workstation/registry';

  // Register with the workstation self-introspection registry so Claude can
  // read "which session is active, how many messages, is it loading" and
  // send messages or switch sessions by name rather than by DOM coordinate.
  // See #64.
  defineComponent({
    id: 'chat-panel',
    role: 'Multi-session chat panel — active Claude CLI sessions with streaming responses and tool call activity',
    parent: 'workstation-layout',
    actions: {
      'send-message':   { args: { text: 'string', sessionId: 'string?' } },
      'new-session':    {},
      'close-session':  { args: { sessionId: 'string' } },
      'switch-session': { args: { sessionId: 'string' } },
      'clear':          {},
      'set-chat-mode':  { args: { mode: '"chat" | "compare"' } },
      'set-context-depth': { args: { depth: '"minimal" | "light" | "standard" | "heavy" | "full"' } },
    },
    state: [
      'active-session-id',
      'session-count',
      'session-labels',
      'chat-mode',
      'context-depth',
      'is-loading',
      'is-co',
      'co-context-pct',
      'pending-closed-sessions',
    ],
  });

  defineComponentAction('chat-panel', 'send-message', async ({ text }) => {
    const msg = typeof text === 'string' ? text.trim() : '';
    if (!msg) throw new Error('text is required');
    if (get(chatStore).isLoading) throw new Error('chat panel is busy');
    inputValue = msg;
    await handleSend();
    return { ok: true };
  });
  defineComponentAction('chat-panel', 'new-session', () => {
    addSession();
    return { ok: true };
  });
  defineComponentAction('chat-panel', 'close-session', ({ sessionId }) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId is required');
    if (get(sessionsStore).sessions.length <= 1) {
      throw new Error('cannot close the last session');
    }
    removeSession(sessionId);
    return { ok: true };
  });
  defineComponentAction('chat-panel', 'switch-session', ({ sessionId }) => {
    if (typeof sessionId !== 'string') throw new Error('sessionId is required');
    setActiveSession(sessionId);
    return { ok: true };
  });
  defineComponentAction('chat-panel', 'clear', () => {
    clearChat();
    return { ok: true };
  });
  defineComponentAction('chat-panel', 'set-chat-mode', ({ mode }) => {
    if (mode !== 'chat' && mode !== 'compare') throw new Error('mode must be "chat" or "compare"');
    setChatMode(mode);
    return { ok: true };
  });
  defineComponentAction('chat-panel', 'set-context-depth', ({ depth: d }) => {
    if (typeof d !== 'string') throw new Error('depth is required');
    setContextDepth(d as CtxDepth);
    return { ok: true };
  });

  defineComponentState('chat-panel', 'active-session-id', () => get(sessionsStore).activeSessionId);
  defineComponentState('chat-panel', 'session-count', () => get(sessionsStore).sessions.length);
  defineComponentState('chat-panel', 'session-labels', () =>
    get(sessionsStore).sessions.map(s => ({ id: s.id, label: s.label, isCO: s.isCO === true })),
  );
  defineComponentState('chat-panel', 'chat-mode', () => get(chatStore).chatMode);
  defineComponentState('chat-panel', 'context-depth', () => get(sessionsStore).contextDepth);
  defineComponentState('chat-panel', 'is-loading', () => get(chatStore).isLoading);
  defineComponentState('chat-panel', 'is-co', () => get(activeSession)?.isCO === true);
  defineComponentState('chat-panel', 'co-context-pct', () =>
    Math.min(100, Math.round((get(coContextUsage) / CO_MAX_CONTEXT) * 100)),
  );
  defineComponentState('chat-panel', 'pending-closed-sessions', () => get(closedSessionQueue).length);

  let inputValue = '';
  let messagesEl: HTMLDivElement;
  let showSettings = false;
  let detecting = false;
  let activityLog: { tool: string; input: string; time: Date }[] = [];
  let showActivity = true;
  let streamingText = '';
  let attachments: { name: string; type: string; dataUrl: string; file: File }[] = [];
  let fileInput: HTMLInputElement;
  let abortController: AbortController | null = null;
  // Klonode session tab ID → Claude CLI session ID is now tracked in
  // sessionsStore.cliSessionIds and persisted to localStorage, so reloads
  // and Vite server restarts preserve conversation continuity. Use
  // getCliSessionId / setCliSessionId / clearCliSessionId from the store.

  $: chatMode = $chatStore.chatMode;
  $: sessions = $sessionsStore.sessions;
  $: currentSession = $activeSession;
  $: depth = $contextDepth;
  $: isCO = currentSession?.isCO === true;
  $: contextPct = Math.min(100, Math.round(($coContextUsage / CO_MAX_CONTEXT) * 100));
  $: pendingClosedSessions = $closedSessionQueue.length;

  function handleDepthChange(key: string) {
    setContextDepth(key as CtxDepth);
  }

  function handleNewSession() {
    addSession();
  }

  function handleCloseSession(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (sessions.length > 1) removeSession(id);
  }

  async function handleSend() {
    const msg = inputValue.trim();
    if (!msg || $chatStore.isLoading) return;
    inputValue = '';
    activityLog = [];
    streamingText = '';

    if (chatMode === 'compare') {
      await sendComparison(msg);
    } else {
      // Use streaming for all sessions to get live feedback
      await sendMessageStreaming(msg);
    }
    await tick();
    scrollToBottom();
  }

  async function sendMessageStreaming(userMessage: string) {
    const settings = $settingsStore;
    if (settings.connectionMode === 'cli' && !settings.cliPath) {
      chatStore.update(s => ({ ...s, error: 'Claude CLI-sti mangler. Klikk innstillinger.' }));
      return;
    }

    // For CLI mode: use streaming endpoint for live feedback
    if (settings.connectionMode === 'cli') {
      const graph = (await import('../../stores/graph')).graphStore;
      let repoPath = '';
      graph.subscribe(g => { if (g) repoPath = g.repoPath; })();

      const userMsg = { id: Math.random().toString(36).slice(2, 10), role: 'user' as const, content: userMessage, timestamp: new Date() };
      const loadingId = Math.random().toString(36).slice(2, 10);
      const loadingMsg = { id: loadingId, role: 'assistant' as const, content: '', loading: true, timestamp: new Date() };

      chatStore.update(s => ({
        ...s, isLoading: true, error: null,
        messages: [...s.messages, userMsg, loadingMsg],
      }));

      try {
        abortController = new AbortController();
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: userMessage,
            context: '',
            cliPath: settings.cliPath,
            mode: 'with-klonode',
            repoPath,
            executionMode: isCO ? 'bypass' : (settings.executionMode === 'auto' ? 'bypass' : settings.executionMode),
            isCO,
            sessionId: getCliSessionId($sessionsStore.activeSessionId),
          }),
        });

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let resultText = '';
        let resultTokens = { input: 0, output: 0, total: 0, costUsd: 0, numTurns: 0 };

        if (reader) {
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() || '';

            for (const part of parts) {
              const eventMatch = part.match(/^event: (\w+)\ndata: (.+)$/s);
              if (!eventMatch) continue;
              const [, eventType, dataStr] = eventMatch;
              try {
                const data = JSON.parse(dataStr);
                switch (eventType) {
                  case 'session':
                    // Store CLI session ID for this tab so next message resumes the conversation
                    if (data.sessionId) {
                      setCliSessionId($sessionsStore.activeSessionId, data.sessionId);
                    }
                    break;
                  case 'tool':
                    activityLog = [...activityLog, { tool: data.tool, input: data.input, time: new Date() }];
                    // Also push to the shared activity store so tree/graph can highlight
                    recordActivity(data.tool, data.input, repoPath);
                    await tick();
                    scrollToBottom();
                    break;
                  case 'text':
                    streamingText += data.text;
                    break;
                  case 'result':
                    resultText = data.text || streamingText || '';
                    if (data.usage) {
                      resultTokens = {
                        input: (data.usage.input_tokens || 0) + (data.usage.cache_creation_input_tokens || 0) + (data.usage.cache_read_input_tokens || 0),
                        output: data.usage.output_tokens || 0,
                        total: 0,
                        costUsd: data.costUsd || 0,
                        numTurns: data.numTurns || 0,
                      };
                      resultTokens.total = resultTokens.input + resultTokens.output;
                    }
                    break;
                  case 'error':
                    resultText = `Feil: ${data.message}`;
                    break;
                }
              } catch { /* skip bad JSON */ }
            }
          }
        }

        // If no result text but we have streaming text, use that
        if (!resultText && streamingText) resultText = streamingText;
        if (!resultText) resultText = 'Claude brukte alle steg. Prov et mer spesifikt sporsmal.';

        abortController = null;
        chatStore.update(s => ({
          ...s, isLoading: false,
          messages: s.messages.map(m => m.id === loadingId ? {
            ...m, loading: false, content: resultText,
            tokens: resultTokens.total > 0 ? resultTokens : undefined,
          } : m),
        }));
        streamingText = '';

        // After CO finishes, refresh the graph so UI shows updated CONTEXT.md files
        if (isCO) {
          try {
            const refreshRes = await fetch('/api/graph/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repoPath }),
            });
            const refreshData = await refreshRes.json();
            if (refreshData.updated > 0) {
              // Reload the graph in the UI
              const { loadGraphFromUrl } = await import('../../stores/loader');
              await loadGraphFromUrl('/demo-graph.json');
              console.log(`[Klonode] Graph refreshed: ${refreshData.updated} files updated`);
            }
          } catch (e) {
            console.warn('[Klonode] Graph refresh failed:', e);
          }
        }
      } catch (err) {
        abortController = null;
        chatStore.update(s => ({
          ...s, isLoading: false,
          messages: s.messages.map(m => m.id === loadingId ? {
            ...m, loading: false, content: `Feil: ${err instanceof Error ? err.message : 'Ukjent feil'}`,
          } : m),
        }));
      }
    } else {
      // API mode: use regular sendMessage (no streaming)
      await sendMessage(userMessage);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          attachments = [...attachments, {
            name: `screenshot-${Date.now()}.png`,
            type: file.type,
            dataUrl: reader.result as string,
            file,
          }];
        };
        reader.readAsDataURL(file);
      }
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;

    for (const file of input.files) {
      const reader = new FileReader();
      reader.onload = () => {
        attachments = [...attachments, {
          name: file.name,
          type: file.type,
          dataUrl: reader.result as string,
          file,
        }];
      };
      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsDataURL(file);
      }
    }
    input.value = '';
  }

  function removeAttachment(idx: number) {
    attachments = attachments.filter((_, i) => i !== idx);
  }

  function handleRecontextualize() {
    // Start fresh CO session — clear any existing session ID so we don't resume old context
    clearCliSessionId($sessionsStore.activeSessionId);

    inputValue = `Read the entire project. Every source file, config, schema, script. Understand the full architecture, then write CONTEXT.md files for every directory.

Rules:
- Write in English
- Start each file with <!-- klonode:manual --> on the first line so they are not overwritten by the fast generator
- Include: clear summary, every file with real description, exported functions with what they do, auth requirements, dependencies, cross-references to related directories
- Root CONTEXT.md must cover: hosting/deployment, auth flow, database, storage, env vars, external services, build/run process
- Read the actual code to understand what it does. Do not guess from file names.
- Use parallel subagents for speed but do not rush — read thoroughly before writing.`;
    handleSend();
  }

  function handleStop() {
    if (abortController) {
      abortController.abort();
      abortController = null;
      chatStore.update(s => ({
        ...s, isLoading: false,
        messages: s.messages.map(m => m.loading
          ? { ...m, loading: false, content: 'Stoppet av bruker.' }
          : m),
      }));
    }
  }

  function scrollToBottom() {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  async function detectCli() {
    detecting = true;
    try {
      const res = await fetch('/api/chat');
      const data = await res.json();
      if (data.cliPath) {
        updateSettings({ cliPath: data.cliPath, connectionMode: 'cli' });
      }
    } catch { /* ignore */ }
    detecting = false;
  }

  function formatTokens(n: number): string {
    if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return `${n}`;
  }

  onMount(async () => {
    if ($settingsStore.connectionMode === 'cli' && !$settingsStore.cliPath) {
      await detectCli();
    }
  });
</script>

<div class="chat-panel">
  <!-- Header -->
  <div class="chat-header">
    <div class="chat-title">
      <span class="chat-icon">⟡</span>
      <span>Klonode Chat</span>
      {#if $chatStore.isLoading}
        <span class="stream-badge" title="A response is streaming. Editing a server-side file (api/**, .ts stores, config) right now will restart Vite and interrupt this stream. Safe to edit client components.">
          ● streaming
        </span>
      {/if}
    </div>
    <div class="chat-actions">
      {#if $chatStore.messages.length > 0}
        <button class="action-btn" on:click={clearChat} title="Tøm chat">✕</button>
      {/if}
      <button class="action-btn settings" class:active={showSettings} on:click={() => showSettings = !showSettings} title="Innstillinger">
        ⚙
      </button>
    </div>
  </div>

  <!-- Mode toggle -->
  <div class="mode-bar">
    <button class="chat-mode-btn" class:active={chatMode === 'chat'} on:click={() => setChatMode('chat')}>
      Chat
    </button>
    <button class="chat-mode-btn" class:active={chatMode === 'compare'} on:click={() => setChatMode('compare')}>
      Sammenlign tokens
    </button>
  </div>

  <!-- Session tabs -->
  <div class="session-tabs">
    {#each sessions as session (session.id)}
      <button
        class="session-tab"
        class:active={session.id === $sessionsStore.activeSessionId}
        class:co-tab={session.isCO}
        on:click={() => setActiveSession(session.id)}
        title={session.isCO ? 'Chief Organizer — prosjektoversikt og forbedring' : session.label}
      >
        <span class="session-label">{session.label}</span>
        {#if !session.isCO && sessions.length > 2}
          <span class="session-close" on:click={(e) => handleCloseSession(session.id, e)}>x</span>
        {/if}
      </button>
    {/each}
    <button class="session-add" on:click={handleNewSession} title="Ny chat-sesjon">+</button>
  </div>

  <!-- Context depth is automatic — no manual selector -->

  <!-- CO status bar (only visible when CO tab is active) -->
  {#if isCO}
    <div class="co-bar">
      <div class="co-context">
        <span class="co-context-label">Kontekst</span>
        <div class="co-context-track">
          <div
            class="co-context-fill"
            class:warn={contextPct > 60}
            class:danger={contextPct > 85}
            style="width: {contextPct}%"
          />
        </div>
        <span class="co-context-pct">{contextPct}%</span>
      </div>
      <button class="co-action-btn destructive" on:click={handleRecontextualize} disabled={$chatStore.isLoading} title="Les hele prosjektet og skriv nye CONTEXT.md filer">
        Rekontekstualiser
      </button>
      <button class="co-action-btn" on:click={() => { /* TODO: compact */ }} title="Komprimer samtalen">
        Kompakt
      </button>
      {#if pendingClosedSessions > 0}
        <span class="co-pending">{pendingClosedSessions} lukkede chats</span>
      {/if}
    </div>
  {/if}

  <!-- Settings panel -->
  {#if showSettings}
    <div class="settings-panel">
      <div class="settings-title">Claude-tilkobling</div>

      <div class="setting-row">
        <label class="setting-label">Modus</label>
        <div class="mode-toggle">
          <button
            class="mode-btn"
            class:active={$settingsStore.connectionMode === 'cli'}
            on:click={() => updateSettings({ connectionMode: 'cli' })}
          >CLI</button>
          <button
            class="mode-btn"
            class:active={$settingsStore.connectionMode === 'api'}
            on:click={() => updateSettings({ connectionMode: 'api' })}
          >API-nøkkel</button>
        </div>
      </div>

      {#if $settingsStore.connectionMode === 'cli'}
        <div class="setting-row">
          <label class="setting-label">CLI-sti</label>
          <div class="cli-input-row">
            <input
              type="text"
              class="setting-input"
              placeholder="C:\...\claude.exe"
              value={$settingsStore.cliPath}
              on:input={e => updateSettings({ cliPath: e.currentTarget.value })}
            />
            <button class="detect-btn" on:click={detectCli} disabled={detecting}>
              {detecting ? '...' : 'Finn'}
            </button>
          </div>
          {#if $settingsStore.cliPath}
            <div class="setting-hint ok">✓ {$settingsStore.cliPath.split('\\').pop()}</div>
          {:else}
            <div class="setting-hint warn">Klikk «Finn» for auto-deteksjon</div>
          {/if}
        </div>
      {:else}
        <div class="setting-row">
          <label class="setting-label">API-nøkkel</label>
          <input
            type="password"
            class="setting-input"
            placeholder="sk-ant-..."
            value={$settingsStore.apiKey}
            on:input={e => updateSettings({ apiKey: e.currentTarget.value })}
          />
          <div class="setting-hint">Hent nøkkel fra console.anthropic.com</div>
        </div>
      {/if}

      <div class="setting-row">
        <label class="setting-label">Modell</label>
        <select
          class="setting-input"
          value={$settingsStore.model}
          on:change={e => updateSettings({ model: e.currentTarget.value })}
        >
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (anbefalt)</option>
          <option value="claude-opus-4-20250514">Claude Opus 4 (kraftigst)</option>
          <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
          <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (raskest)</option>
        </select>
      </div>

      <div class="setting-row">
        <label class="setting-label">Utføringsmodus</label>
        <div class="exec-modes">
          <button
            class="exec-mode-btn"
            class:active={$settingsStore.executionMode === 'auto'}
            on:click={() => updateSettings({ executionMode: 'auto' })}
            title="Automatisk — velger riktig modus basert på spørsmålet"
          >Auto</button>
          <button
            class="exec-mode-btn"
            class:active={$settingsStore.executionMode === 'question'}
            on:click={() => updateSettings({ executionMode: 'question' })}
            title="Spørsmål — bare kontekst, ingen verktøy"
          >Spørsmål</button>
          <button
            class="exec-mode-btn"
            class:active={$settingsStore.executionMode === 'plan'}
            on:click={() => updateSettings({ executionMode: 'plan' })}
            title="Plan — leser kode, lager plan, du godkjenner"
          >Plan</button>
          <button
            class="exec-mode-btn"
            class:active={$settingsStore.executionMode === 'bypass'}
            on:click={() => updateSettings({ executionMode: 'bypass' })}
            title="Direkte — full tilgang til å lese og skrive"
          >Direkte</button>
        </div>
        <div class="setting-hint">
          {#if $settingsStore.executionMode === 'auto'}
            Velger automatisk mellom spørsmål, plan og direkte
          {:else if $settingsStore.executionMode === 'question'}
            Bare kontekst — rask, billig, ingen fillesing
          {:else if $settingsStore.executionMode === 'plan'}
            Leser kode → lager plan → du godkjenner → utfører
          {:else}
            Full tilgang — leser og skriver filer direkte
          {/if}
        </div>
      </div>

      <button class="settings-close" on:click={() => showSettings = false}>Ferdig</button>
    </div>
  {/if}

  <!-- Messages area -->
  <div class="messages" bind:this={messagesEl}>
    {#if $chatStore.messages.length === 0}
      <div class="empty-chat">
        <div class="empty-icon">⟡</div>
        {#if chatMode === 'chat'}
          <div class="empty-title">Chat med kodebasen din</div>
          <div class="empty-sub">
            Klonode ruter automatisk til riktig kontekst. Bare skriv hva du trenger.
          </div>
        {:else}
          <div class="empty-title">Sammenlign med og uten Klonode</div>
          <div class="empty-sub">
            Still et spørsmål — du ser svaret fra begge varianter med faktisk token-bruk.
          </div>
        {/if}
        <div class="example-queries">
          <button class="example-btn" on:click={() => { inputValue = 'Fix the game physics'; }}>Fix the game physics</button>
          <button class="example-btn" on:click={() => { inputValue = 'Legg til login-side'; }}>Legg til login-side</button>
          <button class="example-btn" on:click={() => { inputValue = 'Hva gjør API-et?'; }}>Hva gjør API-et?</button>
        </div>
      </div>
    {:else}
      {#each $chatStore.messages as msg (msg.id)}
        {#if msg.role === 'user'}
          <div class="message user-message">
            <div class="user-bubble">{msg.content}</div>
          </div>
        {:else if msg.role === 'assistant'}
          <div class="message assistant-message"
            class:mode-with={msg.mode === 'with-klonode'}
            class:mode-without={msg.mode === 'without-klonode'}
          >
            <!-- Label for compare mode -->
            {#if msg.mode}
              <div class="assistant-label">
                {#if msg.mode === 'with-klonode'}
                  <span class="label-with">⟐ Med Klonode</span>
                {:else}
                  <span class="label-without">⊟ Uten Klonode</span>
                {/if}
                {#if msg.tokens}
                  <span class="token-badge" class:badge-with={msg.mode === 'with-klonode'} class:badge-without={msg.mode === 'without-klonode'}>
                    {formatTokens(msg.tokens.input)} inn · {formatTokens(msg.tokens.output)} ut
                  </span>
                {/if}
              </div>
            {/if}

            {#if msg.loading}
              <!-- Routing info -->
              {#if msg.routedFiles && msg.routedFiles.length > 0}
                <div class="work-meta">Rutet {msg.routedFiles.length} filer</div>
              {/if}

              <!-- Inline activity stream — every tool call shown as its own line -->
              {#each activityLog as entry}
                <div class="work-tool">
                  <span class="work-tool-name">{entry.tool}</span>
                  <span class="work-tool-input">{entry.input}</span>
                </div>
              {/each}

              <!-- Live streaming text — full, not truncated -->
              {#if streamingText}
                <div class="work-text">{streamingText}</div>
              {/if}

              <!-- Thinking indicator (only when no activity yet) -->
              {#if activityLog.length === 0 && !streamingText}
                <div class="work-thinking">
                  <span></span><span></span><span></span>
                  <span class="work-thinking-label">tenker</span>
                </div>
              {/if}
            {:else}
              {#if msg.interrupted}
                <div class="interrupted-banner" title="This response was cut off when the app reloaded — usually because you edited a server-side file and Vite restarted.">
                  ⚠ response interrupted by reload
                </div>
              {/if}
              <div class="assistant-content">{msg.content}</div>
              <!-- Plan approval button -->
              {#if msg.isPlan}
                <div class="plan-actions">
                  <button class="approve-btn" on:click={() => approvePlan(msg.id)} disabled={$chatStore.isLoading}>
                    Godkjenn og utfør
                  </button>
                  <span class="plan-hint">Les planen og klikk for å utføre med full tilgang</span>
                </div>
              {/if}
              <!-- Routed files indicator for normal chat mode -->
              {#if !msg.mode && msg.routedFiles && msg.routedFiles.length > 0}
                <div class="routed-info">
                  <span class="routed-label">⟐ {msg.routedFiles.length} filer rutet</span>
                  {#if msg.tokens}
                    <span class="routed-tokens">{formatTokens(msg.tokens.input)} inn · {formatTokens(msg.tokens.output)} ut</span>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      {/each}

      <!-- Comparison summary -->
      {#if $chatStore.lastComparison?.withKlonode?.tokens && $chatStore.lastComparison?.withoutKlonode?.tokens}
        {@const w = $chatStore.lastComparison.withKlonode.tokens}
        {@const wo = $chatStore.lastComparison.withoutKlonode.tokens}
        {@const wCost = w.costUsd || 0}
        {@const woCost = wo.costUsd || 0}
        {@const savedCost = woCost - wCost}
        {@const pctCost = woCost > 0 ? Math.round((savedCost / woCost) * 100) : 0}
        {@const wTime = Math.round((w.elapsed || 0) / 1000)}
        {@const woTime = Math.round((wo.elapsed || 0) / 1000)}
        {@const savedTime = woTime - wTime}
        {@const pctTime = woTime > 0 ? Math.round((savedTime / woTime) * 100) : 0}
        <div class="savings-banner" class:savings-positive={savedCost > 0} class:savings-negative={savedCost <= 0}>
          {#if savedCost > 0}
            <span class="savings-headline">{pctCost}% billigere med Klonode</span>
          {:else}
            <span class="savings-headline neutral">Likt resultat</span>
          {/if}
          <div class="savings-grid">
            <div class="savings-item">
              <span class="savings-num">${wCost.toFixed(2)}</span>
              <span class="savings-label">Klonode</span>
            </div>
            <div class="savings-item">
              <span class="savings-num dim">${woCost.toFixed(2)}</span>
              <span class="savings-label">Vanlig</span>
            </div>
            <div class="savings-item">
              <span class="savings-num" class:positive={savedCost > 0}>{savedCost > 0 ? '-' : '+'}{Math.abs(savedCost).toFixed(2)}</span>
              <span class="savings-label">Spart</span>
            </div>
          </div>
          <div class="savings-meta">
            <span>{w.numTurns || '?'} vs {wo.numTurns || '?'} steg</span>
            <span>·</span>
            <span>{wTime}s vs {woTime}s</span>
            {#if pctTime > 0}
              <span>·</span>
              <span>{pctTime}% raskere</span>
            {/if}
          </div>
        </div>
      {/if}
    {/if}

    {#if $chatStore.error}
      <div class="error-banner">
        <span class="error-icon">⚠</span>
        {$chatStore.error}
        <button class="error-settings" on:click={() => showSettings = true}>Innstillinger</button>
      </div>
    {/if}
  </div>

  <!-- Input area -->
  <div class="chat-input-area">
    <!-- Attachment previews -->
    {#if attachments.length > 0}
      <div class="attachments-bar">
        {#each attachments as att, i}
          <div class="attachment-preview">
            {#if att.type.startsWith('image/')}
              <img src={att.dataUrl} alt={att.name} class="attachment-thumb" />
            {:else}
              <span class="attachment-file-icon">F</span>
            {/if}
            <span class="attachment-name">{att.name}</span>
            <button class="attachment-remove" on:click={() => removeAttachment(i)}>x</button>
          </div>
        {/each}
      </div>
    {/if}
    <div class="input-row">
      <button class="attach-btn" on:click={() => fileInput.click()} title="Legg til fil eller bilde" disabled={$chatStore.isLoading}>
        +
      </button>
      <input
        type="file"
        bind:this={fileInput}
        on:change={handleFileSelect}
        multiple
        accept="image/*,.txt,.ts,.tsx,.js,.jsx,.json,.md,.py,.css,.html,.prisma,.sql,.yml,.yaml,.toml,.env,.sh"
        style="display: none"
      />
      <textarea
        class="chat-input"
        bind:value={inputValue}
        on:keydown={handleKeydown}
        on:paste={handlePaste}
        placeholder={chatMode === 'compare' ? 'Sammenlign... (Enter)' : 'Skriv eller lim inn bilde... (Enter)'}
        rows="2"
        disabled={$chatStore.isLoading}
      ></textarea>
      {#if $chatStore.isLoading}
        <button class="stop-btn" on:click={handleStop} title="Stopp">
          Stop
        </button>
      {:else}
        <button
          class="send-btn"
          on:click={handleSend}
          disabled={!inputValue.trim() && attachments.length === 0}
        >
          ->
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .chat-panel {
    display: flex; flex-direction: column; height: 100%;
    background: #07070c; color: #e5e7eb;
    font-family: Inter, system-ui, sans-serif;
    border-left: 1px solid #1a1a28;
  }

  /* Header */
  .chat-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; border-bottom: 1px solid #1a1a28;
    background: rgba(10, 10, 18, 0.98); flex-shrink: 0;
  }
  .chat-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 700; color: #e5e7eb;
  }
  .chat-icon { color: #a78bfa; font-size: 16px; }
  .stream-badge {
    font-size: 10px; padding: 2px 8px; border-radius: 10px;
    background: rgba(245, 158, 11, 0.12);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.3);
    font-weight: 600;
    cursor: help;
    animation: stream-pulse 1.8s ease-in-out infinite;
  }
  @keyframes stream-pulse {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
  }
  .interrupted-banner {
    font-size: 10px; padding: 4px 8px; border-radius: 6px;
    background: rgba(245, 158, 11, 0.1);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.25);
    margin-bottom: 6px;
    font-weight: 600;
    cursor: help;
  }
  .chat-actions { display: flex; gap: 4px; }
  .action-btn {
    width: 26px; height: 26px; border: none;
    background: transparent; color: #6b7280;
    cursor: pointer; border-radius: 6px;
    font-size: 14px; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .action-btn:hover { background: #1a1a28; color: #e5e7eb; }
  .action-btn.settings { font-size: 16px; }
  .action-btn.settings.active { color: #a78bfa; background: rgba(167, 139, 250, 0.1); }

  /* Mode bar */
  .mode-bar {
    display: flex; border-bottom: 1px solid #1a1a28;
    flex-shrink: 0; background: rgba(10, 10, 18, 0.8);
  }
  .chat-mode-btn {
    flex: 1; padding: 6px 0; border: none;
    background: transparent; color: #6b7280;
    font-size: 11px; font-weight: 600; cursor: pointer;
    transition: all 0.15s; border-bottom: 2px solid transparent;
  }
  .chat-mode-btn:hover { color: #9ca3af; }
  .chat-mode-btn.active {
    color: #a78bfa; border-bottom-color: #a78bfa;
  }

  /* Settings panel */
  .settings-panel {
    padding: 12px; border-bottom: 1px solid #1a1a28;
    background: rgba(15, 15, 25, 0.98); flex-shrink: 0;
  }
  .settings-title {
    font-size: 10px; font-weight: 700; color: #6b7280;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;
  }
  .setting-row { margin-bottom: 10px; }
  .setting-label {
    display: block; font-size: 10px; color: #9ca3af;
    font-weight: 600; margin-bottom: 4px;
  }
  .setting-input {
    width: 100%; background: #12121c; border: 1px solid #2a2a3a;
    border-radius: 6px; color: #e5e7eb; font-size: 11px;
    padding: 6px 8px; box-sizing: border-box;
    font-family: 'JetBrains Mono', monospace;
  }
  .setting-input:focus { outline: none; border-color: #a78bfa; }
  .setting-hint {
    font-size: 9px; color: #6b7280; margin-top: 3px;
  }
  .setting-hint.ok { color: #10b981; }
  .setting-hint.warn { color: #f59e0b; }
  .cli-input-row { display: flex; gap: 6px; }
  .cli-input-row .setting-input { flex: 1; }
  .detect-btn {
    padding: 5px 10px; background: #1a1a28; border: 1px solid #2a2a3a;
    border-radius: 6px; color: #9ca3af; font-size: 11px; cursor: pointer;
    white-space: nowrap; transition: all 0.15s;
  }
  .detect-btn:hover:not(:disabled) { border-color: #a78bfa; color: #a78bfa; }
  .detect-btn:disabled { opacity: 0.4; }
  .mode-toggle { display: flex; gap: 4px; }
  .mode-btn {
    flex: 1; padding: 5px 0; background: #12121c;
    border: 1px solid #2a2a3a; border-radius: 6px;
    color: #6b7280; font-size: 11px; cursor: pointer;
    transition: all 0.15s; font-weight: 600;
  }
  .mode-btn:hover { border-color: #3a3a4a; color: #9ca3af; }
  .mode-btn.active { background: rgba(167, 139, 250, 0.12); border-color: #a78bfa; color: #a78bfa; }

  .exec-modes { display: flex; gap: 3px; }
  .exec-mode-btn {
    flex: 1; padding: 4px 2px; background: #12121c;
    border: 1px solid #2a2a3a; border-radius: 5px;
    color: #6b7280; font-size: 10px; cursor: pointer;
    transition: all 0.15s; font-weight: 600;
  }
  .exec-mode-btn:hover { border-color: #3a3a4a; color: #9ca3af; }
  .exec-mode-btn.active { background: rgba(167, 139, 250, 0.12); border-color: #a78bfa; color: #a78bfa; }
  .settings-close {
    width: 100%; padding: 6px; margin-top: 4px;
    background: rgba(167, 139, 250, 0.1); border: 1px solid rgba(167, 139, 250, 0.3);
    border-radius: 6px; color: #a78bfa; font-size: 11px; cursor: pointer;
    font-weight: 600; transition: all 0.15s;
  }
  .settings-close:hover { background: rgba(167, 139, 250, 0.2); }

  /* Session tabs */
  .session-tabs {
    display: flex; gap: 2px; padding: 4px 6px;
    border-bottom: 1px solid #1a1a28;
    background: rgba(10, 10, 18, 0.6);
    overflow-x: auto; flex-shrink: 0;
    align-items: center;
  }
  .session-tab {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 8px; background: transparent; border: none;
    border-radius: 4px; color: #6b7280; font-size: 10px;
    cursor: pointer; transition: all 0.15s; white-space: nowrap;
    font-weight: 600; max-width: 140px;
  }
  .session-tab:hover { background: #1a1a28; color: #9ca3af; }
  .session-tab.active {
    background: rgba(167, 139, 250, 0.12);
    color: #a78bfa;
    border-bottom: 2px solid #a78bfa;
  }
  .session-tab.co-tab {
    color: #10b981; border-right: 1px solid #1a1a28; margin-right: 2px;
  }
  .session-tab.co-tab.active {
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
    border-bottom-color: #10b981;
  }
  .session-label {
    font-size: 10px; overflow: hidden; text-overflow: ellipsis;
  }
  .session-close {
    font-size: 9px; color: #4b5563; cursor: pointer;
    padding: 0 2px; border-radius: 2px; line-height: 1;
  }
  .session-close:hover { color: #f87171; background: rgba(239, 68, 68, 0.15); }
  .session-add {
    width: 22px; height: 22px; border: 1px dashed #2a2a3a;
    background: transparent; border-radius: 4px;
    color: #4b5563; font-size: 14px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0;
  }
  .session-add:hover { border-color: #a78bfa; color: #a78bfa; }

  /* CO status bar */
  .co-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 8px; border-bottom: 1px solid #1a1a28;
    background: rgba(16, 185, 129, 0.04); flex-shrink: 0;
  }
  .co-context {
    display: flex; align-items: center; gap: 6px; flex: 1;
  }
  .co-context-label { font-size: 9px; color: #6b7280; font-weight: 600; white-space: nowrap; }
  .co-context-track {
    flex: 1; height: 4px; background: #1a1a28; border-radius: 2px; overflow: hidden;
  }
  .co-context-fill {
    height: 100%; background: #10b981; border-radius: 2px;
    transition: width 0.3s ease;
  }
  .co-context-fill.warn { background: #f59e0b; }
  .co-context-fill.danger { background: #ef4444; }
  .co-context-pct {
    font-size: 9px; color: #6b7280; font-family: 'JetBrains Mono', monospace;
    min-width: 28px; text-align: right;
  }
  .co-action-btn {
    padding: 2px 8px; background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 4px;
    color: #10b981; font-size: 9px; font-weight: 600;
    cursor: pointer; transition: all 0.15s; white-space: nowrap;
  }
  .co-action-btn:hover:not(:disabled) { background: rgba(16, 185, 129, 0.2); }
  .co-action-btn:disabled { opacity: 0.4; cursor: default; }
  .co-action-btn.destructive {
    background: rgba(167, 139, 250, 0.1);
    border-color: rgba(167, 139, 250, 0.25);
    color: #a78bfa;
  }
  .co-action-btn.destructive:hover:not(:disabled) { background: rgba(167, 139, 250, 0.2); }
  .co-pending {
    font-size: 9px; color: #f59e0b; font-weight: 600; white-space: nowrap;
  }

  /* Context depth bar */
  .depth-bar {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 8px; border-bottom: 1px solid #1a1a28;
    background: rgba(10, 10, 18, 0.4); flex-shrink: 0;
  }
  .depth-label { font-size: 9px; color: #6b7280; font-weight: 600; white-space: nowrap; }
  .depth-options { display: flex; gap: 2px; flex: 1; }
  .depth-btn {
    display: flex; align-items: center; gap: 2px;
    padding: 2px 6px; background: transparent; border: none;
    border-radius: 3px; color: #4b5563; font-size: 9px;
    cursor: pointer; transition: all 0.15s;
  }
  .depth-btn:hover { background: #1a1a28; color: #9ca3af; }
  .depth-btn.active {
    background: rgba(167, 139, 250, 0.12); color: #a78bfa;
  }
  .depth-icon { font-size: 10px; }
  .depth-name { font-size: 9px; font-weight: 600; }

  /* Messages */
  .messages {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 8px;
  }

  .empty-chat {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%;
    text-align: center; gap: 8px; color: #6b7280;
  }
  .empty-icon { font-size: 32px; color: #a78bfa; opacity: 0.5; }
  .empty-title { font-size: 13px; font-weight: 600; color: #9ca3af; }
  .empty-sub { font-size: 11px; color: #6b7280; max-width: 260px; line-height: 1.5; }
  .example-queries { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; width: 100%; }
  .example-btn {
    padding: 6px 12px; background: rgba(167, 139, 250, 0.06);
    border: 1px solid rgba(167, 139, 250, 0.15);
    border-radius: 6px; color: #a78bfa; font-size: 11px;
    cursor: pointer; transition: all 0.15s;
  }
  .example-btn:hover { background: rgba(167, 139, 250, 0.12); }

  .message { display: flex; flex-direction: column; }

  .user-message { align-items: flex-end; }
  .user-bubble {
    background: rgba(167, 139, 250, 0.12);
    border: 1px solid rgba(167, 139, 250, 0.2);
    border-radius: 10px 10px 2px 10px;
    padding: 8px 12px; font-size: 12px; color: #e5e7eb;
    max-width: 85%; line-height: 1.5;
  }

  .assistant-message {
    border-radius: 8px; padding: 10px 12px;
    border: 1px solid #1a1a28;
    background: rgba(15, 15, 25, 0.5);
  }
  .assistant-message.mode-with {
    background: rgba(34, 211, 238, 0.04);
    border-color: rgba(34, 211, 238, 0.12);
  }
  .assistant-message.mode-without {
    background: rgba(239, 68, 68, 0.04);
    border-color: rgba(239, 68, 68, 0.1);
  }

  .assistant-label {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 6px; gap: 8px;
  }
  .label-with { font-size: 10px; font-weight: 700; color: #22d3ee; }
  .label-without { font-size: 10px; font-weight: 700; color: #f87171; }
  .token-badge {
    font-size: 9px; padding: 1px 6px; border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
  }
  .token-badge.badge-with { background: rgba(34, 211, 238, 0.1); color: #22d3ee; }
  .token-badge.badge-without { background: rgba(239, 68, 68, 0.1); color: #f87171; }

  .assistant-content {
    font-size: 12px; color: #d1d5db; line-height: 1.6;
    white-space: pre-wrap; word-break: break-word;
  }

  /* Routed files info (normal chat mode) */
  .routed-info {
    display: flex; align-items: center; gap: 8px;
    margin-top: 8px; padding-top: 6px;
    border-top: 1px solid rgba(167, 139, 250, 0.1);
  }
  .routed-label {
    font-size: 9px; color: #a78bfa; font-weight: 600;
  }
  .routed-tokens {
    font-size: 9px; color: #6b7280;
    font-family: 'JetBrains Mono', monospace;
  }

  .loading-row {
    display: flex; align-items: center; gap: 8px;
  }
  .loading-dots {
    display: flex; gap: 4px; padding: 4px 0;
  }
  .loading-dots span {
    width: 6px; height: 6px; border-radius: 50%;
    background: #6b7280; animation: dot-pulse 1.2s infinite;
  }
  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
  .routing-hint {
    font-size: 10px; color: #6b7280; font-style: italic;
  }
  @keyframes dot-pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }

  /* Work stream — Claude Code style */
  .work-meta {
    font-size: 10px; color: #6b7280; font-style: italic;
    margin-bottom: 4px;
  }
  .work-tool {
    display: flex; gap: 6px; align-items: baseline;
    font-size: 11px; font-family: 'JetBrains Mono', monospace;
    padding: 1px 0; line-height: 1.5;
    animation: work-slide-in 0.2s ease;
  }
  .work-tool-name {
    color: #a78bfa; font-weight: 700;
    white-space: nowrap; flex-shrink: 0;
  }
  .work-tool-input {
    color: #9ca3af; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; min-width: 0;
  }
  .work-text {
    font-size: 12px; color: #d1d5db;
    line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    margin-top: 8px; padding-top: 8px;
    border-top: 1px solid rgba(167, 139, 250, 0.1);
  }
  .work-thinking {
    display: flex; gap: 4px; align-items: center;
    padding: 4px 0;
  }
  .work-thinking span:not(.work-thinking-label) {
    width: 5px; height: 5px; border-radius: 50%;
    background: #6b7280; animation: dot-pulse 1.2s infinite;
  }
  .work-thinking span:nth-child(2) { animation-delay: 0.2s; }
  .work-thinking span:nth-child(3) { animation-delay: 0.4s; }
  .work-thinking-label {
    font-size: 10px; color: #6b7280; font-style: italic;
    margin-left: 4px;
  }
  @keyframes work-slide-in {
    from { opacity: 0; transform: translateX(-4px); }
    to { opacity: 1; transform: translateX(0); }
  }

  /* Savings banner */
  .savings-banner {
    display: flex; flex-direction: column; align-items: center;
    padding: 12px; gap: 8px;
    background: linear-gradient(135deg, rgba(34, 211, 238, 0.06), rgba(16, 185, 129, 0.06));
    border: 1px solid rgba(34, 211, 238, 0.15);
    border-radius: 8px; text-align: center;
  }
  .savings-banner.savings-positive {
    background: linear-gradient(135deg, rgba(34, 211, 238, 0.1), rgba(16, 185, 129, 0.1));
    border-color: rgba(16, 185, 129, 0.3);
  }
  .savings-banner.savings-negative {
    background: rgba(239, 68, 68, 0.05);
    border-color: rgba(239, 68, 68, 0.15);
  }
  .savings-headline {
    font-size: 16px; font-weight: 800; color: #10b981;
    font-family: 'JetBrains Mono', monospace;
  }
  .savings-headline.neutral { color: #6b7280; font-size: 13px; }
  .savings-grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;
    width: 100%;
  }
  .savings-item {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
  }
  .savings-num {
    font-size: 14px; font-weight: 800; color: #e5e7eb;
    font-family: 'JetBrains Mono', monospace;
  }
  .savings-num.dim { color: #6b7280; }
  .savings-num.positive { color: #10b981; }
  .savings-label {
    font-size: 9px; color: #6b7280; text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .savings-meta {
    display: flex; gap: 6px; align-items: center;
    font-size: 10px; color: #6b7280;
    font-family: 'JetBrains Mono', monospace;
  }

  /* Error */
  .error-banner {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 8px; font-size: 11px; color: #f87171;
  }
  .error-icon { font-size: 14px; }
  .error-settings {
    margin-left: auto; padding: 3px 8px;
    background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px; color: #f87171; font-size: 10px; cursor: pointer;
  }

  /* Input */
  .chat-input-area {
    display: flex; flex-direction: column; gap: 0;
    padding: 8px 12px; border-top: 1px solid #1a1a28;
    flex-shrink: 0; background: rgba(10, 10, 18, 0.98);
  }
  .input-row {
    display: flex; gap: 6px; align-items: flex-end;
  }
  .chat-input {
    flex: 1; background: #12121c; border: 1px solid #2a2a3a;
    border-radius: 8px; color: #e5e7eb; font-size: 12px;
    padding: 8px 10px; resize: none; outline: none;
    font-family: Inter, system-ui, sans-serif;
    line-height: 1.5;
  }
  .chat-input:focus { border-color: #a78bfa; }
  .chat-input::placeholder { color: #4b5563; }
  .chat-input:disabled { opacity: 0.5; }
  .attach-btn {
    width: 32px; height: 32px; flex-shrink: 0;
    background: transparent; border: 1px dashed #2a2a3a;
    border-radius: 6px; color: #4b5563; font-size: 16px;
    cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; justify-content: center;
  }
  .attach-btn:hover:not(:disabled) { border-color: #a78bfa; color: #a78bfa; }
  .attach-btn:disabled { opacity: 0.3; }
  .send-btn {
    width: 36px; height: 36px; flex-shrink: 0;
    background: rgba(167, 139, 250, 0.15);
    border: 1px solid rgba(167, 139, 250, 0.3);
    border-radius: 8px; color: #a78bfa;
    font-size: 12px; cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700;
  }
  .send-btn:hover:not(:disabled) { background: rgba(167, 139, 250, 0.25); }
  .send-btn:disabled { opacity: 0.3; cursor: default; }
  .stop-btn {
    width: 36px; height: 36px; flex-shrink: 0;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 8px; color: #f87171;
    font-size: 9px; font-weight: 700; cursor: pointer;
    transition: all 0.15s;
    display: flex; align-items: center; justify-content: center;
  }
  .stop-btn:hover { background: rgba(239, 68, 68, 0.3); }

  /* Attachments */
  .attachments-bar {
    display: flex; gap: 6px; padding: 6px 0; overflow-x: auto;
    flex-wrap: wrap;
  }
  .attachment-preview {
    display: flex; align-items: center; gap: 4px;
    padding: 3px 6px; background: #12121c;
    border: 1px solid #2a2a3a; border-radius: 6px;
    font-size: 10px; color: #9ca3af;
  }
  .attachment-thumb {
    width: 28px; height: 28px; border-radius: 4px;
    object-fit: cover;
  }
  .attachment-file-icon {
    width: 20px; height: 20px; background: rgba(167, 139, 250, 0.1);
    border-radius: 3px; display: flex; align-items: center; justify-content: center;
    font-size: 9px; color: #a78bfa; font-weight: 700;
  }
  .attachment-name {
    max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 9px;
  }
  .attachment-remove {
    background: none; border: none; color: #4b5563; cursor: pointer;
    font-size: 10px; padding: 0 2px; line-height: 1;
  }
  .attachment-remove:hover { color: #f87171; }

  /* Plan actions */
  .plan-actions {
    display: flex; flex-direction: column; gap: 6px;
    margin-top: 10px; padding-top: 8px;
    border-top: 1px solid rgba(16, 185, 129, 0.2);
  }
  .approve-btn {
    padding: 8px 16px; background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.4);
    border-radius: 8px; color: #10b981; font-size: 12px;
    font-weight: 700; cursor: pointer; transition: all 0.15s;
  }
  .approve-btn:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.25);
    border-color: rgba(16, 185, 129, 0.6);
  }
  .approve-btn:disabled { opacity: 0.4; cursor: default; }
  .plan-hint {
    font-size: 9px; color: #6b7280; text-align: center;
  }
</style>
