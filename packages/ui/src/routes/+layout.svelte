<script lang="ts">
  import { locale, t } from '$lib/stores/i18n';
  import { viewMode } from '$lib/stores/graph';
  import { graphStore } from '$lib/stores/graph';
  import { pullLatest } from '$lib/stores/github';

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
  .content { flex: 1; overflow: hidden; }
</style>
