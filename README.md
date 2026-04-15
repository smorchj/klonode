# Klonode

[![CI](https://github.com/smorchj/klonode/actions/workflows/ci.yml/badge.svg)](https://github.com/smorchj/klonode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![good first issues](https://img.shields.io/github/issues/smorchj/klonode/good%20first%20issue?color=7057ff)](https://github.com/smorchj/klonode/labels/good%20first%20issue)

> **Cut your Claude Code token bill in half.** Klonode scans any codebase and generates intelligent `CONTEXT.md` files so AI assistants navigate straight to the right code — no wasted exploration.

## The problem

Every Claude Code session burns tokens on the same thing: searching. Claude reads files it doesn't need, greps blindly, and asks "where is X?" before it can fix anything. On a large project, half your API bill pays for exploration.

## The fix

Klonode runs once over your repo and builds a 5-layer routing graph:

```
CLAUDE.md              ← "where am I?"     (always loaded, 800 tokens)
├── CONTEXT.md         ← "where do I go?"   (task routing, 300 tokens)
│   ├── app/CONTEXT.md        ← domain-specific details (1500 tokens)
│   ├── game/CONTEXT.md
│   └── prisma/CONTEXT.md
└── ...
```

Claude reads `CLAUDE.md` → picks the right folder → reads only that `CONTEXT.md` → knows exactly which files to open. No more blind search.

## Measured savings

In internal benchmarks across 12 tasks on a 568-file Next.js + Three.js project:

| Metric | Without Klonode | With Klonode | Saved |
|--------|----------------|--------------|-------|
| Avg tokens / task | 137K | 71K | **48%** |
| Avg cost / task | $0.21 | $0.09 | **57%** |
| Wins out of 12 | — | 9 | **75%** |

## Quick start

```bash
# 1. Install
git clone https://github.com/smorchj/klonode.git
cd klonode
pnpm install
pnpm --filter @klonode/core build
pnpm --filter @klonode/cli build

# 2. Generate routing for your own project
node packages/cli/dist/cli.js init /path/to/your/project

# 3. Start the workstation UI (optional)
cd packages/ui && pnpm dev
# → http://localhost:5173
```

That's it. Open Claude Code in your project directory and it will pick up `CLAUDE.md` automatically.

## What you get

### 1. The CLI
- `klonode init` — scan + generate routing graph + `CONTEXT.md` files
- `klonode status` — see routing coverage and health
- `klonode optimize` — self-improve routing from access telemetry
- `klonode export` — dump the routing graph as JSON

### 2. The Workstation UI
A SvelteKit app for working with multiple Claude sessions at once:
- **Multi-session chat** — run 4+ Claude CLIs in parallel, each on a different task
- **Chief Organizer (CO) agent** — full-repo access with Opus 1M context for project-wide work
- **Tree + graph view** of your routing structure
- **GitHub tab** showing commits, branches, PRs, and issues
- **Live tool-use stream** — see every file Claude reads or edits in real time

### 3. The Core Library
`@klonode/core` — analyzer, generator, routing graph. Pure TypeScript, no browser APIs. Embed it in your own tooling.

## Comparison

| | Klonode | Cursor rules | `.cursorrules` | Manual CLAUDE.md |
|---|---------|--------------|----------------|-------------------|
| Automatic generation | ✓ | ✗ | ✗ | ✗ |
| Scales to large repos | ✓ | ⚠ | ✗ | ✗ |
| Per-directory context | ✓ | ✗ | ✗ | ✗ |
| Reads actual source | ✓ | ✗ | ✗ | ⚠ |
| Works with any AI assistant | ✓ | Cursor only | Cursor only | Claude only |
| Self-improving via telemetry | ✓ | ✗ | ✗ | ✗ |

## Packages

| Package | Purpose |
|---------|---------|
| [`@klonode/core`](packages/core) | Analyzer, generator, routing graph model |
| [`@klonode/cli`](packages/cli) | `klonode init / status / optimize / update / export` |
| [`@klonode/ui`](packages/ui) | SvelteKit workstation |

## How it works

1. **Scan** — walk the repo respecting `.gitignore`, detect languages
2. **Analyze** — extract exports, API routes, dependencies, patterns
3. **Build graph** — classify directories into 5 ICM layers (based on [Jake Van Clief's Interpreted Context Methodology](https://github.com/RinDig/Interpreted-Context-Methdology))
4. **Generate** — write `CLAUDE.md` (L0), root `CONTEXT.md` (L1), and per-directory `CONTEXT.md` (L2) files
5. **Route** — when you query via the UI, Klonode scores the query against the graph and loads only matching `CONTEXT.md` files as context

## Status

🚧 **Early alpha** (v0.1.0). Interfaces may change. Core pipeline works end-to-end.

## Contributing

We actively want contributors. Start with [good first issues](https://github.com/smorchj/klonode/labels/good%20first%20issue) — adding language support, framework detectors, or UI polish are all great entry points.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

## License

[MIT](LICENSE)

---

If Klonode saves you tokens, a ⭐ helps others find it.
