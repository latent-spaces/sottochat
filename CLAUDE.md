# sottochat — agent instructions

Bun + TypeScript server (`src/server.ts`, port 3737) that tails Claude Code /
Codex session jsonl files and serves a no-build SPA (`public/index.html` +
`public/assets/app.js`) over websocket. Product source of truth: `PRODUCT.md`.
Design language: `DESIGN.md`. Session handoff brief: `state.html` (local
working doc, gitignored — never commit it).

## Commands

- `bun run start` — serve on :3737 (the owner's live instance — don't restart it casually)
- `META_PORT=3947 META_OBSERVER_ENABLED=0 bun src/server.ts` — scratch instance for testing
- `bun run typecheck` — tsc, no emit
- `bun test` — parser/turn tests under `tests/` (rooted there via `bunfig.toml`)

## Definition of done for UI changes

Static checks are not enough — `node --check` has repeatedly passed on UI that
was broken in the browser. Before calling a UI change done, run the smoke pass
against a scratch instance (chrome-devtools MCP or a real browser):

1. Load `http://localhost:3947/` — title/wordmark render, session cards appear,
   zero console errors.
2. Open a session — detail header, charts band, preset chips, ctx stepper render.
3. Click a preset chip (or send a message) — the user chunk appears, the chat
   subprocess spawns (`[chat] spawned` in the server log), and an assistant
   reply lands in the thread.

Note: the detail pane re-renders on every ws tick, so uid-based clicks from
devtools snapshots go stale — drive clicks via `evaluate_script` selectors.

## Conventions

- Runtime state lives under `~/.sottochat/` (chat sandboxes, observer cwd,
  `state.json` persistence). Legacy roots `~/.cut-the-cake`/`~/.chunk-to-chat`
  are matched for classification only — never write there.
- SDK subprocesses (chat, observer) run with `tools: []` — keep it an
  allowlist; do not reintroduce deny-lists.
- The frontend is deliberately build-free: plain script files under
  `public/assets/`, vendored third-party libs in `public/assets/vendor/`.
  No CDN script tags.
- `notes/archive/` is historical; do not plan from it.
