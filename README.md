# sottochat

A quiet back-channel for long autonomous agent runs.

sottochat tails your local **Claude Code**, **Claude app (local agent mode)**, and **Codex** session transcripts in real time, groups them into an inbox of live runs, and gives you a multilingual Q&A thread *about* each run — so you can understand what the agent did, discuss it in your own language, and prepare a targeted reply to paste back into the original terminal.

The name comes from *sotto voce* ("under the voice"): the agent monologues at full voice in the terminal; sottochat is your undertone conversation on the side.

## What it does

- **Live inbox** — discovers active agent sessions from local transcript files (`~/.claude`, `~/.codex/sessions`) and running processes, and keeps a stable list of recent runs.
- **Turn view** — groups raw JSONL events into turns, with compact turn/diff charts and the latest agent exchange pinned to the useful tail.
- **Multilingual Q&A** — a chat thread per session, seeded with recent turns, so you can ask "what happened, what matters, what should I answer?" in your own language.
- **Reply drafting** — when the assistant drafts something worth sending back, it appears as a copyable `to-agent` card. Copy-paste is the bridge back to the real agent.
- **Read-only by design** — sottochat never writes into the watched session, pauses the agent, or approves anything.

Full product definition: [PRODUCT.md](PRODUCT.md). Design language: [DESIGN.md](DESIGN.md).

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
- macOS or Linux (discovery paths and process scanning are only exercised there; Windows is untested)
- Anthropic auth for the Q&A and observer features: the chat subprocesses run on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk), which uses your existing Claude Code login if you have one, or an `ANTHROPIC_API_KEY` environment variable. Without either, transcript tailing still works but chat/summaries won't.

## Quick start

```sh
bun install
bun run start          # serves http://localhost:3737
```

Open <http://localhost:3737>. Any recent Claude Code or Codex session on this machine appears in the inbox; open one to see its turns and start a discussion.

## Configuration

All configuration is via environment variables (see [.env.example](.env.example)). The main ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `META_PORT` | `3737` | HTTP/websocket port |
| `META_OBSERVER_ENABLED` | `1` | Background observer that summarizes active sessions (`0` to disable) |
| `META_CHAT_MODEL` / `META_OBSERVER_MODEL` | `claude-sonnet-5` | Models used by the chat and observer subprocesses |
| `META_EXPLAIN_LANG` | `he` | Default explanation language for the Q&A thread (switchable in the UI) |
| `META_INBOX_MINUTES` | `240` | How far back the inbox looks for recent sessions |
| `META_PROJECT_SLUG` | *(unset)* | Restrict discovery to a single Claude Code project slug |

Runtime state (chat sandboxes, persistence) lives under `~/.sottochat/`.

## Development

```sh
bun run dev            # serve with hot reload
bun run typecheck      # tsc, no emit
bun test               # parser/turn tests under tests/
```

For manual testing, run a scratch instance so you don't disturb a live one:

```sh
META_PORT=3947 META_OBSERVER_ENABLED=0 bun src/server.ts
```

The frontend is deliberately build-free: plain script files under `public/assets/`, with third-party libraries vendored in [`public/assets/vendor/`](public/assets/vendor/README.md) — no bundler, no CDN tags.

## Architecture at a glance

- `src/server.ts` — Bun HTTP + websocket server; polls discovery, tails transcripts, pushes state to the SPA.
- `src/claude-discovery.ts` / `src/codex-discovery.ts` / `src/process-discovery.ts` — find candidate sessions from transcript directories and running processes.
- `src/jsonl.ts` / `src/codex-jsonl.ts` / `src/turns.ts` — parse transcript JSONL into normalized events and group them into turns.
- `src/chat-agent.ts` / `src/observer.ts` — Claude Agent SDK subprocesses for per-session Q&A and background summaries (run with an empty tool allowlist).
- `public/index.html` + `public/assets/app.js` — the no-build SPA.

## License

[MIT](LICENSE)
