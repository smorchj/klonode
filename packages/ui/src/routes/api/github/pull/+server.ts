/**
 * Git pull endpoint — pulls latest changes from remote.
 */

import { json } from '@sveltejs/kit';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { RequestHandler } from './$types';

const execAsync = promisify(exec);

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const cwd = body.repoPath || process.cwd();

  try {
    // Check for local changes (tracked + untracked)
    const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd, timeout: 10000 });
    const hasChanges = statusOut.trim().length > 0;

    let stashed = false;
    if (hasChanges) {
      // Auto-stash (including untracked) so pull can proceed
      await execAsync('git stash push -u -m "klonode-auto-stash"', { cwd, timeout: 15000 });
      stashed = true;
    }

    // Pull latest
    const { stdout, stderr } = await execAsync('git pull --ff-only', { cwd, timeout: 60000 });
    let output = (stdout + '\n' + stderr).trim();

    // Try to restore stashed changes
    if (stashed) {
      try {
        await execAsync('git stash pop', { cwd, timeout: 15000 });
        output += '\n(Local changes restored)';
      } catch (popErr: any) {
        // Merge conflict on restore — keep stash for user to resolve manually
        output += '\n(Warning: local changes kept in git stash due to conflicts)';
      }
    }

    return json({ message: output || 'Already up to date', success: true, stashed });
  } catch (err: any) {
    const msg = err.stderr || err.stdout || err.message || 'Git pull feilet';
    return json({ error: msg }, { status: 500 });
  }
};
