# Contributing to Klonode

Thanks for your interest. Klonode is early alpha — small focused PRs are the easiest to review and land.

## Setup

```bash
pnpm install
pnpm --filter @klonode/core build
pnpm --filter @klonode/cli build
cd packages/ui && pnpm dev
```

## Project structure

- `packages/core/` — analyzer, generator, routing graph model. Pure TypeScript, no browser APIs.
- `packages/cli/` — `klonode` command (init, status, optimize, update).
- `packages/ui/` — SvelteKit workstation. Chat panel, tree view, graph view, GitHub tab.

## Before you open a PR

- Run `pnpm --filter @klonode/core build` — must compile cleanly
- Add or update `CONTEXT.md` files if you change public APIs
- Keep commits focused and descriptive
- No node_modules, no .env, no test artifacts

## Good first contributions

- **Language support** — add extractors for new languages in `packages/core/src/analyzer/content-extractor.ts`
- **Tool detectors** — add new framework/tool signatures in `packages/core/src/analyzer/tool-detector.ts`
- **Context checklists** — extend `packages/core/src/generator/context-checklist.ts` with folder-specific quality rules
- **UI polish** — ChatPanel, GitHubView, GraphView improvements in `packages/ui/src/lib/components/`

## What we won't merge

- Changes that remove types or tests
- Mass stylistic rewrites
- Badly written code (whether human- or AI-generated) — every PR needs to read clearly, follow project conventions, and have intent the reviewer can verify
- Features without a clear use case

## Code style

- TypeScript strict mode
- No implicit `any`
- Prefer explicit over clever
- Match the style of the file you're editing

## Reporting issues

When filing a bug, include:
- Klonode version (`klonode --version`)
- Node version
- OS
- Minimal reproduction steps
- Expected vs actual behavior

Vague issues without reproduction get closed.
