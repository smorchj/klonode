<script lang="ts">
  import { get } from 'svelte/store';
  import { graphStore, selectedNodeId, topLevelNodes } from '../../stores/graph';
  import { t } from '../../stores/i18n';
  import TreeNode from './TreeNode.svelte';
  import {
    defineComponent,
    defineComponentAction,
    defineComponentState,
  } from '../../workstation/registry';

  // Register with the workstation self-introspection registry. See #64.
  defineComponent({
    id: 'tree-view',
    role: 'Sidebar tree of the routing graph — shows every directory with its summary and access count',
    parent: 'workstation-layout',
    actions: {
      'select-node': { args: { nodeId: 'string' } },
      'search':      { args: { query: 'string' } },
      'clear-search': {},
    },
    state: ['selected-node-id', 'search-query', 'total-files', 'total-dirs', 'has-graph'],
  });

  defineComponentAction('tree-view', 'select-node', ({ nodeId }) => {
    if (typeof nodeId !== 'string') throw new Error('nodeId is required');
    const graph = get(graphStore);
    if (!graph) throw new Error('graph not loaded yet');
    if (!graph.nodes.has(nodeId)) throw new Error(`no node with id "${nodeId}"`);
    selectedNodeId.set(nodeId);
    return { ok: true, selected: nodeId };
  });
  defineComponentAction('tree-view', 'search', ({ query }) => {
    if (typeof query !== 'string') throw new Error('query is required');
    searchQuery = query;
    return { ok: true };
  });
  defineComponentAction('tree-view', 'clear-search', () => {
    searchQuery = '';
    return { ok: true };
  });

  defineComponentState('tree-view', 'selected-node-id', () => get(selectedNodeId));
  defineComponentState('tree-view', 'search-query', () => searchQuery);
  defineComponentState('tree-view', 'total-files', () => {
    const g = get(graphStore);
    return g ? g.metadata.totalFiles : 0;
  });
  defineComponentState('tree-view', 'total-dirs', () => {
    const g = get(graphStore);
    return g ? g.metadata.totalDirectories : 0;
  });
  defineComponentState('tree-view', 'has-graph', () => get(graphStore) !== null);

  let searchQuery = '';

  $: rootNode = $graphStore ? $graphStore.nodes.get($graphStore.rootNodeId) : null;
  $: filteredNodes = searchQuery
    ? $topLevelNodes.filter(n =>
        n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.summary.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : $topLevelNodes;
</script>

<div class="tree-view">
  <div class="tree-header">
    <h3>{$t('tree.title')}</h3>
    <input
      type="text"
      class="search-input"
      placeholder={$t('tree.search')}
      bind:value={searchQuery}
    />
  </div>

  <div class="tree-content">
    {#if $graphStore && rootNode}
      <TreeNode node={rootNode} graph={$graphStore} depth={0} />
    {:else}
      <p class="empty-state">{$t('tree.empty')}</p>
    {/if}
  </div>

  {#if $graphStore}
    <div class="tree-footer">
      <span>{$graphStore.metadata.totalFiles} {$t('tree.files')}</span>
      <span>·</span>
      <span>{$graphStore.metadata.totalDirectories} {$t('tree.dirs')}</span>
    </div>
  {/if}
</div>

<style>
  .tree-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f0f14;
    border-right: 1px solid #1f1f2e;
  }

  .tree-header {
    padding: 12px;
    border-bottom: 1px solid #1f1f2e;
  }

  .tree-header h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #e5e7eb;
    font-weight: 600;
  }

  .search-input {
    width: 100%;
    padding: 6px 10px;
    background: #1a1a24;
    border: 1px solid #2d2d3d;
    border-radius: 6px;
    color: #e5e7eb;
    font-size: 12px;
    outline: none;
  }

  .search-input:focus {
    border-color: #3b82f6;
  }

  .tree-content {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .tree-footer {
    padding: 8px 12px;
    border-top: 1px solid #1f1f2e;
    font-size: 11px;
    color: #6b7280;
    display: flex;
    gap: 6px;
  }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: #6b7280;
    font-size: 13px;
  }
</style>
