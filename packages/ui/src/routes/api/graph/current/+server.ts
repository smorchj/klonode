/**
 * GET /api/graph/current
 *
 * Returns the routing graph for the actual project the Workstation backend
 * is running in. Reads `.klonode/graph.json` from the server's cwd (or from
 * a path supplied via the `repoPath` query string). If no graph exists, the
 * endpoint responds 404 so the client can fall back to the bundled demo
 * fixture.
 *
 * Without this endpoint the Workstation always loaded `/demo-graph.json`
 * at boot, so every user saw a fake `demo-project` tree with `app / lib /
 * tests` folders no matter which real repo they had Klonode running in.
 */

import { json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { RequestHandler } from './$types';

/**
 * Walk up from `start` looking for `.klonode/graph.json`. Returns the
 * directory that contains it, or `null` if we hit the filesystem root.
 *
 * This is needed because the dev server's cwd is usually `packages/ui/`
 * (where launch.json's `cwd` points), not the repo root. A fresh user
 * running `pnpm dev` inside any package should still see their project's
 * real graph, not the bundled demo fixture.
 */
function findKlonodeRoot(start: string): string | null {
  let dir = start;
  const { root } = { root: dir.match(/^[A-Z]:\\|^\//)?.[0] ?? '/' };
  let guard = 0;
  while (dir && dir !== root && guard++ < 50) {
    if (existsSync(join(dir, '.klonode', 'graph.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export const GET: RequestHandler = async ({ url }) => {
  const explicit = url.searchParams.get('repoPath');
  const startDir = explicit || process.cwd();
  const repoPath = explicit && existsSync(join(explicit, '.klonode', 'graph.json'))
    ? explicit
    : findKlonodeRoot(startDir);

  if (!repoPath) {
    return json(
      {
        error: 'no .klonode/graph.json found walking up from server cwd',
        searchedFrom: startDir,
        hint: 'run `klonode init` in your project root, or pass ?repoPath=<abs> to target a specific project',
      },
      { status: 404 },
    );
  }

  const graphPath = join(repoPath, '.klonode', 'graph.json');

  try {
    const raw = readFileSync(graphPath, 'utf-8');
    const graph = JSON.parse(raw);
    // Make sure repoPath is set to the server's cwd even if the stored
    // graph was generated on another machine.
    if (!graph.repoPath || graph.repoPath === '' || graph.repoPath === '/path/to/your/project') {
      graph.repoPath = repoPath;
    }
    return json(graph);
  } catch (err) {
    return json(
      {
        error: 'failed to parse .klonode/graph.json',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
