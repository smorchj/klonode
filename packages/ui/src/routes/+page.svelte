<script lang="ts">
  import { onMount } from 'svelte';
  import { viewMode } from '$lib/stores/graph';
  import { loadGraphForCurrentProject } from '$lib/stores/loader';
  import TreeView from '$lib/components/TreeView/TreeView.svelte';
  import GraphView from '$lib/components/GraphView/GraphView.svelte';
  import ContextEditor from '$lib/components/Editor/ContextEditor.svelte';
  import GitHubView from '$lib/components/GitHubView/GitHubView.svelte';

  let loaded = false;
  let error = '';
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
  </div>
{/if}

<style>
  .main-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    grid-template-rows: 1fr 180px;
    height: 100%;
    min-height: 0;
  }

  .main-layout.tree-only { grid-template-columns: 1fr; grid-template-rows: 1fr 200px; }

  .main-layout.graph-only { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .main-layout.graph-only .editor-panel { display: none; }

  .main-layout.github-only { grid-template-columns: 1fr; grid-template-rows: 1fr; }

  .github-panel { grid-row: 1; grid-column: 1; overflow: hidden; min-height: 0; }

  .tree-panel { grid-row: 1; overflow: hidden; min-height: 0; border-right: 1px solid #1a1a28; }
  .graph-panel { grid-row: 1; overflow: hidden; min-height: 0; }
  .editor-panel { grid-column: 1 / -1; grid-row: 2; overflow: hidden; border-top: 1px solid #1a1a28; }

  .panel { min-width: 0; min-height: 0; }

  .loading {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; color: #6b7280; gap: 12px;
  }
  .loader-icon { font-size: 32px; color: #3b82f6; animation: pulse 1.5s infinite; }
  .error { color: #ef4444; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
