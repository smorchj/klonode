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
- Run `pnpm --filter @klonode/core test` — all tests must pass and your change should add tests for the new behavior
- Add or update `CONTEXT.md` files if you change public APIs
- Keep commits focused and descriptive
- No node_modules, no .env, no test artifacts
- Link the issue your PR closes in the description (e.g. `Closes #30`)
- One issue per PR — bundling unrelated changes makes review slower

## Good first contributions

The shortest path to a merged PR is the language and framework gaps tracked in [#56 — Generalizability audit](https://github.com/smorchj/klonode/issues/56). Each gap is one regex block in one file, with a worked reference PR (#13 added Python, Java, and Ruby in 104 lines).

- **Language support** — add extractors for new languages in `packages/core/src/analyzer/content-extractor.ts` (Go #17, Rust #18, PHP #15, C# #16, Kotlin #19)
- **Tool detectors** — add new framework signatures in `packages/core/src/analyzer/tool-detector.ts` (Rails #25, Django #24, FastAPI #23, Remix #20, SolidJS #21, Qwik #22)
- **Schema parsers** — Drizzle, TypeORM, SQLAlchemy, Django models, Rails ActiveRecord (file a sub-issue first)
- **Context checklists** — extend `packages/core/src/generator/context-checklist.ts` with folder-specific quality rules
- **UI polish** — ChatPanel, GitHubView, GraphView improvements in `packages/ui/src/lib/components/`

## What we won't merge

- Changes that remove types or tests
- Mass stylistic rewrites
- Badly written code (whether human- or AI-generated) — every PR needs to read clearly, follow project conventions, and have intent the reviewer can verify
- Features without a clear use case

## How PRs are reviewed

We review every PR on the merits — first-time contributors are welcome and we don't auto-decline anyone. To set expectations, here's the bar your PR has to clear, especially for security-related changes:

- **Scope matches the description.** The diff does what the title and body say it does, no more.
- **Tests assert what they claim.** New tests actually exercise the new code path. We spot-check by reading the assertions against the implementation.
- **No silent regressions.** Existing tests still pass and your change doesn't drop existing behavior without a stated reason.
- **No new dependencies without justification.** Adding a package needs a one-line "why" in the PR body.
- **No obfuscation.** Encoded blobs, indirected execution, dynamic `eval`/`Function`, network calls in unexpected places, and shell commands all get extra scrutiny. If your fix needs any of these, explain why in the PR body up front.
- **Security PRs get a stricter read.** A "fix for issue #X" that introduces a subtle weakness or forgets a code path will be sent back for revision. We'd rather merge a smaller correct fix than a larger one with gaps.

If a PR doesn't clear the bar, we'll leave a review with what to change rather than closing — fix it and we'll merge.

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
