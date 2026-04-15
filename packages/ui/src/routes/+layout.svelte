<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { locale, t } from '$lib/stores/i18n';
  import { viewMode } from '$lib/stores/graph';
  import { graphStore, selectedNodeId } from '$lib/stores/graph';
  import { pullLatest, githubStore } from '$lib/stores/github';
  import { simulatorStore } from '$lib/stores/simulator';
  import { watchSettings, setWatchScope } from '$lib/stores/watchSettings';
  import { sessionWatcherStatus, startSessionWatcher } from '$lib/stores/sessionWatcher';
  import {
    defineComponent,
    defineComponentAction,
    defineComponentState,
  } from '$lib/workstation/registry';
  import { startWorkstationSync } from '$lib/workstation/sync';

  // Register the root layout as the parent of every pane, so the component
  // tree has a single root. See #64.
  defineComponent({
    id: 'workstation-layout',
    role: 'Top-level Workstation shell — hosts the view switcher and every pane',
    actions: {
      'set-view': { args: { mode: '"tree" | "graph" | "split" | "github"' } },
      'pull-latest': {},
      'toggle-locale': {},
    },
    state: ['view-mode', 'locale', 'has-graph', 'repo-path'],
  });

  defineComponentAction('workstation-layout', 'set-view', ({ mode }) => {
    const allowed = ['tree', 'graph', 'split', 'github'] as const;
    if (!allowed.includes(mode as any)) throw new Error(`mode must be one of ${allowed.join(', ')}`);
    viewMode.set(mode as typeof allowed[number]);
    return { ok: true };
  });
  defineComponentAction('workstation-layout', 'pull-latest', async () => {
    const repoPath = get(graphStore)?.repoPath || '';
    const result = await pullLatest(repoPath);
    return { ok: true, message: result.message };
  });
  defineComponentAction('workstation-layout', 'toggle-locale', () => {
    locale.update(l => (l === 'nb' ? 'en' : 'nb'));
    return { ok: true, now: get(locale) };
  });

  defineComponentState('workstation-layout', 'view-mode', () => get(viewMode));
  defineComponentState('workstation-layout', 'locale', () => get(locale));
  defineComponentState('workstation-layout', 'has-graph', () => get(graphStore) !== null);
  defineComponentState('workstation-layout', 'repo-path', () => get(graphStore)?.repoPath ?? null);

  // Start the browser→server snapshot sync once the layout mounts. We pass
  // every store whose value is reflected in a registered component's state
  // reader so the sync re-pushes whenever any of them changes.
  onMount(() => {
    const stopSync = startWorkstationSync([
      viewMode,
      locale,
      graphStore,
      selectedNodeId,
      githubStore,
      simulatorStore,
    ]);
    // Live node graph feed — tails Claude Code session JSONLs and feeds
    // activeNodePaths so GraphView/TreeNode pulse rings light up in real
    // time. See stores/sessionWatcher.ts and server/session-watcher.ts.
    const stopWatcher = startSessionWatcher();
    return () => {
      stopSync();
      stopWatcher();
    };
  });

  let pulling = false;
  let pullMsg = '';

  function setView(mode: 'tree' | 'graph' | 'split' | 'github') {
    viewMode.set(mode);
  }

  function toggleLocale() {
    locale.update(l => l === 'nb' ? 'en' : 'nb');
  }

  async function handlePull() {
    pulling = true;
    pullMsg = '';
    const repoPath = $graphStore?.repoPath || '';
    const result = await pullLatest(repoPath);
    pullMsg = result.message;
    pulling = false;
    setTimeout(() => { pullMsg = ''; }, 5000);
  }
</script>

<div class="app-shell">
  <nav class="top-bar">
    <div class="brand">
      <span class="logo">⟐</span>
      <span class="brand-name">Klonode</span>
      <span class="brand-sub">{$t('app.subtitle')}</span>
    </div>

    <div class="view-switcher">
      <button class:active={$viewMode === 'tree'} on:click={() => setView('tree')}>
        {$t('nav.tree')}
      </button>
      <button class:active={$viewMode === 'graph'} on:click={() => setView('graph')}>
        {$t('nav.graph')}
      </button>
      <button class:active={$viewMode === 'split'} on:click={() => setView('split')}>
        {$t('nav.split')}
      </button>
      <button class:active={$viewMode === 'github'} on:click={() => setView('github')}>
        GitHub
      </button>
    </div>

    <div class="nav-actions">
      <div
        class="watcher-status"
        class:connected={$sessionWatcherStatus.connected}
        title={`${$sessionWatcherStatus.connected ? 'Live' : 'Offline'} · ${$sessionWatcherStatus.watchedFileCount} file(s) · ${$sessionWatcherStatus.eventCount} events\n${$sessionWatcherStatus.message}`}
      >
        <span class="dot"></span>
        <span class="watcher-label">Live</span>
        <span class="watcher-count">{$sessionWatcherStatus.eventCount}</span>
      </div>
      <div class="scope-switcher" title="Watch scope for live node graph">
        <button
          class:active={$watchSettings.scope === 'project'}
          on:click={() => setWatchScope('project')}
        >Project</button>
        <button
          class:active={$watchSettings.scope === 'machine'}
          on:click={() => setWatchScope('machine')}
        >Machine</button>
      </div>
      <button class="pull-btn" on:click={handlePull} disabled={pulling} title="Git pull latest">
        {pulling ? '↻...' : '↓ Pull'}
      </button>
      {#if pullMsg}
        <span class="pull-msg" class:error={pullMsg.includes('feil') || pullMsg.includes('error')}>
          {pullMsg.slice(0, 40)}
        </span>
      {/if}
      <button on:click={toggleLocale}>
        {$locale === 'nb' ? '🇬🇧 EN' : '🇳🇴 NO'}
      </button>
    </div>
  </nav>

  <main class="content">
    <slot />
  </main>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #0a0a0f;
    color: #e5e7eb;
    overflow: hidden;
    height: 100vh;
  }
  .app-shell { display: flex; flex-direction: column; height: 100vh; }
  .top-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px; height: 48px;
    background: #0f0f14; border-bottom: 1px solid #1f1f2e; flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .logo { font-size: 20px; color: #3b82f6; }
  .brand-name { font-weight: 700; font-size: 16px; color: #f9fafb; }
  .brand-sub { font-size: 11px; color: #6b7280; }
  .view-switcher { display: flex; gap: 2px; background: #1a1a24; border-radius: 6px; padding: 2px; }
  .view-switcher button {
    padding: 5px 14px; background: transparent; border: none; border-radius: 4px;
    color: #6b7280; font-size: 12px; cursor: pointer; transition: all 0.15s;
  }
  .view-switcher button:hover { color: #e5e7eb; }
  .view-switcher button.active { background: #2d2d3d; color: #f9fafb; }
  .nav-actions { display: flex; align-items: center; gap: 6px; }
  .nav-actions button {
    padding: 4px 10px; background: #1a1a24; border: 1px solid #2d2d3d;
    border-radius: 4px; color: #9ca3af; font-size: 11px; cursor: pointer;
    transition: all 0.15s;
  }
  .nav-actions button:hover:not(:disabled) { border-color: #4a4a5a; color: #e5e7eb; }
  .pull-btn { color: #10b981 !important; border-color: rgba(16, 185, 129, 0.3) !important; }
  .pull-btn:hover:not(:disabled) { background: rgba(16, 185, 129, 0.1) !important; }
  .pull-btn:disabled { opacity: 0.5; }
  .pull-msg { font-size: 10px; color: #10b981; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pull-msg.error { color: #f87171; }

  .watcher-status {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 10px;
    background: #14141c;
    border: 1px solid #1f1f2e;
    border-radius: 4px;
    font-size: 11px; color: #6b7280;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .watcher-status .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #4b5563;
  }
  .watcher-status.connected { border-color: rgba(34, 211, 238, 0.3); color: #67e8f9; }
  .watcher-status.connected .dot {
    background: #22d3ee;
    box-shadow: 0 0 6px rgba(34, 211, 238, 0.6);
    animation: watcher-pulse 1.6s ease-in-out infinite;
  }
  .watcher-label { font-weight: 600; }
  .watcher-count { opacity: 0.7; }
  @keyframes watcher-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .scope-switcher { display: flex; gap: 2px; background: #1a1a24; border-radius: 4px; padding: 2px; }
  .scope-switcher button {
    padding: 3px 10px;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: #6b7280;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .scope-switcher button:hover { color: #e5e7eb; }
  .scope-switcher button.active { background: #2d2d3d; color: #f9fafb; }

  /* Responsive guards: at narrower widths, hide the non-essential bits of
   * the top bar so the live watcher controls stay visible. The brand
   * subtitle goes first, then the watcher "Live" text, then the pull
   * button's message. */
  @media (max-width: 1180px) {
    .brand-sub { display: none; }
  }
  @media (max-width: 1040px) {
    .watcher-label { display: none; }
    .pull-msg { display: none; }
  }

  .content { flex: 1; overflow: hidden; }
</style>
