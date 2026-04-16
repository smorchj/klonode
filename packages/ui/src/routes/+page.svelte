<script lang="ts">
  import { onMount } from 'svelte';
  import { viewMode } from '$lib/stores/graph';
  import { loadGraphForCurrentProject } from '$lib/stores/loader';
  import TreeView from '$lib/components/TreeView/TreeView.svelte';
  import GraphView from '$lib/components/GraphView/GraphView.svelte';
  import ContextEditor from '$lib/components/Editor/ContextEditor.svelte';
  import GitHubView from '$lib/components/GitHubView/GitHubView.svelte';
  import SuggestionsPanel from '$lib/components/SuggestionsPanel/SuggestionsPanel.svelte';

  let loaded = false;
  let error = '';
  let showSuggestions = true;
  let graphSource: 'real' | 'demo' | null = null;

  onMount(async () => {
    try {
      // Prefer the graph for the project the server is running in. Falls
      // back to the bundled demo fixture only if no .klonode/graph.json
      // exists for the server's cwd.
      graphSource = await loadGraphForCurrentProject();
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
    class:suggestions-open={showSuggestions}
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

    <!-- Suggestions panel (right side) -->
    {#if showSuggestions}
      <div class="panel suggestions-panel">
        <SuggestionsPanel />
      </div>
    {/if}
  </div>

  <!-- Suggestions toggle -->
  <button
    class="suggestions-toggle"
    class:active={showSuggestions}
    on:click={() => showSuggestions = !showSuggestions}
    title="{showSuggestions ? 'Hide' : 'Show'} suggestions"
  >
    {showSuggestions ? '>' : 'Suggestions'}
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

  .main-layout.suggestions-open {
    grid-template-columns: 280px 1fr 300px;
  }
  .main-layout.suggestions-open .editor-panel {
    grid-column: 1 / 3;
  }

  .main-layout.tree-only { grid-template-columns: 1fr; grid-template-rows: 1fr 200px; }
  .main-layout.tree-only.suggestions-open { grid-template-columns: 1fr 300px; }

  .main-layout.graph-only { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .main-layout.graph-only .editor-panel { display: none; }
  .main-layout.graph-only.suggestions-open { grid-template-columns: 1fr 300px; }

  .main-layout.github-only { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .main-layout.github-only.suggestions-open { grid-template-columns: 1fr 300px; }

  .github-panel { grid-row: 1; grid-column: 1; overflow: hidden; min-height: 0; }

  .tree-panel { grid-row: 1; overflow: hidden; min-height: 0; border-right: 1px solid #1a1a28; }
  .graph-panel { grid-row: 1; overflow: hidden; min-height: 0; }
  .editor-panel { grid-column: 1 / -1; grid-row: 2; overflow: hidden; border-top: 1px solid #1a1a28; }
  .suggestions-panel { grid-row: 1 / 3; overflow: hidden; min-height: 0; }

  .panel { min-width: 0; min-height: 0; }

  .suggestions-toggle {
    position: fixed; bottom: 16px; right: 16px;
    padding: 6px 14px;
    background: rgba(139, 92, 246, 0.15);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 16px; color: #a78bfa;
    font-size: 11px; font-weight: 600;
    cursor: pointer; transition: all 0.2s;
    z-index: 100;
    font-family: Inter, system-ui, sans-serif;
  }
  .suggestions-toggle:hover { background: rgba(139, 92, 246, 0.25); }
  .suggestions-toggle.active {
    bottom: auto; top: 52px; right: 306px;
    background: rgba(139, 92, 246, 0.1);
    border-color: rgba(139, 92, 246, 0.2);
    color: #6b7280;
    border-radius: 6px 0 0 6px;
    padding: 4px 8px;
  }

  .loading {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; color: #6b7280; gap: 12px;
  }
  .loader-icon { font-size: 32px; color: #3b82f6; animation: pulse 1.5s infinite; }
  .error { color: #ef4444; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
