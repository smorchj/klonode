# Roadmap

Klonode is early alpha. This is a rough sequence, not a firm timeline. Contributions welcome at every stage.

## v0.1 — Core pipeline ✓

- [x] Repository scanner respecting `.gitignore`
- [x] Language detection (15+ languages)
- [x] Regex-based export/import analysis
- [x] 5-layer ICM routing graph
- [x] `klonode init` CLI
- [x] Basic Workstation UI
- [x] Multi-session chat with Claude CLI
- [x] Chief Organizer (CO) agent

## v0.2 — Quality and coverage

- [ ] More language support: Java, Ruby, PHP, C#, C++
- [ ] More framework detectors: Astro, Remix, SolidJS, Deno, Bun
- [ ] AST-based analysis (via tree-sitter) for accuracy
- [ ] Unit tests across core analyzer
- [ ] Published `@klonode/cli` on npm (`npx klonode init`)
- [ ] Design polish on the Workstation UI

## v0.3 — Self-improvement

- [ ] Telemetry-driven context optimization (already stubbed)
- [ ] Closed-session analysis by CO (learn from past conversations)
- [ ] Auto-regeneration when source files change significantly
- [ ] Context diff / health dashboard in the UI

## v0.4 — Multi-agent workflows

- [ ] Per-folder tool definitions (different agents can have different permissions)
- [ ] Message bus for inter-agent communication
- [ ] Parallel task execution across multiple agents
- [ ] Agent specialization templates

## v0.5 — Distribution

- [ ] Tauri desktop app
- [ ] VS Code / Cursor extension
- [ ] Cloud-hosted demo
- [ ] npm-published packages

## v1.0 — Stable API

- [ ] Locked-in public API for `@klonode/core`
- [ ] Plugin system for custom analyzers
- [ ] Documentation site
- [ ] Stable CLI contract

## Ideas for later

- Cross-repo context (multi-project workspaces)
- Integration with GitHub Copilot context
- Native Cursor rules output
- Team telemetry sharing (opt-in)
- AI-evaluated context quality scoring

---

Something missing? Open an [issue](https://github.com/smorchj/klonode/issues/new/choose).
