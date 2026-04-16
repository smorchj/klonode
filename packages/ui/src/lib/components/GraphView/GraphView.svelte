<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { graphStore, selectedNodeId, showHeatmap, heatmapData } from '../../stores/graph';
  import { t } from '../../stores/i18n';
  import { routingGraphToFlow } from '../../utils/tree-to-graph';
  import { simulatorStore, activePathIds, pulsingNodeId, runSimulation, resetSimulation } from '../../stores/simulator';
  import { activeNodePaths } from '../../stores/activity';
  import { learningScores } from '../../stores/learning';
  import {
    defineComponent,
    defineComponentAction,
    defineComponentState,
  } from '../../workstation/registry';

  // Register with the workstation self-introspection registry. See #64.
  defineComponent({
    id: 'graph-view',
    role: 'Interactive routing graph — nodes for directories, edges for dependencies, with zoom/pan and heatmap overlay',
    parent: 'workstation-layout',
    actions: {
      'select-node':    { args: { nodeId: 'string' } },
      'toggle-heatmap': {},
      'run-simulation': { args: { query: 'string' } },
      'reset-simulation': {},
      'zoom-in':        {},
      'zoom-out':       {},
      'fit-to-view':    {},
    },
    state: [
      'selected-node-id',
      'heatmap-on',
      'zoom',
      'simulation-active',
      'simulation-step-count',
      'simulation-query',
    ],
  });

  defineComponentAction('graph-view', 'select-node', ({ nodeId }) => {
    if (typeof nodeId !== 'string') throw new Error('nodeId is required');
    const g = get(graphStore);
    if (!g) throw new Error('graph not loaded yet');
    if (!g.nodes.has(nodeId)) throw new Error(`no node with id "${nodeId}"`);
    selectedNodeId.set(nodeId);
    return { ok: true, selected: nodeId };
  });
  defineComponentAction('graph-view', 'toggle-heatmap', () => {
    showHeatmap.update(v => !v);
    return { ok: true, now: get(showHeatmap) };
  });
  defineComponentAction('graph-view', 'run-simulation', async ({ query }) => {
    if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
    await runSimulation(query);
    return { ok: true };
  });
  defineComponentAction('graph-view', 'reset-simulation', () => {
    resetSimulation();
    return { ok: true };
  });
  defineComponentAction('graph-view', 'zoom-in', () => {
    zoom = Math.min(3, zoom * 1.2);
    return { ok: true, zoom };
  });
  defineComponentAction('graph-view', 'zoom-out', () => {
    zoom = Math.max(0.1, zoom / 1.2);
    return { ok: true, zoom };
  });
  defineComponentAction('graph-view', 'fit-to-view', () => {
    fitToView();
    return { ok: true };
  });

  defineComponentState('graph-view', 'selected-node-id', () => get(selectedNodeId));
  defineComponentState('graph-view', 'heatmap-on', () => get(showHeatmap));
  defineComponentState('graph-view', 'zoom', () => zoom);
  defineComponentState('graph-view', 'simulation-active', () => {
    const s = get(simulatorStore);
    return s.isRunning || s.completed;
  });
  defineComponentState('graph-view', 'simulation-step-count', () => get(simulatorStore).steps.length);
  defineComponentState('graph-view', 'simulation-query', () => get(simulatorStore).query ?? '');

  let expandedGroups = new Set<string>();
  let zoom = 0.5;
  let panX = 0;
  let panY = 0;
  let canvasEl: HTMLDivElement;
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let svgEl: SVGSVGElement;
  let queryInput = '';
  let showSimPanel = false;
  let expandedStep: number | null = null;

  function toggleStep(i: number) {
    expandedStep = expandedStep === i ? null : i;
  }

  $: flowData = $graphStore
    ? routingGraphToFlow($graphStore, $showHeatmap ? $heatmapData : new Map(), expandedGroups)
    : { nodes: [], edges: [] };

  $: simActive = $simulatorStore.isRunning || $simulatorStore.completed;
  $: simSteps = $simulatorStore.steps;
  $: activeStep = $simulatorStore.activeStepIndex;

  // Example queries for the placeholder
  const exampleQueries = [
    'fix the game physics',
    'add a new component',
    'update the database schema',
    'edit API routes',
    'modify hooks',
  ];
  let placeholderQuery = exampleQueries[0];
  let placeholderIndex = 0;

  let initialFitDone = false;
  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (!initialFitDone && canvasEl && canvasEl.clientHeight > 50) {
        initialFitDone = true;
        fitToView();
      }
    });
    if (canvasEl) ro.observe(canvasEl);
    tick().then(() => fitToView());

    // Rotate placeholder
    const interval = setInterval(() => {
      placeholderIndex = (placeholderIndex + 1) % exampleQueries.length;
      placeholderQuery = exampleQueries[placeholderIndex];
    }, 3000);

    return () => { ro.disconnect(); clearInterval(interval); };
  });

  function handleSimulate() {
    if (!queryInput.trim()) return;
    showSimPanel = true;
    runSimulation(queryInput.trim());
  }

  function handleReset() {
    resetSimulation();
    queryInput = '';
    showSimPanel = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSimulate();
    if (e.key === 'Escape') handleReset();
  }

  function toggleGroup(nodeId: string) {
    if (expandedGroups.has(nodeId)) {
      expandedGroups.delete(nodeId);
    } else {
      expandedGroups.add(nodeId);
    }
    expandedGroups = new Set(expandedGroups);
  }

  function selectNode(nodeId: string) {
    selectedNodeId.set(nodeId);
  }

  function toggleHeatmap() {
    showHeatmap.update((v) => !v);
  }

  function zoomIn() { zoom = Math.min(zoom * 1.2, 3); }
  function zoomOut() { zoom = Math.max(zoom / 1.2, 0.1); }

  function fitToView() {
    if (!canvasEl || flowData.nodes.length === 0) return;
    const cw = canvasEl.clientWidth;
    const ch = canvasEl.clientHeight;
    if (cw === 0 || ch === 0) return;

    const OFFSET_X = 350;
    const OFFSET_Y = 20;
    const NODE_W = 220;
    const NODE_H = 70;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of flowData.nodes) {
      const nx = n.position.x + OFFSET_X;
      const ny = n.position.y + OFFSET_Y;
      if (nx < minX) minX = nx;
      if (ny < minY) minY = ny;
      if (nx + NODE_W > maxX) maxX = nx + NODE_W;
      if (ny + NODE_H > maxY) maxY = ny + NODE_H;
    }

    const graphW = maxX - minX + 60;
    const graphH = maxY - minY + 60;
    const scaleX = cw / graphW;
    const scaleY = ch / graphH;
    zoom = Math.min(scaleX, scaleY, 1.2);
    panX = (cw - graphW * zoom) / 2 - minX * zoom + 30;
    panY = (ch - graphH * zoom) / 2 - minY * zoom + 30;
  }

  function resetView() { fitToView(); }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.max(0.3, Math.min(3, zoom * factor));
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0 && (e.target === svgEl || (e.target as Element)?.tagName === 'svg')) {
      isPanning = true;
      panStart = { x: e.clientX - panX, y: e.clientY - panY };
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isPanning) return;
    panX = e.clientX - panStart.x;
    panY = e.clientY - panStart.y;
  }

  function handleMouseUp() {
    isPanning = false;
  }

  const layerColors: Record<number, string> = {
    0: '#3b82f6',
    1: '#8b5cf6',
    2: '#10b981',
    3: '#f59e0b',
    4: '#6b7280',
  };

  const layerLabels: Record<number, string> = {
    0: 'Rot',
    1: 'Domene',
    2: 'Stage',
    3: 'Referanse',
    4: 'Artefakt',
  };

  function edgePath(sx: number, sy: number, tx: number, ty: number): string {
    const NODE_W = 220;
    const NODE_H = 70;
    const x1 = sx + NODE_W / 2;
    const y1 = sy + NODE_H;
    const x2 = tx + NODE_W / 2;
    const y2 = ty;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }

  // Total tokens loaded in simulation
  $: totalTokens = simSteps
    .filter((_, i) => i <= activeStep)
    .reduce((sum, step) => {
      const match = step.contextLoaded.match(/~(\d+)/);
      return sum + (match ? parseInt(match[1]) : 200);
    }, 0);
</script>

<div class="graph-view">
  <!-- Simulator query bar -->
  <div class="sim-bar">
    <div class="sim-input-wrap">
      <span class="sim-icon">⟐</span>
      <!-- svelte-ignore a11y-autofocus -->
      <input
        type="text"
        class="sim-input"
        bind:value={queryInput}
        on:keydown={handleKeydown}
        placeholder="Simuler: «{placeholderQuery}»"
        disabled={$simulatorStore.isRunning}
      />
      {#if simActive}
        <button class="sim-btn sim-reset" on:click={handleReset}>Nullstill</button>
      {:else}
        <button class="sim-btn" on:click={handleSimulate} disabled={!queryInput.trim()}>
          Simuler ruting
        </button>
      {/if}
    </div>
  </div>

  <div class="graph-header">
    <div class="graph-controls-left">
      <button class="control-btn" class:active={$showHeatmap} on:click={toggleHeatmap}>
        {$t('graph.toggleHeatmap')}
      </button>
      <div class="zoom-controls">
        <button class="zoom-btn" on:click={zoomOut}>−</button>
        <span class="zoom-level">{Math.round(zoom * 100)}%</span>
        <button class="zoom-btn" on:click={zoomIn}>+</button>
        <button class="zoom-btn reset" on:click={resetView}>⟲</button>
      </div>
      <span class="stat">{flowData.nodes.length} {$t('graph.nodes')}</span>
    </div>
  </div>

  <div class="graph-body">
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="graph-canvas"
      bind:this={canvasEl}
      on:wheel={handleWheel}
      on:mousedown={handleMouseDown}
      on:mousemove={handleMouseMove}
      on:mouseup={handleMouseUp}
      on:mouseleave={handleMouseUp}
    >
      {#if flowData.nodes.length === 0}
        <div class="empty-state">
          <p>{$t('app.noProject')}</p>
        </div>
      {:else}
        <svg
          bind:this={svgEl}
          width="100%"
          height="100%"
          style="cursor: {isPanning ? 'grabbing' : 'grab'}"
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#6b7280" />
            </marker>
            <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#22d3ee" />
            </marker>
            <!-- Glow filter for active nodes -->
            <filter id="glow">
              <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            <filter id="pulse-glow">
              <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          <g transform="translate({panX}, {panY}) scale({zoom})">
            <g transform="translate(350, 20)">
              <!-- Edges -->
              {#each flowData.edges as edge (edge.id)}
                {@const source = flowData.nodes.find(n => n.id === edge.source)}
                {@const target = flowData.nodes.find(n => n.id === edge.target)}
                {#if source && target}
                  {@const edgeActive = simActive && $activePathIds.has(edge.source) && $activePathIds.has(edge.target)}
                  <path
                    d={edgePath(source.position.x, source.position.y, target.position.x, target.position.y)}
                    fill="none"
                    stroke={edgeActive ? '#22d3ee' : (edge.style?.replace('stroke: ', '') || '#4b5563')}
                    stroke-width={edgeActive ? 3 : 1.5}
                    opacity={simActive ? (edgeActive ? 0.9 : 0.15) : 0.5}
                    marker-end={edgeActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                    class:edge-active={edgeActive}
                  />
                {/if}
              {/each}

              <!-- Nodes -->
              {#each flowData.nodes as node (node.id)}
                {@const isSelected = $selectedNodeId === node.id}
                {@const color = layerColors[node.data.layer] || '#6b7280'}
                {@const isOnPath = $activePathIds.has(node.id)}
                {@const isPulsing = $pulsingNodeId === node.id}
                {@const dimmed = simActive && !isOnPath}
                {@const activity = $activeNodePaths.get(node.data.path ?? '')}
                {@const activityColor = activity?.kind === 'write' ? '#10b981'
                  : activity?.kind === 'command' ? '#f59e0b'
                  : activity?.kind === 'search' ? '#a78bfa'
                  : activity?.kind === 'read' ? '#3b82f6'
                  : null}
                {@const learning = $learningScores.get(node.data.path ?? '')}
                {@const confidenceOpacity = learning ? 0.5 + learning.confidence * 0.5 : 1}
                {@const urgencyColor = learning && learning.urgency > 2 ? '#ef4444'
                  : learning && learning.urgency > 0.5 ? '#f97316'
                  : null}
                {@const heatBg = $showHeatmap && node.data.heatValue > 0
                  ? `rgba(245, 158, 11, ${node.data.heatValue * 0.4})`
                  : 'rgba(15, 15, 20, 0.85)'}

                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <g
                  transform="translate({node.position.x}, {node.position.y})"
                  on:click|stopPropagation={() => selectNode(node.id)}
                  on:dblclick|stopPropagation={() => toggleGroup(node.id)}
                  style="cursor: pointer; opacity: {dimmed ? undefined : confidenceOpacity}"
                  class="graph-node"
                  class:dimmed
                  class:on-path={isOnPath}
                  class:pulsing={isPulsing}
                  filter={isPulsing ? 'url(#pulse-glow)' : isOnPath ? 'url(#glow)' : 'none'}
                >
                  <!-- Node shadow -->
                  <rect
                    width="220" height="70" rx="10"
                    fill="rgba(0,0,0,0.3)"
                    x="2" y="2"
                  />
                  <!-- Node body -->
                  <rect
                    width="220" height="70" rx="10"
                    fill={activityColor ? `${activityColor}22` : isPulsing ? 'rgba(34, 211, 238, 0.15)' : isOnPath ? 'rgba(34, 211, 238, 0.08)' : heatBg}
                    stroke={activityColor || urgencyColor || (isPulsing ? '#22d3ee' : isOnPath ? '#22d3ee' : isSelected ? '#60a5fa' : color)}
                    stroke-width={activityColor ? 3 : urgencyColor ? 2.5 : isPulsing ? 3 : isOnPath ? 2 : isSelected ? 2.5 : 1.2}
                  />
                  {#if activityColor}
                    <!-- Pulsing activity ring -->
                    <rect
                      width="220" height="70" rx="10"
                      fill="none"
                      stroke={activityColor}
                      stroke-width="2"
                      opacity="0.6"
                      class="activity-ring"
                    />
                  {/if}
                  <!-- Layer color accent bar -->
                  <rect
                    x="0" y="0" width="4" height="70" rx="2"
                    fill={isOnPath ? '#22d3ee' : color}
                  />
                  <!-- Layer badge -->
                  <rect x="12" y="10" width="32" height="18" rx="4" fill={isOnPath ? '#22d3ee' : color} opacity="0.2" />
                  <text x="28" y="23" fill={isOnPath ? '#22d3ee' : color} font-size="10" font-weight="700"
                    text-anchor="middle" style="font-family: 'JetBrains Mono', monospace">
                    L{node.data.layer}
                  </text>
                  <!-- Node name -->
                  <text x="50" y="24" fill={isOnPath ? '#f0fdfa' : '#f3f4f6'} font-size="13" font-weight="600"
                    style="font-family: Inter, system-ui, sans-serif">
                    {node.data.label.length > 20 ? node.data.label.slice(0, 20) + '…' : node.data.label}
                  </text>
                  <!-- Summary -->
                  <text x="12" y="48" fill={isOnPath ? '#67e8f9' : '#9ca3af'} font-size="10"
                    style="font-family: Inter, system-ui, sans-serif">
                    {node.data.summary.length > 30 ? node.data.summary.slice(0, 30) + '…' : node.data.summary}
                  </text>
                  <!-- Context indicator -->
                  {#if node.data.hasContext}
                    <circle cx="196" cy="16" r="5" fill="#10b981" opacity="0.8" />
                    <text x="196" y="19" fill="white" font-size="7" text-anchor="middle"
                      style="font-family: Inter, sans-serif">✓</text>
                  {/if}
                  <!-- Language badge -->
                  {#if node.data.language}
                    <rect x="150" y="42" width="60" height="16" rx="3" fill="rgba(139, 92, 246, 0.15)" />
                    <text x="180" y="53" fill="#a78bfa" font-size="9" text-anchor="middle"
                      style="font-family: 'JetBrains Mono', monospace">
                      {node.data.language}
                    </text>
                  {/if}
                  <!-- Expand indicator -->
                  {#if node.data.childCount > 0}
                    <circle cx="210" cy="60" r="8" fill="rgba(255,255,255,0.05)" stroke={color} stroke-width="0.5" />
                    <text x="210" y="63" fill="#9ca3af" font-size="8" text-anchor="middle"
                      style="font-family: Inter, sans-serif">
                      {expandedGroups.has(node.id) ? '−' : '+' }{node.data.childCount}
                    </text>
                  {/if}

                  <!-- Step number badge when on path -->
                  {#if isOnPath}
                    {@const stepNum = simSteps.findIndex(s => s.nodeId === node.id) + 1}
                    {#if stepNum > 0}
                      <circle cx="-8" cy="-8" r="12" fill="#22d3ee" />
                      <text x="-8" y="-4" fill="#0f172a" font-size="10" font-weight="800"
                        text-anchor="middle" style="font-family: Inter, sans-serif">
                        {stepNum}
                      </text>
                    {/if}
                  {/if}
                </g>
              {/each}
            </g>
          </g>
        </svg>
      {/if}
    </div>

    <!-- Simulation steps panel -->
    {#if showSimPanel}
      <div class="sim-panel">
        <div class="sim-panel-header">
          <span class="sim-panel-title">Rutingssporing</span>
          <span class="sim-token-count">~{totalTokens} tokens lastet</span>
        </div>
        <div class="sim-steps">
          {#each simSteps as step, i}
            {@const isActive = i === activeStep}
            {@const isDone = i < activeStep}
            {@const isFuture = i > activeStep}
            {@const isExpanded = expandedStep === i}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              class="sim-step"
              class:active={isActive}
              class:done={isDone}
              class:future={isFuture}
              class:expanded={isExpanded}
              on:click={() => toggleStep(i)}
            >
              <div class="step-number">
                {#if isDone}
                  <span class="step-check">✓</span>
                {:else if isActive}
                  <span class="step-pulse">●</span>
                {:else}
                  <span class="step-num">{i + 1}</span>
                {/if}
              </div>
              <div class="step-content">
                <div class="step-action">
                  {step.action}
                  <span class="step-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                </div>

                {#if isExpanded || isActive}
                  <div class="step-details">
                    <div class="step-detail-row">
                      <span class="step-detail-label">Fil:</span>
                      <span class="step-detail-value file">{step.contextLoaded}</span>
                    </div>
                    <div class="step-detail-row">
                      <span class="step-detail-label">Hvorfor:</span>
                      <span class="step-detail-value">{step.reason}</span>
                    </div>
                    <div class="step-detail-row">
                      <span class="step-detail-label">Lag:</span>
                      <span class="step-detail-value">
                        <span class="step-layer-badge" style="background: {layerColors[step.layer] || '#6b7280'}20; color: {layerColors[step.layer] || '#6b7280'}">
                          L{step.layer} {layerLabels[step.layer] || ''}
                        </span>
                      </span>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
          {#if $simulatorStore.completed}
            <div class="sim-done">
              <div class="sim-done-icon">✓</div>
              <div class="sim-done-text">Ruting ferdig</div>
              <div class="sim-done-sub">AI har nå konteksten den trenger</div>
            </div>

            <!-- Token comparison -->
            {#if $simulatorStore.comparison}
              {@const cmp = $simulatorStore.comparison}
              <div class="token-comparison">
                <div class="comparison-title">Token-sammenligning</div>

                <div class="comparison-bars">
                  <!-- Without Klonode -->
                  <div class="bar-row">
                    <div class="bar-label">
                      <span class="bar-label-text">Uten Klonode</span>
                      <span class="bar-value without">{cmp.withoutKlonode.toLocaleString()} tokens</span>
                    </div>
                    <div class="bar-track">
                      <div class="bar-fill without" style="width: 100%"></div>
                    </div>
                    <div class="bar-files">{cmp.filesWithout} filer skannet</div>
                  </div>

                  <!-- With Klonode -->
                  <div class="bar-row">
                    <div class="bar-label">
                      <span class="bar-label-text">Med Klonode</span>
                      <span class="bar-value with">{cmp.withKlonode.toLocaleString()} tokens</span>
                    </div>
                    <div class="bar-track">
                      <div class="bar-fill with" style="width: {Math.max(3, (cmp.withKlonode / cmp.withoutKlonode) * 100)}%"></div>
                    </div>
                    <div class="bar-files">{cmp.filesWithKlonode} filer lastet</div>
                  </div>
                </div>

                <div class="savings-card">
                  <div class="savings-percent">{cmp.savedPercent}%</div>
                  <div class="savings-label">færre tokens</div>
                  <div class="savings-detail">{cmp.saved.toLocaleString()} tokens spart per forespørsel</div>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <div class="graph-legend">
    {#each Object.entries(layerColors) as [layer, color]}
      <span class="legend-item">
        <span class="legend-dot" style:background={color}></span>
        L{layer} {layerLabels[Number(layer)] || ''}
      </span>
    {/each}
    {#if !simActive}
      <span class="legend-hint">Dobbeltklikk for å utvide · Scroll for zoom · Dra for å panorere</span>
    {/if}
  </div>
</div>

<style>
  .graph-view { display: flex; flex-direction: column; height: 100%; background: #07070c; }

  /* Simulator query bar */
  .sim-bar {
    padding: 8px 16px;
    background: linear-gradient(135deg, rgba(34, 211, 238, 0.05), rgba(59, 130, 246, 0.05));
    border-bottom: 1px solid rgba(34, 211, 238, 0.15);
    flex-shrink: 0;
  }
  .sim-input-wrap {
    display: flex; align-items: center; gap: 8px;
    background: rgba(15, 15, 25, 0.8);
    border: 1px solid #2a2a3a; border-radius: 8px;
    padding: 0 12px;
  }
  .sim-input-wrap:focus-within { border-color: #22d3ee; }
  .sim-icon { color: #22d3ee; font-size: 16px; }
  .sim-input {
    flex: 1; background: none; border: none; outline: none;
    color: #e5e7eb; font-size: 13px; padding: 8px 0;
    font-family: Inter, system-ui, sans-serif;
  }
  .sim-input::placeholder { color: #4b5563; }
  .sim-input:disabled { opacity: 0.5; }
  .sim-btn {
    padding: 5px 14px; background: rgba(34, 211, 238, 0.12);
    border: 1px solid rgba(34, 211, 238, 0.3); border-radius: 6px;
    color: #22d3ee; font-size: 11px; cursor: pointer;
    white-space: nowrap; transition: all 0.15s;
    font-weight: 600;
  }
  .sim-btn:hover:not(:disabled) { background: rgba(34, 211, 238, 0.2); }
  .sim-btn:disabled { opacity: 0.3; cursor: default; }
  .sim-reset { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #f87171; }
  .sim-reset:hover { background: rgba(239, 68, 68, 0.2); }

  .graph-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 16px; border-bottom: 1px solid #1a1a28;
    background: rgba(10, 10, 18, 0.95); flex-shrink: 0;
  }
  .graph-controls-left { display: flex; align-items: center; gap: 12px; }

  .control-btn {
    padding: 4px 10px; background: #12121c; border: 1px solid #2a2a3a; border-radius: 6px;
    color: #9ca3af; font-size: 11px; cursor: pointer; transition: all 0.15s;
  }
  .control-btn:hover { background: #1a1a28; border-color: #3a3a4a; }
  .control-btn.active { background: rgba(245, 158, 11, 0.12); border-color: #f59e0b; color: #f59e0b; }

  .zoom-controls { display: flex; align-items: center; gap: 4px; }
  .zoom-btn {
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    background: #12121c; border: 1px solid #2a2a3a; border-radius: 6px;
    color: #9ca3af; font-size: 14px; cursor: pointer; transition: all 0.15s;
  }
  .zoom-btn:hover { background: #1a1a28; color: #e5e7eb; }
  .zoom-btn.reset { font-size: 16px; }
  .zoom-level { font-size: 11px; color: #6b7280; min-width: 36px; text-align: center; }
  .stat { font-size: 11px; color: #6b7280; }

  .graph-body { display: flex; flex: 1; min-height: 0; }

  .graph-canvas {
    flex: 1; overflow: hidden; position: relative;
    background:
      radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.03) 0%, transparent 70%),
      linear-gradient(rgba(30, 30, 50, 0.3) 1px, transparent 1px),
      linear-gradient(90deg, rgba(30, 30, 50, 0.3) 1px, transparent 1px);
    background-size: 100% 100%, 40px 40px, 40px 40px;
  }
  .graph-canvas svg { display: block; width: 100%; height: 100%; }

  :global(.graph-node) { transition: opacity 0.3s, filter 0.3s; }
  :global(.graph-node:hover rect) { filter: brightness(1.2); }
  :global(.graph-node.dimmed) { opacity: 0.2; }
  :global(.graph-node.pulsing) { animation: node-pulse 1s ease-in-out infinite; }
  :global(.activity-ring) {
    animation: activity-ring-pulse 1.4s ease-in-out infinite;
    transform-origin: center;
  }
  @keyframes activity-ring-pulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.7; }
  }
  :global(.edge-active) { animation: edge-flow 1.5s linear infinite; stroke-dasharray: 8 4; }

  @keyframes node-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  @keyframes edge-flow {
    to { stroke-dashoffset: -24; }
  }

  /* Simulation panel */
  .sim-panel {
    width: 320px; flex-shrink: 0;
    background: rgba(10, 10, 18, 0.97);
    border-left: 1px solid rgba(34, 211, 238, 0.15);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .sim-panel-header {
    padding: 10px 14px;
    border-bottom: 1px solid #1a1a28;
    display: flex; align-items: center; justify-content: space-between;
  }
  .sim-panel-title { font-size: 12px; font-weight: 700; color: #22d3ee; }
  .sim-token-count {
    font-size: 10px; color: #f59e0b;
    padding: 2px 8px; background: rgba(245, 158, 11, 0.1);
    border-radius: 4px;
  }
  .sim-steps { flex: 1; overflow-y: auto; padding: 8px; }

  .sim-step {
    display: flex; gap: 10px; padding: 10px;
    border-radius: 8px; margin-bottom: 4px;
    transition: all 0.3s; cursor: pointer;
    border: 1px solid transparent;
  }
  .sim-step:hover { background: rgba(34, 211, 238, 0.04); }
  .sim-step.active { background: rgba(34, 211, 238, 0.08); border-color: rgba(34, 211, 238, 0.2); }
  .sim-step.expanded { background: rgba(34, 211, 238, 0.06); border-color: rgba(34, 211, 238, 0.15); }
  .sim-step.done { opacity: 0.85; }
  .sim-step.future { opacity: 0.3; }

  .step-number {
    width: 28px; height: 28px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; font-size: 12px; font-weight: 700;
    background: #1a1a28; color: #6b7280;
  }
  .sim-step.active .step-number { background: #22d3ee; color: #0f172a; }
  .sim-step.done .step-number { background: rgba(34, 211, 238, 0.2); color: #22d3ee; }

  .step-check { color: #22d3ee; font-size: 13px; }
  .step-pulse { color: #0f172a; animation: node-pulse 0.8s infinite; font-size: 14px; }
  .step-num { }

  .step-content { flex: 1; min-width: 0; }
  .step-action {
    font-size: 12px; font-weight: 600; color: #e5e7eb;
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px;
  }
  .step-expand-icon { color: #4b5563; font-size: 10px; flex-shrink: 0; }

  .step-details {
    margin-top: 8px; padding-top: 8px;
    border-top: 1px solid rgba(34, 211, 238, 0.1);
  }
  .step-detail-row {
    display: flex; gap: 8px; margin-bottom: 6px;
    align-items: flex-start;
  }
  .step-detail-label {
    font-size: 10px; color: #6b7280; font-weight: 600;
    min-width: 48px; flex-shrink: 0; padding-top: 1px;
  }
  .step-detail-value {
    font-size: 11px; color: #d1d5db;
    line-height: 1.4;
  }
  .step-detail-value.file {
    color: #22d3ee;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    word-break: break-all;
  }
  .step-layer-badge {
    display: inline-block;
    padding: 1px 8px; border-radius: 4px;
    font-size: 10px; font-weight: 600;
  }

  .sim-done {
    padding: 16px 12px; margin-top: 8px;
    background: rgba(34, 211, 238, 0.06);
    border-radius: 8px; border: 1px solid rgba(34, 211, 238, 0.15);
    text-align: center;
  }
  .sim-done-icon { font-size: 20px; color: #22d3ee; margin-bottom: 4px; }
  .sim-done-text { font-size: 12px; color: #22d3ee; font-weight: 700; }
  .sim-done-sub { font-size: 10px; color: #67e8f9; margin-top: 2px; }

  /* Token comparison */
  .token-comparison {
    margin-top: 8px; padding: 14px 12px;
    background: rgba(15, 15, 25, 0.9);
    border-radius: 10px;
    border: 1px solid rgba(34, 211, 238, 0.12);
  }
  .comparison-title {
    font-size: 11px; font-weight: 700; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 12px;
  }

  .comparison-bars { display: flex; flex-direction: column; gap: 10px; }

  .bar-row { display: flex; flex-direction: column; gap: 3px; }
  .bar-label {
    display: flex; justify-content: space-between; align-items: center;
  }
  .bar-label-text { font-size: 11px; color: #9ca3af; font-weight: 500; }
  .bar-value { font-size: 12px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .bar-value.without { color: #f87171; }
  .bar-value.with { color: #22d3ee; }

  .bar-track {
    height: 8px; background: rgba(255, 255, 255, 0.05);
    border-radius: 4px; overflow: hidden;
  }
  .bar-fill {
    height: 100%; border-radius: 4px;
    transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .bar-fill.without {
    background: linear-gradient(90deg, #ef4444, #f87171);
  }
  .bar-fill.with {
    background: linear-gradient(90deg, #06b6d4, #22d3ee);
  }
  .bar-files { font-size: 9px; color: #6b7280; }

  .savings-card {
    margin-top: 14px; padding: 12px;
    background: linear-gradient(135deg, rgba(34, 211, 238, 0.08), rgba(16, 185, 129, 0.08));
    border-radius: 8px;
    border: 1px solid rgba(34, 211, 238, 0.2);
    text-align: center;
  }
  .savings-percent {
    font-size: 32px; font-weight: 800; color: #22d3ee;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1;
  }
  .savings-label {
    font-size: 12px; color: #67e8f9; font-weight: 600;
    margin-top: 2px;
  }
  .savings-detail {
    font-size: 10px; color: #94a3b8; margin-top: 6px;
  }

  .empty-state {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #6b7280;
  }

  .graph-legend {
    display: flex; gap: 16px; padding: 6px 16px;
    border-top: 1px solid #1a1a28; align-items: center;
    background: rgba(10, 10, 18, 0.95); flex-shrink: 0;
  }
  .legend-item {
    display: flex; align-items: center; gap: 5px;
    font-size: 10px; color: #9ca3af;
  }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
  .legend-hint {
    margin-left: auto; font-size: 10px; color: #4b5563; font-style: italic;
  }
</style>
