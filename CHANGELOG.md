# Changelog

All notable changes to Klonode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-14

### Added
- `@klonode/core` — analyzer, generator, routing graph model
- `@klonode/cli` — `klonode init / status / optimize / update / export` commands
- `@klonode/ui` — SvelteKit workstation with multi-session chat, tree view, graph view, GitHub tab
- 5-layer ICM (Interpreted Context Methodology) routing
- Content extractor with Prisma / GraphQL / SQL schema parsing
- Auto-tool detection for 15+ frameworks and libraries
- Context quality checklist for root and folder-level CONTEXT.md
- Dual context generation (light/full) per directory
- Chief Organizer (CO) agent for project-wide context improvement
- Session persistence across chat messages via Claude CLI `--resume`
- Streaming tool-use events for live feedback in the UI
- Auto-refresh of routing graph after CO writes new CONTEXT.md files
