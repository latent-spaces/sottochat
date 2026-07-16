# Editable session/card name + trimmed Hebrew preset chips

**Date:** 2026-07-16
**Branch:** `agent/publish-sottochat-cli`
**Status:** approved design, pending implementation plan

## Part 1 — Click-to-rename session cards

### Problem

The name shown on an inbox card and in the session detail header is always
computed live from `cwd` (`sessionName()` / `projectName()` in
`public/assets/app.js:278`) — there's no way to give a session a name of your
choosing.

### Scope (decisions locked during brainstorming)

- Editable from **both** the inbox card title and the detail pane header
  (`#d-name`).
- The override **persists to disk** (`~/.sottochat/state.json`), surviving
  server restarts, alongside the other per-session state already stored there.
- Clearing the field (empty submit) **removes the override** and reverts to
  the auto-derived name.
- Applies uniformly to regular sessions and chat-agent sessions (a custom name
  takes priority over the computed `"<project> · chat"` `displayName`).

### Data model — `src/persistence.ts`

Add `customName?: string` to `PersistedSession`, next to `summary` /
`chatContextTurns`.

### Server — `src/server.ts`

- Add `customName?: string` to `SessionState` (near `summary`).
- `getOrCreate()`: hydrate `s.customName` from `persistedSessions.get(k)` the
  same way `summary`/`chatContextTurns` are hydrated today.
- `collectPersisted()`: include `...(s.customName ? { customName: s.customName } : {})`.
- `snapshot()`: include the same, so clients receive it.
- New route, modeled directly on the existing `/chat/context-turns` handler:

  ```
  POST /session/rename
  body: { sessionKey: string, name: string }
  ```

  - 400 if `sessionKey` missing/unknown, or `name` isn't a string.
  - Trim `name`. If empty after trimming: `delete sess.customName` (revert to
    auto-derived). Otherwise `sess.customName = trimmed`.
  - No-op guard: skip the mutation/broadcast if the value is unchanged.
  - `persister.schedule()`.
  - `broadcast({ kind: "session:rename", sessionKey, customName: sess.customName ?? null })`
    so every connected client — not just the one editing — updates.

### Client — `public/assets/app.js`

- `sessionName()` (line 278): check `infoOrSess.customName` first, before
  `displayName` and the cwd-derived fallback.
- Ws handler: add a `session:rename` case next to `chat:context-turns`
  (~line 2548) — look up `sessionsByKey.get(msg.sessionKey)`, set or delete
  `s.customName`, `refresh()`.
- **Click-to-edit, card title:** the whole card is an `<a>` (`buildCard`,
  line ~1009), so a plain click on the `<h3>` would also navigate. Add
  `class="card-title"` to the `<h3>`, and one delegated `click` listener on
  `cardsEl` (added once at setup — safe against the per-card `innerHTML`
  rebuilds) that matches `.card-title`, calls `preventDefault()` +
  `stopPropagation()`, and enters edit mode for that card's session.
- **Click-to-edit, detail header:** `#d-name` is a plain element, not inside a
  link — a direct click listener is enough, no delegation needed.
- **Edit-state survives re-render:** both the card grid and the detail pane
  rebuild their `innerHTML` on every `refresh()` tick (ws events, periodic
  ticks), which would otherwise blow away an in-progress edit. Reuse the
  pattern already used for the chat textarea in `dChatInput` (capture the
  in-progress value + focus/selection before rebuild, re-render an `<input>`
  in place of the name instead of the static text/`<h3>`, restore
  focus+selection after). Track "which session is currently being renamed"
  as one shared piece of state (a session can only be edited in one place at
  a time), so both surfaces use the same in-progress draft.
- **Commit / cancel:** Enter or blur commits (`POST /session/rename`); Escape
  cancels and restores the previous text without sending anything. Input gets
  `stopPropagation()` on `keydown` so nothing else on the page reacts to
  keystrokes while editing (there's no global keydown shortcut today, but this
  keeps it inert regardless).

### Non-goals

- No length limit or content validation beyond trimming.
- No indicator of "this name was manually overridden" vs. auto-derived (no
  reset-to-default affordance beyond clearing the text).
- No rename history / undo beyond the immediate Escape-to-cancel.

### Testing / verification

- `bun run typecheck` clean.
- Scratch instance (`META_PORT=3947 META_OBSERVER_ENABLED=0 bun src/server.ts`).
- Via `evaluate_script`:
  - clicking a card title enters edit mode without navigating to the session;
  - Enter commits, `GET /state` (or a second ws client) reflects the new name;
  - Escape restores the original text and sends nothing;
  - clearing the text and committing reverts to the auto-derived name;
  - renaming from the detail header updates the corresponding card, and
    vice versa;
  - a background refresh tick (e.g. another session's event) while mid-edit
    does not clobber the in-progress input.

## Part 2 — Trim + reword the Hebrew preset chips

### Problem

`UI_STRINGS.he.presets` (`public/assets/app.js:30`) currently lists five
chips. Only two should remain, and one changes wording.

### Change

```
presets: ["תסכם בקצרה", "מה כתוב פה"]
```

(was `["תסכם", "הסבר במילים פשוטות", "מה כתוב פה", "מה קרה כאן?", "מה לענות?"]`).
Order kept as in the current array (summarize-style chip first, then
"what does this say"); flag if you'd rather have "מה כתוב פה" first.

No rendering changes needed — `renderChatInput` already maps over
`ui().presets` generically (`app.js:2085`), with no hardcoded count.

### Non-goals

- No changes to any other language's preset list.
- No changes to the preset chip mechanism itself.

### Testing / verification

- Via `evaluate_script` with the language set to Hebrew: exactly two chips
  render, in RTL, reading "תסכם בקצרה" and "מה כתוב פה"; clicking the first
  sends "תסכם בקצרה" as the chat message.
