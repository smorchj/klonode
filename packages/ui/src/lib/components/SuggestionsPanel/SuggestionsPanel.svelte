<script lang="ts">
  import { onMount } from 'svelte';

  interface Suggestion {
    id: string;
    type: string;
    status: string;
    urgency: number;
    title: string;
    reason: string;
    path: string;
    createdAt: string;
  }

  let suggestions: Suggestion[] = [];
  let loading = false;
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/suggestions');
      const data = await res.json();
      suggestions = data.suggestions || [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    }
    loading = false;
  }

  async function generate() {
    loading = true;
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      });
      const data = await res.json();
      suggestions = data.suggestions || [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to generate';
    }
    loading = false;
  }

  async function act(id: string, action: 'approve' | 'dismiss' | 'snooze') {
    try {
      await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      suggestions = suggestions.filter(s => s.id !== id);
    } catch { /* ignore */ }
  }

  function urgencyColor(urgency: number): string {
    if (urgency > 2) return '#ef4444';
    if (urgency > 1) return '#f97316';
    if (urgency > 0.5) return '#eab308';
    return '#6b7280';
  }

  onMount(load);
</script>

<div class="suggestions-panel">
  <div class="panel-header">
    <h3>Suggestions</h3>
    <button class="refresh-btn" on:click={generate} disabled={loading}>
      {loading ? '...' : 'Analyze'}
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {:else if suggestions.length === 0 && !loading}
    <div class="empty">
      <p>No suggestions yet.</p>
      <p class="hint">Click Analyze to generate suggestions from observation data, or wait for a session to end.</p>
    </div>
  {:else}
    <div class="suggestion-list">
      {#each suggestions as s (s.id)}
        <div class="suggestion-card">
          <div class="urgency-bar" style="background: {urgencyColor(s.urgency)}"></div>
          <div class="card-body">
            <div class="card-header">
              <span class="type-badge">{s.type}</span>
              <span class="urgency-score">{s.urgency.toFixed(1)}</span>
            </div>
            <h4 class="card-title">{s.title}</h4>
            <p class="card-reason">{s.reason}</p>
            <div class="card-path">{s.path}</div>
            <div class="card-actions">
              <button class="approve-btn" on:click={() => act(s.id, 'approve')}>Approve</button>
              <button class="snooze-btn" on:click={() => act(s.id, 'snooze')}>Snooze 7d</button>
              <button class="dismiss-btn" on:click={() => act(s.id, 'dismiss')}>Dismiss</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .suggestions-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #0a0a0f;
    border-left: 1px solid #1a1a28;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #1a1a28;
    flex-shrink: 0;
  }

  .panel-header h3 {
    font-size: 13px;
    font-weight: 700;
    color: #f9fafb;
  }

  .refresh-btn {
    padding: 4px 12px;
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 4px;
    color: #60a5fa;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .refresh-btn:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.25);
  }
  .refresh-btn:disabled { opacity: 0.5; }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    text-align: center;
    padding: 24px;
    gap: 8px;
  }
  .empty p { font-size: 12px; }
  .hint { font-size: 11px; color: #4b5563; }

  .error { color: #ef4444; padding: 12px 16px; font-size: 12px; }

  .suggestion-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .suggestion-card {
    display: flex;
    margin-bottom: 8px;
    border-radius: 6px;
    border: 1px solid #1f1f2e;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .suggestion-card:hover {
    border-color: #3b3b4f;
  }

  .urgency-bar {
    width: 4px;
    flex-shrink: 0;
  }

  .card-body {
    flex: 1;
    padding: 10px 12px;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .type-badge {
    padding: 2px 6px;
    background: rgba(139, 92, 246, 0.15);
    border-radius: 3px;
    color: #a78bfa;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .urgency-score {
    font-size: 10px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    color: #6b7280;
  }

  .card-title {
    font-size: 12px;
    font-weight: 600;
    color: #e5e7eb;
    margin-bottom: 4px;
  }

  .card-reason {
    font-size: 11px;
    color: #9ca3af;
    line-height: 1.5;
    margin-bottom: 6px;
  }

  .card-path {
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    color: #6b7280;
    margin-bottom: 8px;
  }

  .card-actions {
    display: flex;
    gap: 6px;
  }

  .card-actions button {
    padding: 3px 10px;
    border-radius: 3px;
    border: 1px solid;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .approve-btn {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.3) !important;
    color: #34d399;
  }
  .approve-btn:hover { background: rgba(16, 185, 129, 0.2); }

  .snooze-btn {
    background: rgba(234, 179, 8, 0.1);
    border-color: rgba(234, 179, 8, 0.3) !important;
    color: #fbbf24;
  }
  .snooze-btn:hover { background: rgba(234, 179, 8, 0.2); }

  .dismiss-btn {
    background: transparent;
    border-color: #2d2d3d !important;
    color: #6b7280;
  }
  .dismiss-btn:hover { background: rgba(255, 255, 255, 0.05); color: #9ca3af; }
</style>
