/**
 * GitHub store — manages GitHub integration data (commits, branches, PRs, issues).
 */

import { writable, derived } from 'svelte/store';

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  branch: string;
  parents: string[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  ahead: number;
  behind: number;
  lastCommit: string;
}

export interface GitPR {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
  labels: string[];
  reviewStatus: string;
}

export interface GitIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: string;
  labels: string[];
  createdAt: string;
  assignees: string[];
}

interface GitHubState {
  commits: GitCommit[];
  branches: GitBranch[];
  prs: GitPR[];
  issues: GitIssue[];
  loading: boolean;
  error: string | null;
  lastFetched: Date | null;
  activeTab: 'commits' | 'branches' | 'prs' | 'issues';
}

const initial: GitHubState = {
  commits: [],
  branches: [],
  prs: [],
  issues: [],
  loading: false,
  error: null,
  lastFetched: null,
  activeTab: 'commits',
};

export const githubStore = writable<GitHubState>(initial);

export const githubActiveTab = derived(githubStore, $s => $s.activeTab);

export function setGitHubTab(tab: GitHubState['activeTab']): void {
  githubStore.update(s => ({ ...s, activeTab: tab }));
}

export async function fetchGitHubData(repoPath: string): Promise<void> {
  githubStore.update(s => ({ ...s, loading: true, error: null }));

  try {
    const res = await fetch('/api/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch');

    githubStore.update(s => ({
      ...s,
      commits: data.commits || [],
      branches: data.branches || [],
      prs: data.prs || [],
      issues: data.issues || [],
      loading: false,
      lastFetched: new Date(),
    }));
  } catch (err) {
    githubStore.update(s => ({
      ...s,
      loading: false,
      error: err instanceof Error ? err.message : 'Ukjent feil',
    }));
  }
}

export async function pullLatest(repoPath: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch('/api/github/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pull failed');

    // Refresh data after pull
    await fetchGitHubData(repoPath);

    return { success: true, message: data.message || 'Pulled latest' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Pull failed' };
  }
}
