<script lang="ts">
  import { onMount } from 'svelte';
  import { viewMode } from '$lib/stores/graph';
  import { loadGraphFromUrl } from '$lib/stores/loader';
  import TreeView from '$lib/components/TreeView/TreeView.svelte';
  import GraphView from '$lib/components/GraphView/GraphView.svelte';
  import ContextEditor from '$lib/components/Editor/ContextEditor.svelte';
  import ChatPanel from '$lib/components/ChatPanel/ChatPanel.svelte';
  import GitHubView from '$lib/components/GitHubView/GitHubView.svelte';

  let loaded = false;
  let error = '';
  let showChat = true;

  onMount(async () => {
    try {
      await loadGraphFromUrl('/demo-graph.json');
      loaded = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load graph';
    }
  });
</script>

{#if !loaded && !error}
  <div class="loading">
    <span class="loader-icon">⟐</span>
    <p>Laster rutingsgraf...</p>
  </div>
{:else if error}
  <div class="loading">
    <p class="error">Feil: {error}</p>
  </div>
{:else}
  <div
    class="main-layout"
    class:tree-only={$viewMode === 'tree'}
    class:graph-only={$viewMode === 'graph'}
    class:github-only={$viewMode === 'github'}
    class:chat-open={showChat}
  >
    <!-- Tree panel -->
    {#if $viewMode === 'tree' || $viewMode === 'split'}
      <div class="panel tree-panel">
        <TreeView />
      </div>
    {/if}

    <!-- Graph panel -->
    {#if $viewMode === 'graph' || $viewMode === 'split'}
      <div class="panel graph-panel">
        <GraphView />
      </div>
    {/if}

    <!-- GitHub panel -->
    {#if $viewMode === 'github'}
      <div class="panel github-panel">
        <GitHubView />
      </div>
    {/if}

    <!-- Editor panel (bottom, hidden in github/graph-only mode) -->
    {#if $viewMode !== 'github' && $viewMode !== 'graph'}
      <div class="panel editor-panel">
        <ContextEditor />
      </div>
    {/if}

    <!-- Chat panel (right side) -->
    {#if showChat}
      <div class="panel chat-panel">
        <ChatPanel />
      </div>
    {/if}
  </div>

  <!-- Chat toggle button -->
  <button
    class="chat-toggle"
    class:active={showChat}
    on:click={() => showChat = !showChat}
    title="{showChat ? 'Skjul' : 'Vis'} Claude chat"
  >
    {showChat ? '⟩' : '⟡ Test'}
  </button>
{/if}

<style>
  .main-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    grid-template-rows: 1fr 180px;
    height: 100%;
    min-height: 0;
    transition: grid-template-columns 0.2s ease;
  }

  /* With chat panel open: add 340px on the right */
  .main-layout.chat-open {
    grid-template-columns: 280px 1fr 340px;
  }
  .main-layout.chat-open .editor-panel {
    grid-column: 1 / 3;
  }

  .main-layout.tree-only { grid-template-columns: 1fr; grid-template-rows: 1fr 200px; }
  .main-layout.tree-only.chat-open { grid-template-columns: 1fr 340px; }

  .main-layout.graph-only { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .main-layout.graph-only .editor-panel { display: none; }
  .main-layout.graph-only.chat-open { grid-template-columns: 1fr 340px; }

  .main-layout.github-only { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .main-layout.github-only.chat-open { grid-template-columns: 1fr 340px; }

  .github-panel { grid-row: 1; grid-column: 1; overflow: hidden; min-height: 0; }

  .tree-panel { grid-row: 1; overflow: hidden; min-height: 0; border-right: 1px solid #1a1a28; }
  .graph-panel { grid-row: 1; overflow: hidden; min-height: 0; }
  .editor-panel { grid-column: 1 / -1; grid-row: 2; overflow: hidden; border-top: 1px solid #1a1a28; }
  .chat-panel { grid-column: 3; grid-row: 1 / 3; overflow: hidden; min-height: 0; }

  .panel { min-width: 0; min-height: 0; }

  /* Chat toggle button — when closed: bottom-right; when open: top of chat column */
  .chat-toggle {
    position: fixed; bottom: 16px; right: 16px;
    padding: 8px 14px;
    background: rgba(167, 139, 250, 0.15);
    border: 1px solid rgba(167, 139, 250, 0.3);
    border-radius: 20px; color: #a78bfa;
    font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all 0.2s;
    z-index: 100;
    font-family: Inter, system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .chat-toggle:hover { background: rgba(167, 139, 250, 0.25); }
  .chat-toggle.active {
    /* Move to top-right when chat is open, out of the way of send button */
    bottom: auto; top: 52px; right: 346px;
    background: rgba(167, 139, 250, 0.1);
    border-color: rgba(167, 139, 250, 0.2);
    color: #6b7280;
    border-radius: 8px 0 0 8px;
    padding: 6px 8px;
    box-shadow: none;
  }

  .loading {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; color: #6b7280; gap: 12px;
  }
  .loader-icon { font-size: 32px; color: #3b82f6; animation: pulse 1.5s infinite; }
  .error { color: #ef4444; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
