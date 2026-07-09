# Strip the video/preview systems + collapsible sidebar

**Date:** 2026-07-09
**Status:** approved (design), pending implementation plan

## Goal

Cut both video-generation systems out of cut-the-cake entirely, leaving the
core loop — **tailer → turns → observer → chat** — plus the code-changes chart.
Along the way, fix the "jsonl" session leak and make the sessions sidebar
collapse to a thin rail.

The product's stated purpose (PRODUCT.md) is "turn long autonomous agent runs
into a quick, iterative chat" via the observer's one-sentence insight + editable
prefill. The video/preview machinery was an experiment layered on top; it is not
part of that core and is being removed.

## Background: what exists today

There are **two separate video systems**, both bolted onto the core app, plus
the core itself.

| System | Backend | UI |
|---|---|---|
| **New composer preview** | `composer.ts` → authors a HyperFrames `index.html` per closed turn (SDK subprocess under `~/.cut-the-cake/composer/`) | `.composer-pane` ("COMPOSER PREVIEW", demo / from-latest buttons) |
| **Legacy video pane** | `scriptifier.ts` (karaoke beats, card shows as "design" after its default marker-vocab) + `infographer.ts` (info-graphic pills) + `tts.ts` (audio via `npx hyperframes tts/transcribe`) | `.video-pane-legacy` ("PREVIOUS VIDEO PANE · legacy") |
| **Core (keep)** | `tailer` → `turns` → `observer` (insight + prefill) → `chat-agent`; `triggers.ts` opens an inbox thread on a significant turn; `registry` + discovery modules | sessions inbox, code-changes chart, LATEST EXCHANGE chat, "auto break-down" toggle |

The frontend is a single-file SPA: `public/index.html` (~312 KB, inline JS+CSS)
fed by the backend over WebSocket/SSE. The backend is `src/*.ts` run by Bun
(`bun src/server.ts`, port 3737).

## Scope

### 1. Remove — backend

**Delete files:**
- `src/composer.ts`
- `src/scriptifier.ts` (the "design" card)
- `src/infographer.ts`
- `src/tts.ts`
- `src/hyperframes-export.ts` (mp4 export; video-only — verify no other caller during implementation)

**Remove the `hyperframes` devDependency** from `package.json` — used only by
`tts.ts` (`npx hyperframes tts/transcribe`) and `hyperframes-export.ts`, both
deleted. (Invoked via `npx`, not imported, but the declaration becomes dead.)

**Surgical edits to `src/server.ts`:**
- Imports of the deleted modules (`startScriptifier`, `SCRIPT_STYLES`,
  `MARKER_VOCABS`, `ScriptBeat`, `ScriptStyle`, `MarkerVocab`,
  `startInfographer`, `Pill`, `generateTts`, `ttsAudioPath`, `WordTiming`,
  `exportToMp4`, `exportMp4Path`, `startComposer`, `composerRootDirFor`,
  `composerSafeKey`, `ComposerEvent`).
- State: `ScriptPayload` / `PillPlanPayload` / composer state maps
  (`scriptPayloads`, `pillPlans`, composer map), `activeScriptStyle`,
  `activeMarkerVocab`, and their `SessionState`/broadcast fields.
- Routes: `/composer/*`, `/tts/*`, `/debug/inject-script`,
  `/debug/inject-composer`, `/debug/marker-vocab`, and the mp4-export route.
- Fixtures: `DEMO_BEATS`, `DEMO_PILLS`, the demo-composition HTML string,
  `prunePillPlans`.
- SSE broadcasts: `pills:beats`, script payloads, composer events — and the
  turn-close / trigger wiring that fires the scriptifier / infographer / tts /
  composer subprocesses.

**Keep (core, do not touch):** `triggers.ts` (`evaluateTurn` →
`maybeOpenThread` → `thread:new` is the core inbox gate, not video), `observer.ts`,
`chat-agent.ts`, `tailer`, `turns`, `registry`, `jsonl`, `claude-discovery`,
`codex-discovery`, `codex-jsonl`, `process-discovery`, and the **"auto break-down"**
toggle (it is the observer auto-send control — `autosend-toggle` — not video).

### 2. Remove — frontend (`public/index.html`)

- **CSS:** `.composer-pane*`, `.video-pane-legacy*`, and the karaoke player /
  pill / style-vocab-picker styles.
- **Markup:** the "COMPOSER PREVIEW" block, the "PREVIOUS VIDEO PANE" block, the
  style/vocab picker, and the "demo preview" / "from latest turn" buttons.
- **JS:** the WebSocket/SSE handlers for `pills:beats` / script / composer
  messages, the karaoke video player, pill rendering, tts audio playback, the
  composer iframe logic, and the demo / from-latest handlers.
- **Resulting detail-pane layout:** session header → code-changes chart →
  LATEST EXCHANGE + chat input. Clean up the spacing left by the removed panes
  so it reads as one deliberate column, not a gap where panes used to be.

### 3. Fix the "jsonl" session leak (classification)

**Root cause:** `isInternalSession()` (`public/index.html:3522`) classifies
internal SDK subprocesses with a hardcoded per-role slug allowlist
(`cut-the-cake-chat`, `chunk-to-chat-observer`, `cut-the-cake-observer`,
`cut-the-cake-scriptifier`, `cut-the-cake-infographer`) — **missing `composer`
and `tts`**. Composer subprocesses therefore fall through and render as unnamed
"jsonl" cards in the user-driven list.

**Why not the backend flag:** the backend already computes `isInternal`
(`entrypoint === "sdk-cli" && cwd under ~/.cut-the-cake`), but the **observer
runs under the legacy `~/.chunk-to-chat/observer`** path (`observer.ts:68`),
which that flag excludes — using it would regress the observer into the visible
list. Also, `isInternal` is not currently carried on the frontend's
`sess.info` (a `SessionInfo`: `sessionId`, `path`, `slug`, `source`).

**Fix (strict slug match):** replace the allowlist with a match on our two
sandbox roots, using the hidden-dir `--` tell so real repos are never caught:

```js
function isInternalSession(sess) {
  const slug = sess?.info?.slug || '';
  return slug.includes('--cut-the-cake') || slug.includes('--chunk-to-chat');
}
```

**Verified on disk.** Sandbox slugs carry a double dash at the `/.hidden`
boundary:
- `-Users-oronans--cut-the-cake-composer-…`
- `-Users-oronans--chunk-to-chat-observer`
- `-Users-oronans--cut-the-cake-infographer`

A real checkout is single-dash (`-Users-oronans-workspace-cut-the-cake`), so the
`--` form matches only the `.cut-the-cake` / `.chunk-to-chat` hidden dirs — even
though this repo's GitHub name is `cut-the-cake` and forkers may clone it under
that name. After removal the only remaining internal subprocesses are the
observer (`--chunk-to-chat-observer`) and chat (`--cut-the-cake-chat-…`); both
match.

### 4. Collapsible sidebar (thin icon rail)

- Add a collapse chevron on the `SESSIONS` header (◀ when expanded).
- **Collapsed:** a ~52px rail showing one color-dot per session (live sessions
  use the existing strawberry live avatar; colors from the existing
  `sessionColorVars(sessionId)`). Clicking a dot navigates to that session; the
  chevron (▶) re-expands. The detail/chat pane widens to fill the reclaimed
  space.
- **Persistence:** collapsed/expanded state stored in `localStorage`, restored
  on load.
- **Restraint:** chrome only — reuse existing session colors and the live
  avatar; introduce no new mascots or delights (DESIGN.md limits delights to the
  five named places; the live avatar is already one of them).

## Non-goals

- No change to the observer, chat, triggers, tailer, turns, discovery, or the
  auto-break-down behavior.
- No cleanup of on-disk `~/.cut-the-cake/{composer,scriptifier,infographer,
  tts-cache}` or `~/.chunk-to-chat` directories — harmless to leave; out of
  scope.
- No new features in the detail pane beyond re-flowing the layout.

## Risks & edge cases

- **Dangling references:** deleting four modules touches many `server.ts` call
  sites; a missed reference breaks the build. Mitigation: `bun typecheck` must be
  clean, and grep for each deleted symbol before finishing.
- **Orphaned SSE handlers:** message kinds must be removed on *both* ends;
  leftover frontend handlers for removed kinds are dead but harmless, leftover
  backend broadcasts to removed handlers are noise. Remove both.
- **Classification false-positive:** accepted and minimized by the strict `--`
  pattern (see §3).
- **hyperframes dep removal:** confirm nothing else in the tree shells out to
  `npx hyperframes` before deleting the devDependency.

## Verification

1. `bun typecheck` — clean, no dangling references to removed symbols.
2. Launch `bun src/server.ts` and drive the app in a browser:
   - Sidebar collapses to the rail and re-expands; state persists across reload.
   - Selecting a session shows **header → code-changes chart → chat**, with no
     empty panes or leftover spacing.
   - Zero console errors/warnings.
   - The **internal · sdk subprocesses** divider groups observer + chat with
     **no "jsonl" leaks** in the user-driven list.
3. Confirm no `/composer/*`, `/tts/*`, or `/debug/inject-*` routes respond.
