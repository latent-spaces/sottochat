# Per-session "turns in context" control

**Date:** 2026-07-09
**Branch:** `feat/multilingual-qa-and-session-summaries`
**Status:** approved design, pending implementation plan

## Problem

The Q&A chat assistant is seeded once per subprocess with a context envelope
(`buildChatSeed` in `src/server.ts`): the working dir, the session summary, and
the recent closed turns (latest turn generous, earlier turns brief). How many
turns ride along is hard-coded — the per-session ring buffer `recentClosedTurns`
holds the last `RECENT_CLOSED_TURNS = 5`, and the seed includes all of them.

The user wants to tune that number per session: a small +/- stepper to widen or
narrow how much recent history the assistant can see when answering.

## Scope (decisions locked during brainstorming)

- **Controls the chat Q&A context only** — `buildChatSeed`. The observer's
  session summarizer is explicitly *not* affected.
- **Per session** — each session remembers its own value (in-memory, server-side;
  the app has no persistence layer).
- **Range 1–10, default 5.** Default preserves today's behavior. Minimum is 1
  (the latest turn, always included in full); 0 is not allowed. Maximum is 10.

## Design

### Backend — `src/server.ts`

1. **Grow the ring buffer.** `RECENT_CLOSED_TURNS` 5 → 10 so the buffer can hold
   enough turns for the chat to actually reach a depth of 10.

2. **Decouple the summarizer** so growing the buffer does not silently widen
   summaries. Add `SUMMARY_DIGEST_TURNS = 5`; `buildSummaryFeed` digests
   `turns.slice(-SUMMARY_DIGEST_TURNS)` instead of the full buffer. This keeps
   summary behavior byte-for-byte identical to today.

3. **Per-session field.** Add `chatContextTurns: number` to `SessionState`,
   initialized to `5` wherever a `SessionState` is created. Include it in the
   snapshot returned by `/state` and pushed via `session:upsert`.

4. **Seed uses the field.** `buildChatSeed(s)` slices the recent turns to the
   last `s.chatContextTurns` before splitting into prior/latest:
   `const turns = s.recentClosedTurns.slice(-s.chatContextTurns);`
   The existing "latest generous, priors brief" logic is unchanged below that.

5. **New route.** `POST /chat/context-turns {sessionKey, turns}`:
   - validate `sessionKey` exists (400 otherwise), `turns` is a finite number;
   - clamp to `[1, 10]` and floor to an integer;
   - set `s.chatContextTurns`; no-op guard if unchanged;
   - broadcast ws `chat:context-turns {sessionKey, turns}`;
   - respond `{ok:true, turns}`.
   Mirrors the existing `/settings/language` handler shape.

The value is consumed only at the next `/chat/send` (seed is built there), so no
running subprocess needs to be touched when it changes.

### Frontend — `public/index.html`

1. **Stepper UI.** A `−  N  +` micro-stepper placed in `.chat-thread-head` (the
   controls row that already holds the history toggle and the clear button),
   reusing the muted-mono micro-control look of `.chat-clear-btn` (do not
   introduce a new button type). A short label ("turns" / "ctx") precedes it.

2. **Value source.** Render from `sess.chatContextTurns` (default 5 if absent).
   `−` disabled at 1, `+` disabled at 10.

3. **Interaction.** On click: clamp locally, update the session's
   `chatContextTurns` optimistically, re-render the stepper, and
   `POST /chat/context-turns {sessionKey, turns}`. Debounce/latch is not needed
   (one request per click is fine).

4. **Sync.** Handle the ws `chat:context-turns {sessionKey, turns}` message:
   update the local session object and, if that session's detail pane is open,
   re-render the stepper. Keeps multiple tabs and the optimistic click consistent.

### Data flow

```
click +/−  →  optimistic local update + re-render
           →  POST /chat/context-turns
                 →  server clamps, sets s.chatContextTurns, broadcasts
                       →  ws chat:context-turns  →  all tabs reconcile
next /chat/send  →  buildChatSeed reads s.chatContextTurns  →  seed sliced to N turns
```

## Non-goals

- No change to the summarizer's inputs or cadence.
- No global setting; no cross-session default beyond the constant `5`.
- No on-disk persistence (consistent with the rest of session state).
- No re-seeding of a live chat subprocess mid-conversation — the new depth
  applies to the next fresh send/seed, as seeds already do.

## Testing / verification

- `bun run typecheck` clean.
- Live-test on a throwaway port (`META_PORT=3943`+, **never** :3737 — owner's live
  app, fails silently).
- Assert `buildChatSeed` includes the expected number of turn separators at two
  different `chatContextTurns` values (e.g. 1 vs 5) for a session with ≥5 closed
  turns.
- `POST /chat/context-turns` clamps out-of-range input and 400s on a bad
  `sessionKey`.
- Frontend: verify stepper renders, disables at bounds, and posts, via
  `evaluate_script` (the chrome-devtools browser is wedged — no screenshots).

## Gotchas to respect

- `public/index.html` has literal `0x01` bytes — search with `grep -a`/`awk`;
  `Edit` cannot match multi-line `old_string` spanning those lines.
- Never bind :3737.
- DOM checks via `evaluate_script`, not screenshots.
