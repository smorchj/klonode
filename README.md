# Klonode

[![CI](https://github.com/smorchj/klonode/actions/workflows/ci.yml/badge.svg)](https://github.com/smorchj/klonode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Intelligent context routing for AI coding assistants.**

Klonode scans a codebase and generates hierarchical `CONTEXT.md` files that let Claude Code (and other AI assistants) navigate to exactly the right code without wasted tokens. It also ships a workstation UI for chatting with multiple Claude CLI sessions at once, all routed automatically through the generated context graph.

## Why

Most AI coding sessions burn tokens on exploration. Claude reads files it doesn't need, searches blindly, and loses context on long tasks. Klonode fixes this by:

- Generating a routing hierarchy once per repo (fast, regex-based scan)
- Letting you improve that hierarchy with an AI deep-read pass (the Chief Organizer agent)
- Routing every chat message through the graph so only relevant `CONTEXT.md` files are loaded
- Supporting multiple concurrent chat sessions with full streaming feedback

## Packages

| Package | Purpose |
|---------|---------|
| `@klonode/core` | Analyzer, generator, and routing graph model |
| `@klonode/cli` | `klonode init / status / optimize / update` commands |
| `@klonode/ui` | SvelteKit workstation with multi-session chat, tree view, graph view, and GitHub tab |

## Quick start

```bash
# Install dependencies
pnpm install

# Build core + CLI
pnpm --filter @klonode/core build
pnpm --filter @klonode/cli build

# Generate routing for your own project
node packages/cli/dist/cli.js init /path/to/your/project

# Start the UI
cd packages/ui && pnpm dev
# Open http://localhost:5173
```

## How it works

1. **Scan** — walk the repo respecting `.gitignore`
2. **Analyze** — detect languages, extract exports, find dependencies
3. **Generate** — write layered `CONTEXT.md` files:
   - Layer 0: `CLAUDE.md` (root DNS)
   - Layer 1: root `CONTEXT.md` (task routing table)
   - Layer 2: per-directory `CONTEXT.md` (files, exports, patterns, cross-refs)
4. **Route** — when you chat, Klonode scores your query against the graph and loads only matching `CONTEXT.md` files as context

## Project status

Early alpha. Interfaces may change. See `CONTRIBUTING.md` for how to help.

## License

[MIT](LICENSE)
