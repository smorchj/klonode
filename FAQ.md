# FAQ

## What is Klonode?

Klonode is a tool that scans your codebase and generates hierarchical `CONTEXT.md` files. These files act as a routing system for AI coding assistants (like Claude Code), so the AI doesn't need to waste tokens exploring your repo — it already knows where everything is.

## Who is it for?

Developers who:
- Use Claude Code, Cursor, or similar AI assistants daily
- Work on repos large enough that AI exploration eats tokens
- Want to reduce their AI API bill without losing quality

## How much does it save?

In our benchmarks on a 568-file Next.js + Three.js project, it cut average cost per task by **57%** (9 wins out of 12 tasks). The savings come from eliminating wasted search/read cycles.

## Does it work with Cursor / other AI tools?

Yes. `CLAUDE.md` and `CONTEXT.md` are plain markdown — any AI assistant that respects repo-level context files can use them. We primarily test with Claude Code.

## Will it overwrite my existing CLAUDE.md?

No. Any file containing `<!-- klonode:manual -->` is skipped during regeneration. So once you edit a `CONTEXT.md` file, Klonode will never touch it again.

## Does it need internet?

The CLI (`klonode init`) runs fully offline — pure TypeScript regex analysis, no API calls. The Workstation UI optionally calls Claude CLI or the Anthropic API when you chat with it.

## What languages does it support?

Currently: TypeScript, JavaScript, Python, Go, Rust, Svelte, Vue, Prisma, GraphQL, SQL. Java and Ruby are open issues — [help welcome](https://github.com/smorchj/klonode/labels/language-support).

## Does it send my code anywhere?

The CLI doesn't send anything anywhere. It reads files locally and writes `CONTEXT.md` files to your own repo. The Workstation UI is different — when you chat, it calls Claude (either via your local CLI or the Anthropic API), and that obviously sends code to Anthropic. But that's the same as using Claude Code directly.

## How big does a project need to be for Klonode to pay off?

Rule of thumb: if you're running Claude on a project with more than ~50 files, you'll see savings. On small projects, Claude can just read everything anyway.

## What's the 5-layer routing system?

Based on Jake Van Clief's [Interpreted Context Methodology (ICM)](https://github.com/RinDig/Interpreted-Context-Methdology):

| Layer | File | Question answered |
|-------|------|-------------------|
| 0 | `CLAUDE.md` at root | "Where am I?" |
| 1 | `CONTEXT.md` at root | "Where do I go?" |
| 2 | `CONTEXT.md` in each significant dir | "What do I do here?" |
| 3 | Reference material (types, schemas, docs) | "What rules apply?" |
| 4 | Working artifacts | "What am I working with?" |

Claude reads layer 0 first, then routes down as needed.

## Can I customize the generated context?

Yes. Edit any `CONTEXT.md`, add `<!-- klonode:manual -->` at the top, and Klonode will preserve your edits on future runs.

## Is it production-ready?

No. This is v0.1.0 alpha. Interfaces may change. But the core pipeline works end-to-end — we use it daily.

## How do I contribute?

Start with a [good first issue](https://github.com/smorchj/klonode/labels/good%20first%20issue). Setup is one `pnpm install`.

## Why is this open source?

Because AI tooling should not be a rent-seeking middleware layer between developers and models. The more this ecosystem stays open, the better it gets for everyone.
