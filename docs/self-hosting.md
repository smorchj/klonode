# Self-hosting Klonode

This doc is for the case where you're using Klonode's Workstation to edit
Klonode itself — chatting with Claude inside the Workstation about changes to
`packages/ui/`, `packages/core/`, or `packages/cli/`, and having Claude apply
them while you keep the conversation going.

It explains which edits are safe during an active chat, which ones interrupt
things, and what survives a reload when they do.

## The short version

| You edit… | What happens | Conversation survives? |
|---|---|---|
| `packages/ui/src/lib/components/**/*.svelte` | Hot module replacement — component re-mounts | **Yes**, including streaming responses |
| `packages/ui/src/lib/workstation/**` | Hot module replacement | **Yes** |
| `packages/ui/src/lib/utils/**` | Hot module replacement | **Yes** |
| `packages/ui/src/lib/stores/**/*.ts` | Full page reload | History **yes**, in-flight stream **no** |
| `packages/ui/src/routes/api/**/+server.ts` | Dev server restart | History **yes**, in-flight stream **no** |
| `packages/ui/vite.config.*`, `svelte.config.*`, `package.json` | Dev server restart | History **yes**, in-flight stream **no** |
| `packages/core/**`, `packages/cli/**` | Library rebuild by `tsup --watch` | **Yes** — UI doesn't import these at runtime |

## What persists

As of the self-hosting survival work, everything that lives in a Svelte store
is persisted to `localStorage` and rehydrated on reload:

- **Session tabs** (`sessions[]`, `activeSessionId`) — `klonode-sessions` key.
- **Per-session CLI session IDs** (`cliSessionIds`) — so the next message after
  a reload **resumes the same Claude conversation** instead of spawning a
  fresh one. This is the single most important thing for self-hosting —
  without it, every edit to a store file or API route would cost you Claude's
  accumulated context.
- **Chat messages** (`klonode-chat` key, last 80 messages) — the user-facing
  chat history survives reloads so you don't lose scrollback.
- **Per-session message backlog** (`sessions.messages[sid]`, last 50
  per session) — used by the agents API / CO analysis path.
- **Settings** (`klonode-settings`) — unchanged, was already persisted.
- **CO memory** — unchanged, was already persisted as part of `sessions`.

What's **not** persisted:
- `isLoading`, `error`, `lastComparison` — transient UI state.
- `streamingText` / `activityLog` / `abortController` in ChatPanel — these
  live on the component and don't survive a remount. A response mid-stream
  at reload time is flagged as `interrupted` on the persisted message.

## How to tell if an edit is about to interrupt a stream

The chat header shows a pulsing `● streaming` badge while a response is in
flight. Hover it for a tooltip. If that badge is lit, prefer to wait or edit
a component file (which HMR-reloads without losing the stream).

A response that was interrupted by a reload is rendered with a
`⚠ response interrupted by reload` banner in the chat log, and the
corresponding message's `interrupted` flag is set to `true`. The next
assistant response clears the flag.

## Risky edit playbook

If you really need to edit a store or an API route while a stream is in
flight:

1. Let the current response finish (watch the streaming badge).
2. Make the edit.
3. Vite will do a server restart + full page reload. State rehydrates
   from localStorage.
4. Send your next message. Because `cliSessionIds` survived, Claude picks
   up the same conversation and keeps its accumulated context.

If you edit mid-stream anyway, the partial response is lost but the
conversation itself is fine — the user message and the `[interrupted]`
assistant message are in your history, and you can ask Claude to redo the
interrupted step.

## Files worth avoiding unless you have a reason

A short list of places where one-line edits cause the most disruption:

- `packages/ui/src/routes/api/chat/stream/+server.ts` — the SSE stream
  endpoint. Any edit severs every in-flight stream across all open
  Workstation tabs.
- `packages/ui/src/lib/stores/agents.ts` — the session store. A reload is
  the only way Vite can propagate a store shape change, and it takes the
  current stream with it.
- `packages/ui/vite.config.js` / `svelte.config.js` — forces a full Vite
  restart, not just a page reload. You'll lose localStorage session
  association for the tab if you happen to have open window state that's
  not persisted there.

## Implementation pointers

- Hydrate / save: `packages/ui/src/lib/stores/chat.ts` and
  `packages/ui/src/lib/stores/agents.ts` — look for `loadChatState`,
  `saveChatState`, `loadState`, `saveState`.
- CLI session ID helpers: `getCliSessionId`, `setCliSessionId`,
  `clearCliSessionId` in `agents.ts`.
- UI indicators: `.stream-badge` and `.interrupted-banner` in
  `ChatPanel.svelte`.
