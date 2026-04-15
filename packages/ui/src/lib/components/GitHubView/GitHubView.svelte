<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { graphStore } from '../../stores/graph';
  import { githubStore, fetchGitHubData, setGitHubTab } from '../../stores/github';
  import {
    defineComponent,
    defineComponentAction,
    defineComponentState,
  } from '../../workstation/registry';

  // Register with the workstation self-introspection registry. See #64.
  defineComponent({
    id: 'github-view',
    role: 'GitHub integration pane — commits, branches, PRs, and issues for the current repo',
    parent: 'workstation-layout',
    actions: {
      'refresh':  {},
      'set-tab':  { args: { tab: '"commits" | "branches" | "prs" | "issues"' } },
    },
    state: [
      'active-tab',
      'loading',
      'commit-count',
      'branch-count',
      'pr-count',
      'issue-count',
      'has-repo-path',
    ],
  });

  defineComponentAction('github-view', 'refresh', () => {
    const g = get(graphStore);
    if (!g?.repoPath) throw new Error('no repo path — graph not loaded yet');
    fetchGitHubData(g.repoPath);
    return { ok: true };
  });
  defineComponentAction('github-view', 'set-tab', ({ tab }) => {
    const allowed = ['commits', 'branches', 'prs', 'issues'] as const;
    if (!allowed.includes(tab as any)) throw new Error(`tab must be one of ${allowed.join(', ')}`);
    setGitHubTab(tab as typeof allowed[number]);
    return { ok: true };
  });

  defineComponentState('github-view', 'active-tab', () => get(githubStore).activeTab);
  defineComponentState('github-view', 'loading', () => get(githubStore).loading);
  defineComponentState('github-view', 'commit-count', () => get(githubStore).commits.length);
  defineComponentState('github-view', 'branch-count', () => get(githubStore).branches.length);
  defineComponentState('github-view', 'pr-count', () => get(githubStore).prs.length);
  defineComponentState('github-view', 'issue-count', () => get(githubStore).issues.length);
  defineComponentState('github-view', 'has-repo-path', () => !!get(graphStore)?.repoPath);

  onMount(() => {
    if ($graphStore?.repoPath) {
      fetchGitHubData($graphStore.repoPath);
    }
  });

  function refresh() {
    if ($graphStore?.repoPath) fetchGitHubData($graphStore.repoPath);
  }

  function relativeDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
</script>

<div class="github-view">
  <div class="gh-header">
    <div class="gh-tabs">
      <button class:active={$githubStore.activeTab === 'commits'} on:click={() => setGitHubTab('commits')}>
        Commits ({$githubStore.commits.length})
      </button>
      <button class:active={$githubStore.activeTab === 'branches'} on:click={() => setGitHubTab('branches')}>
        Branches ({$githubStore.branches.length})
      </button>
      <button class:active={$githubStore.activeTab === 'prs'} on:click={() => setGitHubTab('prs')}>
        PRs ({$githubStore.prs.length})
      </button>
      <button class:active={$githubStore.activeTab === 'issues'} on:click={() => setGitHubTab('issues')}>
        Issues ({$githubStore.issues.length})
      </button>
    </div>
    <button class="refresh-btn" on:click={refresh} disabled={$githubStore.loading}>
      {$githubStore.loading ? '↻...' : '↻'}
    </button>
  </div>

  <div class="gh-content">
    {#if $githubStore.loading && $githubStore.commits.length === 0}
      <div class="gh-empty">Laster...</div>
    {:else if $githubStore.error}
      <div class="gh-error">{$githubStore.error}</div>
    {:else if $githubStore.activeTab === 'commits'}
      <div class="commit-list">
        {#each $githubStore.commits as commit}
          <div class="commit-item">
            <div class="commit-lane">
              <div class="commit-dot" />
              <div class="commit-line" />
            </div>
            <div class="commit-info">
              <div class="commit-msg">{commit.message}</div>
              <div class="commit-meta">
                <span class="commit-sha">{commit.shortSha}</span>
                <span class="commit-author">{commit.author}</span>
                <span class="commit-date">{relativeDate(commit.date)}</span>
                {#if commit.branch}
                  <span class="commit-branch">{commit.branch}</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if $githubStore.activeTab === 'branches'}
      <div class="branch-list">
        {#each $githubStore.branches as branch}
          <div class="branch-item" class:current={branch.current}>
            <span class="branch-name">
              {#if branch.current}<span class="current-marker">*</span>{/if}
              {branch.name}
            </span>
            <span class="branch-track">
              {#if branch.ahead > 0}<span class="ahead">+{branch.ahead}</span>{/if}
              {#if branch.behind > 0}<span class="behind">-{branch.behind}</span>{/if}
            </span>
          </div>
        {/each}
      </div>
    {:else if $githubStore.activeTab === 'prs'}
      {#if $githubStore.prs.length === 0}
        <div class="gh-empty">Ingen PRs (trenger gh CLI)</div>
      {:else}
        <div class="pr-list">
          {#each $githubStore.prs as pr}
            <div class="pr-item" class:merged={pr.state === 'merged'} class:closed={pr.state === 'closed'}>
              <div class="pr-header">
                <span class="pr-number">#{pr.number}</span>
                <span class="pr-title">{pr.title}</span>
              </div>
              <div class="pr-meta">
                <span class="pr-state">{pr.state}</span>
                <span class="pr-branch">{pr.branch} → {pr.baseBranch}</span>
                <span class="pr-author">{pr.author}</span>
                <span class="pr-date">{relativeDate(pr.createdAt)}</span>
              </div>
              {#if pr.labels.length > 0}
                <div class="pr-labels">
                  {#each pr.labels as label}
                    <span class="label">{label}</span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else if $githubStore.activeTab === 'issues'}
      {#if $githubStore.issues.length === 0}
        <div class="gh-empty">Ingen issues (trenger gh CLI)</div>
      {:else}
        <div class="issue-list">
          {#each $githubStore.issues as issue}
            <div class="issue-item" class:closed={issue.state === 'closed'}>
              <div class="issue-header">
                <span class="issue-number">#{issue.number}</span>
                <span class="issue-title">{issue.title}</span>
              </div>
              <div class="issue-meta">
                <span class="issue-state">{issue.state}</span>
                <span class="issue-author">{issue.author}</span>
                <span class="issue-date">{relativeDate(issue.createdAt)}</span>
                {#each issue.assignees as a}
                  <span class="issue-assignee">@{a}</span>
                {/each}
              </div>
              {#if issue.labels.length > 0}
                <div class="issue-labels">
                  {#each issue.labels as label}
                    <span class="label">{label}</span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .github-view {
    display: flex; flex-direction: column; height: 100%;
    background: #07070c; color: #e5e7eb;
    font-family: Inter, system-ui, sans-serif;
  }

  .gh-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; border-bottom: 1px solid #1a1a28;
    background: rgba(10, 10, 18, 0.98); flex-shrink: 0;
  }

  .gh-tabs { display: flex; gap: 2px; }
  .gh-tabs button {
    padding: 5px 10px; background: transparent; border: none;
    border-radius: 4px; color: #6b7280; font-size: 11px;
    cursor: pointer; transition: all 0.15s; font-weight: 600;
  }
  .gh-tabs button:hover { color: #9ca3af; background: #1a1a28; }
  .gh-tabs button.active { background: rgba(167, 139, 250, 0.12); color: #a78bfa; }

  .refresh-btn {
    width: 28px; height: 28px; border: none; background: transparent;
    color: #6b7280; cursor: pointer; border-radius: 6px;
    font-size: 16px; display: flex; align-items: center; justify-content: center;
  }
  .refresh-btn:hover:not(:disabled) { background: #1a1a28; color: #e5e7eb; }

  .gh-content { flex: 1; overflow-y: auto; padding: 8px 12px; }
  .gh-empty { text-align: center; padding: 40px; color: #6b7280; font-size: 12px; }
  .gh-error { text-align: center; padding: 20px; color: #f87171; font-size: 12px; }

  /* Commits */
  .commit-list { display: flex; flex-direction: column; }
  .commit-item { display: flex; gap: 12px; padding: 6px 0; }
  .commit-lane { display: flex; flex-direction: column; align-items: center; width: 16px; flex-shrink: 0; }
  .commit-dot { width: 8px; height: 8px; border-radius: 50%; background: #a78bfa; flex-shrink: 0; margin-top: 6px; }
  .commit-line { width: 2px; flex: 1; background: #2a2a3a; min-height: 8px; }
  .commit-info { flex: 1; min-width: 0; }
  .commit-msg { font-size: 12px; color: #e5e7eb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .commit-meta { display: flex; gap: 8px; margin-top: 2px; font-size: 10px; color: #6b7280; flex-wrap: wrap; }
  .commit-sha { font-family: 'JetBrains Mono', monospace; color: #a78bfa; }
  .commit-branch { background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 0 4px; border-radius: 3px; }

  /* Branches */
  .branch-item {
    display: flex; justify-content: space-between; padding: 8px 12px;
    border-bottom: 1px solid #1a1a28; font-size: 12px;
  }
  .branch-item.current { background: rgba(167, 139, 250, 0.06); }
  .branch-name { font-family: 'JetBrains Mono', monospace; }
  .current-marker { color: #10b981; font-weight: 700; margin-right: 4px; }
  .ahead { color: #10b981; font-size: 10px; margin-right: 4px; }
  .behind { color: #f87171; font-size: 10px; }

  /* PRs */
  .pr-item { padding: 10px 0; border-bottom: 1px solid #1a1a28; }
  .pr-item.merged { border-left: 2px solid #a855f7; padding-left: 10px; }
  .pr-item.closed { opacity: 0.6; }
  .pr-header { display: flex; gap: 6px; align-items: baseline; }
  .pr-number { color: #6b7280; font-size: 11px; font-family: 'JetBrains Mono', monospace; }
  .pr-title { font-size: 12px; font-weight: 600; }
  .pr-meta { display: flex; gap: 8px; margin-top: 4px; font-size: 10px; color: #6b7280; flex-wrap: wrap; }
  .pr-state { padding: 0 4px; border-radius: 3px; background: rgba(16, 185, 129, 0.15); color: #10b981; }
  .pr-branch { font-family: 'JetBrains Mono', monospace; }
  .pr-labels, .issue-labels { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
  .label { font-size: 9px; padding: 1px 6px; border-radius: 10px; background: rgba(167, 139, 250, 0.1); color: #a78bfa; }

  /* Issues */
  .issue-item { padding: 10px 0; border-bottom: 1px solid #1a1a28; }
  .issue-item.closed { opacity: 0.6; }
  .issue-header { display: flex; gap: 6px; align-items: baseline; }
  .issue-number { color: #6b7280; font-size: 11px; font-family: 'JetBrains Mono', monospace; }
  .issue-title { font-size: 12px; font-weight: 600; }
  .issue-meta { display: flex; gap: 8px; margin-top: 4px; font-size: 10px; color: #6b7280; flex-wrap: wrap; }
  .issue-state { padding: 0 4px; border-radius: 3px; background: rgba(16, 185, 129, 0.15); color: #10b981; }
  .issue-assignee { color: #a78bfa; }
</style>
