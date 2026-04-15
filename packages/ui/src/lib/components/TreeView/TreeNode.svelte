<script lang="ts">
  import type { RoutingNode, RoutingGraph } from '../../types';
  import { selectedNodeId, showHeatmap } from '../../stores/graph';
  import { activeNodePaths, isPathActive } from '../../stores/activity';

  export let node: RoutingNode;
  export let graph: RoutingGraph;
  export let depth: number = 0;

  let expanded = depth < 2;
  $: children = node.children
    .map((id) => graph.nodes.get(id))
    .filter((n): n is RoutingNode => n !== undefined);
  $: isSelected = $selectedNodeId === node.id;
  $: hasContext = node.contextFile !== null;
  // Auto-expand when a descendant becomes active so the activity is visible
  $: active = isPathActive($activeNodePaths, node.path);
  $: if (active && !expanded) expanded = true;

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
    class:active-by-ai={!!active}
    class:active-read={active?.kind === 'read'}
    class:active-write={active?.kind === 'write'}
    class:active-command={active?.kind === 'command'}
    class:active-search={active?.kind === 'search'}
    on:click={select}
  >
    {#if active}
      <span class="activity-indicator" title="Claude is working here">
        {#if active.kind === 'write'}●{:else if active.kind === 'command'}▸{:else}○{/if}
      </span>
    {/if}
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

  /* Active-by-AI highlighting — nodes Claude is currently touching */
  .node-row.active-by-ai {
    animation: activity-pulse 2s ease-out;
  }
  .node-row.active-read {
    background: rgba(59, 130, 246, 0.15);
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.35);
  }
  .node-row.active-write {
    background: rgba(16, 185, 129, 0.15);
    box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.4);
  }
  .node-row.active-command {
    background: rgba(245, 158, 11, 0.12);
    box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.35);
  }
  .node-row.active-search {
    background: rgba(167, 139, 250, 0.12);
    box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.3);
  }

  .activity-indicator {
    font-size: 10px;
    color: #a78bfa;
    animation: activity-blink 1.2s infinite;
  }
  .node-row.active-read .activity-indicator { color: #3b82f6; }
  .node-row.active-write .activity-indicator { color: #10b981; }
  .node-row.active-command .activity-indicator { color: #f59e0b; }

  @keyframes activity-pulse {
    0% { transform: scale(1); }
    10% { transform: scale(1.02); }
    100% { transform: scale(1); }
  }
  @keyframes activity-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
