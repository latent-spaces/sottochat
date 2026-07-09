# ask in your language: conversational Q&A over the latest exchange

**Date:** 2026-07-09
**Status:** implemented

## Goal

Replace the observer's auto "chunk → prefill prompt" mechanic with a
user-initiated, multilingual conversational assistant.

Instead of the app pre-writing a message for you to hand back to the agent, you
read the agent's latest output and ask plain-language questions **in your own
language**. The assistant explains in that language and — only when it's useful —
also drafts a reply **to the coding agent, in the agent's language**, shown as a
copyable block you paste into your terminal.

The observer stays but narrows to its glance role: a one-line insight (now in
your language) that tells you a turn is worth a look. It no longer writes
prefills and no longer auto-sends anything.

## Background: what exists today

The core loop is `tailer → turns → observer → chat`.

- `turns.ts` closes a turn on a `stop` event or a new user message.
- On close, `observer.feed(...)` queues the turn; every 30s the observer drains
  the queue into one `query()` against a long-lived `claude-sonnet-4-6`
  subprocess (`observer.ts`).
- The observer's `DECISIONS_INTRO` prompt asks it, per turn, whether to `open`,
  write a ≤14-word `insight`, and — when open — a ≤14-word `prefill`: a
  second-person imperative addressed to the coding agent (`observer.ts:70-102`,
  `GateDecision` at `observer.ts:35-42`).
- The `insight` shows on the sidebar card; the `prefill` is injected as the
  **initial value of the chat textarea** (`index.html` `renderChatInput`), which
  the user edits and sends via `/chat/send`.
- `maybeAutoSendChat` (`server.ts:256-275`) can auto-fire the prefill into the
  chat host; the **auto break-down** nav toggle (`/chat/auto-send`) drives it.
- `chat-agent.ts` is a generic, persistent `claude` subprocess per session,
  tools disabled, text-in/text-out. `send()` forwards **any** text verbatim, so
  it can already take questions in any language. Its `SYSTEM_INTRO` is an English
  "break it down companion" persona, prepended to the first message only; context
  is an optional `seed` (observer insight + turn excerpts) on that first message.

**Key architectural fact:** the app only *reads* the session transcript
(`jsonl`). It has **no write channel into the user's terminal**. Today's prefill
never reaches the real coding agent — sending it spins up a *separate* `claude`
subprocess. Therefore "send a reply back to the agent" can only mean: the app
drafts the text and the user pastes it into their terminal.

## Decisions

1. **Observer** — keep the one-line insight (retargeted to the selected
   language); drop `prefill` and drop auto-send.
2. **Suggested reply** — a copyable block in the *agent's* language, pasted into
   the terminal. (The only path that reaches the real session.)
3. **Context** — the session's latest exchange, auto-fed. No pasting.
4. **Language** — a global, curated dropdown: **Hebrew (default)**, English,
   Arabic, Spanish, French, Russian, German, Chinese. Persisted in
   `localStorage`. Drives the user-facing side only (explanations + observer
   insight); the suggested reply always stays in the agent's language.

## Design

### language setting

- A single **global** `explainLanguage` (one of the eight codes). Default `he`.
- **Frontend:** a dropdown in the top nav, in the slot vacated by the removed
  auto break-down toggle. Styled in the existing nav-toggle pill vocabulary so it
  is not a new button type (DESIGN.md: no third button type).
- Persisted in `localStorage`; on change, POST to the server, which holds it as
  global state and broadcasts it so all clients agree. Threaded into the chat and
  observer prompts.

### the assistant (`chat-agent.ts`)

- Rewrite `SYSTEM_INTRO` into a **parameterized** persona:
  - answer in the selected language, plainly, about the coding agent's output;
  - when — and only when — the user is deciding what to tell the agent, ALSO
    draft a suggested reply for them to send, written in **the agent's own
    language** (the language the agent is writing in, typically English), wrapped
    in a single fenced block tagged `to-agent`; otherwise omit the block.
- **Seed** (first message) = the **latest exchange** (prev-agent → you → agent
  excerpts). Repoint the existing seed builder off the observer insight/prefill
  and onto the latest turn text.
- Model unchanged (`claude-sonnet-4-6`).
- **Language currency:** the persona is set on the first message, but the
  language can change mid-session. `send()` takes the current language; the
  per-agent `push` sets the persona in that language on the first message, and on
  later messages injects a one-line `(from now on, answer in <lang>.)` directive
  **only when the language actually changed** — no per-message pollution in the
  common case, and no respawn.

### the reply marker

- Convention: a fenced code block ` ```to-agent … ``` `.
- The frontend post-processes each assistant message: any fenced block whose
  language is `to-agent` renders as a **"suggested reply → copy to agent"** card
  (LTR, mono, one-click copy) instead of a normal code block. The rest of the
  message renders as normal markdown, RTL-aware.
- Chosen over structured JSON so the streaming, conversational prose UX stays
  intact.

### observer (`observer.ts`)

- `DECISIONS_INTRO`: drop the `prefill` instruction and the ≤14-word prefill
  budget; keep the `open` / `insight` decision; instruct the `insight` to be
  written in the selected language.
- `GateDecision` and `ObserverInsight`: remove `prefill`.
- `server.ts`: remove the `maybeAutoSendChat` call on decision; keep storing and
  broadcasting the `insight` (`observer:decision`).
- Observer `feed` is unchanged (still assistant prose + aggregate metrics).

### server wiring (`server.ts`)

- Add global `explainLanguage` state; thread it into observer prompts and chat
  sends.
- Retire `/chat/auto-send` and its state/broadcast.
- Add a small setter (e.g. `POST /settings/language`) that updates the global and
  broadcasts it.
- `/chat/send` and the `chat:chunk` / `chat:status` stream are otherwise
  unchanged.

### frontend (`public/index.html`)

- Remove the auto break-down toggle; add the language dropdown in its place.
- `renderChatInput`: localize the ask-box placeholder to the selected language,
  `dir="auto"` on the textarea, drop prefill seeding (`DEFAULT_PREFILL`,
  `latestFlag` textarea seed). The context line drops the prefill affordance;
  the plain insight may remain as a quiet glance line.
- Chat message renderer: `dir="auto"` on message bodies (RTL-aware); detect the
  `to-agent` fenced block and render the copy card.
- Chrome stays English + lowercase + strawberry. Only user-facing content (your
  questions, the explanations) is RTL/localized. The ask-box placeholder is the
  one localized chrome string.

## Non-goals

- No write channel into the real terminal; copy-paste is the bridge, by design.
- No per-session language (global only).
- No RTL flip of the app chrome.
- No change to `tailer`, `turns`, discovery, `triggers`, or the charts.

## Risks & edge cases

- **Marker leakage:** if the assistant emits ` ```to-agent ` inconsistently, the
  copy card won't render. Mitigation: a tight, explicit instruction + the
  frontend falls back to rendering it as a normal fenced block (never breaks).
- **Language change mid-conversation:** handled by threading current language per
  send; worst case a single answer lags one turn.
- **Dangling `prefill` / auto-send references:** removing them touches
  `observer.ts`, `server.ts`, and `index.html`; `bun typecheck` must be clean and
  a grep for `prefill` / `auto-send` / `autosend` / `maybeAutoSendChat` must come
  back empty (outside history).
- **Mixed-direction text:** `dir="auto"` per message body keeps Hebrew RTL and
  the English `to-agent` card LTR without a global flip.

## Verification

1. `bun typecheck` — clean; no dangling `prefill` / auto-send references.
2. Launch `bun src/server.ts` and drive it:
   - pick a session; the language dropdown shows, defaults to Hebrew, persists
     across reload; the auto break-down toggle is gone; `/chat/auto-send` 404s.
   - ask a plain question → explanation renders in the selected language, RTL.
   - ask a "what should I answer" question → a `to-agent` copy card renders in
     the agent's language; copy works.
   - switch language → the next answer (and the observer insight) follow it.
   - no message is auto-sent; everything is user-initiated.
