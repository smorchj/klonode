<script lang="ts">
  import type { RoutingNode, RoutingGraph } from '../../types';
  import { selectedNodeId, showHeatmap } from '../../stores/graph';

  export let node: RoutingNode;
  export let graph: RoutingGraph;
  export let depth: number = 0;

  let expanded = depth < 2;
  $: children = node.children
    .map((id) => graph.nodes.get(id))
    .filter((n): n is RoutingNode => n !== undefined);
  $: isSelected = $selectedNodeId === node.id;
  $: hasContext = node.contextFile !== null;

  const layerIcons: Record<number, string> = {
    0: '⟐',
    1: '◈',
    2: '◆',
    3: '◇',
    4: '○',
  };

  function select() {
    selectedNodeId.set(node.id);
  }

  function toggle(e: Event) {
    e.stopPropagation();
    expanded = !expanded;
  }
</script>

<div class="tree-node" style:--depth={depth}>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="node-row"
    class:selected={isSelected}
    class:has-context={hasContext}
    on:click={select}
  >
    {#if children.length > 0}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <span class="toggle" on:click={toggle}>
        {expanded ? '▼' : '▶'}
      </span>
    {:else}
      <span class="toggle-spacer"></span>
    {/if}

    <span class="layer-icon">{layerIcons[node.layer] || '·'}</span>
    <span class="node-name">{node.name}</span>

    {#if node.language}
      <span class="language-badge">{node.language}</span>
    {/if}

    {#if hasContext}
      <span class="context-badge" title={node.contextFile?.manuallyEdited ? 'Manuelt redigert' : 'Auto-generert'}>
        {node.contextFile?.manuallyEdited ? '✎' : '⚙'}
      </span>
    {/if}

    {#if node.telemetry.accessCount > 0}
      <span class="access-count">{node.telemetry.accessCount}×</span>
    {/if}
  </div>

  {#if expanded && children.length > 0}
    <div class="children">
      {#each children as child (child.id)}
        <svelte:self node={child} {graph} depth={depth + 1} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node {
    --indent: calc(var(--depth, 0) * 16px);
  }

  .node-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px calc(var(--indent) + 8px);
    width: 100%;
    cursor: pointer;
    font-size: 13px;
    color: #e5e7eb;
    text-align: left;
    border-radius: 4px;
    transition: background 0.15s;
  }

  .node-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .node-row.selected {
    background: rgba(59, 130, 246, 0.2);
    border-left: 2px solid #3b82f6;
  }

  .node-row.has-context {
    color: #f9fafb;
  }

  .toggle {
    color: #6b7280;
    cursor: pointer;
    font-size: 10px;
    width: 16px;
    user-select: none;
  }

  .toggle-spacer {
    width: 16px;
    display: inline-block;
  }

  .layer-icon {
    color: #8b5cf6;
    font-size: 12px;
  }

  .node-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .language-badge {
    font-size: 10px;
    padding: 1px 4px;
    background: rgba(139, 92, 246, 0.2);
    color: #a78bfa;
    border-radius: 3px;
  }

  .context-badge {
    font-size: 11px;
    color: #10b981;
  }

  .access-count {
    font-size: 10px;
    color: #f59e0b;
  }

  .children {
    border-left: 1px solid rgba(107, 114, 128, 0.2);
    margin-left: calc(var(--indent) + 18px);
  }
</style>
