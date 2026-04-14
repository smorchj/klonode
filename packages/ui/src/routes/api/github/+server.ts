/**
 * GitHub API endpoint — fetches git/GitHub data for the project.
 * Uses local git commands + gh CLI for GitHub-specific data.
 */

import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { RequestHandler } from './$types';

const execAsync = promisify(exec);

interface GitHubRequest {
  repoPath: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const body: GitHubRequest = await request.json();
  const cwd = body.repoPath || process.cwd();

  try {
    const [commits, branches, prs, issues] = await Promise.all([
      getCommits(cwd),
      getBranches(cwd),
      getPRs(cwd),
      getIssues(cwd),
    ]);

    return json({ commits, branches, prs, issues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ukjent feil';
    return json({ error: msg }, { status: 500 });
  }
};

async function getCommits(cwd: string) {
  try {
    const { stdout } = await execAsync(
      'git log --all --max-count=50 --format="%H|%h|%s|%an|%aI|%D|%P"',
      { cwd, timeout: 10000 },
    );
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [sha, shortSha, message, author, date, refs, parents] = line.split('|');
      const branch = refs?.match(/HEAD -> (\S+)/)?.[1] ||
        refs?.match(/origin\/(\S+)/)?.[1] || '';
      return {
        sha, shortSha, message, author, date,
        branch: branch.replace(/,\s*$/, ''),
        parents: (parents || '').split(' ').filter(Boolean),
      };
    });
  } catch {
    return [];
  }
}

async function getBranches(cwd: string) {
  try {
    const { stdout } = await execAsync(
      'git branch -a --format="%(refname:short)|%(HEAD)|%(upstream:track)"',
      { cwd, timeout: 10000 },
    );
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [name, head, track] = line.split('|');
      const aheadMatch = track?.match(/ahead (\d+)/);
      const behindMatch = track?.match(/behind (\d+)/);
      return {
        name: name.trim(),
        current: head?.trim() === '*',
        remote: name.startsWith('origin/'),
        ahead: aheadMatch ? parseInt(aheadMatch[1]) : 0,
        behind: behindMatch ? parseInt(behindMatch[1]) : 0,
        lastCommit: '',
      };
    });
  } catch {
    return [];
  }
}

async function getPRs(cwd: string) {
  try {
    const { stdout } = await execAsync(
      'gh pr list --json number,title,state,author,headRefName,baseRefName,createdAt,labels,reviewDecision --limit 20',
      { cwd, timeout: 15000 },
    );
    const prs = JSON.parse(stdout);
    return prs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state?.toLowerCase() || 'open',
      author: pr.author?.login || '',
      branch: pr.headRefName,
      baseBranch: pr.baseRefName,
      createdAt: pr.createdAt,
      labels: (pr.labels || []).map((l: any) => l.name),
      reviewStatus: pr.reviewDecision || '',
    }));
  } catch {
    return []; // gh CLI not available or not a GitHub repo
  }
}

async function getIssues(cwd: string) {
  try {
    const { stdout } = await execAsync(
      'gh issue list --json number,title,state,author,labels,createdAt,assignees --limit 20',
      { cwd, timeout: 15000 },
    );
    const issues = JSON.parse(stdout);
    return issues.map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state?.toLowerCase() || 'open',
      author: issue.author?.login || '',
      labels: (issue.labels || []).map((l: any) => l.name),
      createdAt: issue.createdAt,
      assignees: (issue.assignees || []).map((a: any) => a.login),
    }));
  } catch {
    return [];
  }
}
