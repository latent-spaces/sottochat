# state.md — cut-the-cake

cold-start brief. read this first when resuming. intentionally redundant with `plan.md` and `claude-mem-patterns.md`.

---

## what is this

**cut-the-cake** (formerly chunk-to-chat) — *turn long agent runs into a quick iterative chat.*

a chat layer for long claude code (and other autonomous agent) sessions. tails session jsonl files in real time (claude code, claude.app local-agent-mode, **and codex cli rollouts**), runs a long-lived sonnet observer over the closed-turn stream for per-turn decisions, and (when auto-break-down is on) automatically fires a sonnet chat-agent into a "break it down" thread the moment the observer flags a turn.

the loop:

1. agents run — claude code cli, claude.app local-agent-mode, **codex cli** (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`)
2. cut-the-cake tails every cc-schema jsonl + every codex rollout across all known roots, parses events into a unified `MetaEvent` shape, groups into turns
3. when turns close, they're batched (every 30s) and sent to a single persistent sdk subprocess:
   - **observer** (sonnet 4.6) returns per-turn `{open, insight, tags, prefill}`
4. ui shows a sidebar of session cards (left) + selected session detail (right). detail pane = charts band → 3-message chat strip → per-session chat-thread (the live "break it down" conversation) → chat input prefilled with the observer's prefill.
5. when the observer flags `open: true` *and* the global auto-break-down toggle is on, the server fires the prefill into the chat-agent automatically — pre-seeded with the observer insight + last 5 turn excerpts. user opens the tab to a primed conversation. follow-ups go through the same sdk subprocess (one per upstream sessionKey).
6. when auto-break-down is off (the default), the user clicks the send button → POST `/chat/send` does the same thing, just user-initiated.

what's wired: multi-source tailer (cc cli + claude.app + **codex rollouts**, recursive fs.watch + per-tick poll, lineage collapse + temp-folder filter) · **codex JSONL parser** (`src/codex-jsonl.ts` — stateful, ports vendor/abtop/src/collector/codex.rs schema; codex events flow through turns/observer/chat-agent unchanged) · chat-session display names (server resolves `cut-the-cake-chat-<sha1[:12]>` slugs back to upstream and emits `displayName: "<project> · chat"`) · **abtop-style PID-driven session discovery in shadow mode** (process-discovery + claude-discovery + codex-discovery + registry; runs every 2s alongside the legacy tailer, exposed at `/diag/discovery` for parity verification, doesn't drive the inbox yet) · multi-session inbox · diff-rendered sidebar with magicui-style enter/exit/update pulse + FLIP layout (transform-leak fix) · **inbox separator + grouping**: user-driven sessions on top, `internal · sdk subprocesses` divider, then observer + chat-agent threads · single-loop sonnet observer (auto-respawn) · chat-agent host (sonnet, one persistent subprocess per upstream sessionKey, tools disabled) · POST `/chat/send` + ws chat:chunk/chat:status broadcasts · auto-send on observer open=true with 5-min cooldown + global toggle (default off) · chat-thread block in detail pane (markdown, "auto" badge for server-fired chunks) · **chat-thread collapses to last 2 messages by default** (per-session "show N earlier" toggle, auto-collapses on send) · charts above the conversation, panel-styled, capped to last 5 turns · **animated charts-band expand/collapse with first-look intro** (bars stagger-grow from the floor, deflate end-to-start, band height folds, toggle pulses) · **video-pane** (parallel-modality alternative to reading the conversation strip — per-turn karaoke captions + marker overlays + TTS audio): single-shared sonnet `scriptifier` subprocess emits `{turnId, beats:[{text, marker?, emphasis?}]}` (markers: INSIGHT / BE_CAREFUL / STEP / NOTE), server runs `npx hyperframes tts` (kokoro-82m, default voice `af_heart`) + `npx hyperframes transcribe` (whisper small.en) to gen wav + word-level timings, sha256-cached at `~/.cut-the-cake/tts-cache/<hash>.{wav,words.json,txt}`, served via `GET /tts/<hash>.wav` (hex-only path-traversal guard). client renders a `.video-pane` block between charts-band and conversation: scrolling beat stack with current beat focused (larger + opaque) and past/future dimmed, rAF-driven word-level karaoke highlight via `audio.currentTime`, marker chips with fixed cross-session colors so users learn to recognize them (yellow/amber/blue/cream + dashed-paper for NOTE), play/pause + scrub + mm:ss time. broadcasts `script:beats` on beats arrival (status=rendering) and `script:ready` (status=ready, with audioUrl + words) on tts completion. soft pink visual system (full strawberry/dessert redesign, six-hue per-session palette) · sticky frosted nav with github pill + auto-break-down toggle · sidebar/detail visual separation · svg dripping-frosting cap on bar plots (color-mix lightened, only on tall bars) · hover-burst radial sprinkle spray out of frosted bars · brand jump-roll on the cake logo · **wandering cake-perch with 15 mild reactions + 4 over-the-top specials (1/20 chance) + pester-driven wander** (2-5 hovers in a 30s window relocates to a fresh anchor) · undraggable mascot images · palette-unified mascot trio (`mascot-uni-1/2/3.svg`) in the wandering pool · sidebar selected-card mascot with hover y-flip + fade in/out · DESIGN.md regenerated from current code (tagged `pre-design-md-refresh` / `post-design-md-refresh`).

what's not wired yet: **registry-as-driver** (flag exists at `META_USE_PROCESS_DISCOVERY=0`; flipping it + deleting lineage-collapse + slug-matching self-feed filter + `recentMs` first-touch gate is the next commit) · observer profile persistence (`session_id` resume across restarts) · feedback channel back to observer · userpromptsubmit hook for the final injection back into the user's main claude session.

---

## jump start

```bash
cd /Users/oronans/workspace/claude-meta   # local dir kept; github renamed to cut-the-cake
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun run src/server.ts
open http://localhost:3737/
```

observer is on by default. set `META_OBSERVER_ENABLED=0` to opt out — useful when iterating in `bun run dev` (`bun --hot` orphans the sdk subprocess on every file edit, see issue #4). auto-break-down is **off** by default — flip it on via the top-nav pill or `META_AUTO_SEND_ENABLED=1`.

env vars (all optional):

| var                            | default              | purpose                                                 |
|--------------------------------|----------------------|---------------------------------------------------------|
| `META_PORT`                    | 3737                 | server port                                             |
| `META_POLL_MS`                 | 500                  | tailer poll interval (fs.watch wakes earlier on new files) |
| `META_PROJECT_SLUG`            | unset                | restrict cc tailing to one project dir                  |
| `META_INBOX_MINUTES`           | 240                  | only tail jsonl files whose mtime is within this window |
| `META_OBSERVER_ENABLED`        | 1 (on)               | set `0` to skip spawning both sdk subprocesses          |
| `META_OBSERVER_MODEL`          | `claude-sonnet-4-6`  | model for the per-turn decisions subprocess             |
| `META_CHAT_MODEL`              | `claude-sonnet-4-6`  | model for the "break it down" chat-agent subprocesses   |
| `META_OBSERVER_BATCH_MS`       | 30000                | batch interval for closed turns (ceiling, not heartbeat — quiet windows skip the call) |
| `META_OBSERVER_FRESH_MS`       | 300000               | only feed turns whose endTs is within this window       |
| `META_AUTO_SEND_ENABLED`       | 0 (off)              | set `1` to default-on the auto-break-down toggle        |
| `META_AUTO_SEND_COOLDOWN_MS`   | 300000               | per-session cooldown between auto-fired chats           |
| `META_MAGNITUDE_TOK`           | 1500                 | fallback trigger threshold (used when observer is off)  |
| `META_MAGNITUDE_TC`            | 5                    | fallback trigger threshold (tools/turn)                 |
| `META_MAGNITUDE_CHARS`         | 6000                 | fallback char trigger                                   |
| `META_USE_PROCESS_DISCOVERY`   | 0 (off, shadow mode) | when `1`, the abtop-style PID-driven registry (`src/registry.ts`) replaces the legacy mtime-driven tailer view as the source-of-truth for `recentSessions()`. shadow-mode runs the registry either way, exposed at `/diag/discovery`. |
| `META_SCRIPTIFIER_ENABLED`     | 1 (on)               | scriptifier subprocess that converts each closed turn into a karaoke script for the video-pane |
| `META_SCRIPTIFIER_MODEL`       | `claude-sonnet-4-6`  | model for the scriptifier sdk subprocess |
| `META_SCRIPTIFIER_BATCH_MS`    | 2000                 | scriptifier batch ceiling — short on purpose so video lands ~2s after a turn closes |
| `META_TTS_VOICE`               | `af_heart`           | kokoro voice used by `npx hyperframes tts` (warm female en-US default; `am_michael` / `bf_emma` also work) |

**locations:**

- repo: https://github.com/oronanschel/cut-the-cake (private; renamed from chunk-to-chat — github keeps a redirect)
- local dir: `/Users/oronans/workspace/claude-meta` (not renamed)
- bun: `~/.bun/bin/bun`
- claude binary used by sdk: located via `which claude` (currently `~/.local/bin/claude`)

**revert anchors:**
- tag `pre-cut-the-cake` → `cc383e9` — last clean state before the strawberry redesign.
- commit `398a85e` — pre-wire-up baseline: tailer fs.watch + lineage collapse, per-session palette, bar-frost svg, `chat-agent.ts` drafted (not yet wired).
- commit `5f2d750` — observer split + chat send/auto-send + global toggle + frosting + jump-roll.
- commit `40683db` — hover-burst: radial sprinkle spray out of frosted bars.
- commit `43fd0eb` — auto-break-down default off + sidebar FLIP transform leak fix.
- commit `c21139f` — wandering cake-perch mascot + svg mascots in sidebar cards.
- commit `f631f6f` — add bar-frost-v2.svg.
- commit `d72ec37` — sidebar mascot smaller (36px) + overlays + hover y-flip with fade in/out.
- tag `pre-design-md-refresh` → `d72ec37` — last clean state before the DESIGN.md regen.
- commit `38b5be5` — DESIGN.md regenerated from current code (per-session palette, mascots, frosting, sprinkle burst, FLIP, charts band, chat-thread). tag `post-design-md-refresh`.
- commit `87b0745` — wandering cake-perch: swap to two mascot-var-3 svgs.
- commit `f876adf` — wandering cake-perch: re-add mascot-var-2, three variants total. tag `wandering-mascot-var3`.
- commit `10b3d16` — wandering pool now uses palette-unified `mascot-uni-{1,2,3}.svg` derived from the same canonical wine + strawberry + lavender palette. tag `wandering-mascot-unified`.
- commit `267c8ea` — abtop pivot 1/5: `src/process-discovery.ts` — pure ProcInfo + getChildrenMap + hasActiveDescendant + cmdHasBinary + lastPathSegment, ported from `vendor/abtop/src/collector/process.rs`. one `ps -axo` shell-out per call.
- commit `98c3e55` — abtop pivot 2/5: `src/claude-discovery.ts` — PID-driven cc session resolution. ports findClaudePids, findSessionFileForPid, buildDiscoveryContext, resolveProjectDir (worktree fallback), encodeCwdPath (exact `/ \ : _ . → -` rule, fixes a silent mismatch in our prior naive replace), findLiveSessionId (`/clear` repair with 5s grace + sibling-PID exclusion), loadSession. Reads richer SessionFile schema (status / entrypoint / updatedAt / name) that cc 2.1.119+ writes. `entrypoint='sdk-cli' && cwd under ~/.cut-the-cake/` flags `isInternal=true` — replaces slug-matching self-feed filter once consumers wire through.
- commit `e98755c` — abtop pivot 3/5: `src/codex-discovery.ts` — codex doesn't write a per-PID metadata file, so it's `lsof -F pn -p <pids>` to find which `rollout-*.jsonl` each codex PID has open, then a minimal first-line `session_meta` parser to get sid/cwd/version/git.branch. Recently-finished pass (rollouts < 5 min old, no PID owner) returns `pid=0 isRecent=true` rows.
- commit `4903dea` — abtop pivot 4/5: `src/registry.ts` — abtop's `MultiCollector` shape. one tick fetches the process table once, runs both collectors in parallel, returns sorted `RegistrySession[]`. tick cadence 2s; codex's lsof gated to slow ticks (every 5th, ≈10s). claude discovery is pure node fs and runs every tick.
- commit `7c05566` — abtop pivot 5/5: shadow-mode wiring in `src/server.ts`. registry now starts at boot regardless of `META_USE_PROCESS_DISCOVERY` flag (default `0`); it just doesn't drive the inbox yet. new endpoints `GET /diag/discovery` (current snapshot) and `GET /diag/discovery-vs-tailer` (set diff vs legacy view — `onlyInDiscovery` are sessions the new path catches that the tailer misses, `onlyInTailer` are dead-PID ghosts + `-private-var-folders-` ephemeral helpers the legacy path leaks). registry.stop() runs on SIGINT/SIGTERM.
- commit `652338c` — `notes/state.md` post-pivot refresh.
- commit `b112783` — chat-thread UX: collapses to last 2 chunks by default (`RECENT_VISIBLE_CHUNKS=2`); per-session expand toggle ("show N earlier" → "hide earlier") kept in `expandedThreads` Set; auto-collapse on send so a fresh `/chat/send` re-anchors on the new exchange. (also added a debounced upstream-reload that turned out to be too aggressive — replaced in `841c940`, see below.)
- commit `841c940` — inbox separator + surgical hash recovery.
  - sidebar: user-driven sessions on top, then a `internal · sdk subprocesses` dashed-hairline divider, then sessions whose slug matches `cut-the-cake-{chat,observer}` / `chunk-to-chat-observer` (chat-agent + observer). lazily-created separator that's removed when there are no internals to show. classification is slug-based today; once `META_USE_PROCESS_DISCOVERY=1` flips, the registry's `isInternal` flag becomes the authoritative source.
  - replaced the `b112783` debounced reload with `maybeRecoverStaleHash()` — runs once at hello, drops the URL hash silently iff it points at a sid the server doesn't have. the previous reload was firing on every upstream cc reply (every few seconds during active dev), nuking the textarea draft + per-session expand state mid-typing. chat-agent multi-turn already worked server-side; the bug was the browser killing itself.
- commit `54b120c` — namer removal + chat session display names + mascot pool expansion. dropped the haiku namer subprocess entirely (observer.ts now runs a single decisions sdk loop; `s.sessionName` / `observer:name` ws msgs / `chartsBandExpanded` includes / `cut-the-cake-namer` self-feed slug all gone). server now resolves a chat-agent's `cut-the-cake-chat-<sha1[:12]>` slug back to its upstream session and emits `displayName: "<upstream-project> · chat"` so internal chat cards read as their parent project. mascot enrichment: 15 mild wander reactions (walkFlip / nod / hop / breathe / peek / wiggle / spin / squish / lean / shy / bobble / doubleFlip / shimmy / stretch / bow), 4 over-the-top specials with 1/20 hover chance (full-screen sparkle explosion / confetti rain / hue-rotate disco spin / comic-burst with expanding accent ring), pester-driven wander (2-5 hovers in a 30s window picks a fresh anchor via per-session salt mixed into placeCakePerch's hash), undraggable mascot images (CSS + `draggable="false"` attr).
- commit `2ca8845` — animated charts-band expand/collapse + first-look intro. shared expand/collapse animation drives both the manual toggle and a one-time auto-intro (band opens, dwells 2.2s, auto-collapses) the very first time a session has charts to show; introduced state lives in localStorage so reloads don't replay it. expand: bars `scaleY:0→1` with forward stagger and `back.out(1.4)` overshoot. collapse: bars deflate end-to-start, chart-cards shrink + blur in parallel with the tail, band's measured height + margin + opacity fold to 0, toggle button does a 1.0→1.15→1.0 yoyo pulse to mark "the charts went here." reentrancy-safe: callers flip `chartsBandExpanded` BEFORE calling, so a re-click mid-tween reverses direction; expand path clearProps any inline styles a killed collapse left behind.
- commit `62aea60` — codex jsonl parser ported from abtop. new `src/codex-jsonl.ts` with stateful `parseCodexRecord(raw, state)`. mappings (vs `vendor/abtop/src/collector/codex.rs`): `session_meta` → state.cwdSlug + sessionId · `turn_context` → state.model · `event_msg/user_message` → user_message · `event_msg/agent_message` → assistant_text (folds in pending tokens + model) · `event_msg/token_count` → state.pendingInput/OutputTokens (attached to next assistant_text) · `event_msg/task_complete | turn_aborted` → stop · `response_item/function_call | custom_tool_call` → tool_use · `response_item/function_call_output | custom_tool_call_output` → tool_result · `response_item/message` skipped (codex emits each agent reply twice, once via agent_message and once here as role=assistant) · `response_item/reasoning` skipped (encrypted CoT). tailer adds a codex source target + per-file `CodexParseState`; lifts placeholder slug to cwd-derived slug once `session_meta` lands. verified end-to-end on a live rollout (2357 events, 66 user_messages, 226 assistant_texts, 1006 tool_use/result pairs, 53 stops, model `gpt-5.5`, contextTokens/totalOutputTokens populated, slug lifted to `-Users-oronans-workspace-reelmaker`).
- tag `pre-registry-flip` → `a1044a9` — clean revert anchor before the video-pane build. last state.md before scriptifier + tts + video-pane landed.
- video-pane (this build) — new `src/scriptifier.ts` (single-shared sonnet sdk subprocess modelled on observer.ts; tools all disallowed; cwd `~/.cut-the-cake/scriptifier/`; default `batchMs=2000` so video lands ~2s after a turn closes; per-turn input embeds the full event transcript clipped to 2000 chars/block; emits `{scripts:[{turnId, beats:[{text, marker?, emphasis?}]}]}` with markers `INSIGHT|BE_CAREFUL|STEP|NOTE`; system prompt enforces lowercase prose, 6-15 short beats per turn, 0-2 emphasis words/beat, ≤3 markers/script). new `src/tts.ts` (wraps `npx hyperframes tts` + `npx hyperframes transcribe`; sha256-keyed cache at `~/.cut-the-cake/tts-cache/<hash>.{wav,words.json,txt}`; default voice `af_heart`; in-memory in-flight `Map<hash, Promise>` dedupes concurrent calls; ffprobe for duration). server.ts wiring: `SessionState.scripts: Map<turnId, ScriptPayload>` with lifecycle `drafting→rendering→ready|error`; on `result.closed` feeds both observer and scriptifier under the same gates (visible, not self-feed, fresh ≤OBSERVER_FRESH_MS); `scriptifier.onScript` stores the payload (status=rendering) and broadcasts `script:beats`, then runs `generateTts` in the background and broadcasts `script:ready` (status=ready, with audioUrl + words) or `script:error`; new `GET /tts/<hash>.wav` route with hex-only path-traversal guard; self-feed filter extended to skip `cut-the-cake-scriptifier` slugs; `snapshot()` includes the scripts map so reconnects rehydrate. `public/index.html` adds a `.video-pane` block between charts-band and conversation: scrolling beat stack with current-focused / past-dim / future-dimmer states, rAF-driven word-level karaoke highlight via `audio.currentTime` (binary lookup on `script.words`), marker chips with fixed cross-session colors (yellow/amber/blue/cream + dashed-paper for NOTE), 44px play/pause + scrub bar + mm:ss time, runtime cache `videoRuntime: Map<sessionKey, {audio, beatBoundaries, rafId}>` keyed on `(turnId, audioUrl)` so 5s refresh ticks reuse the audio element instead of remounting. e2e verified live: synthesized a closed turn against a fake `~/.claude/projects/-Users-oronans-test-video-pane/...jsonl`, scriptifier emitted 9 beats with 2 markers in <2s, tts rendered a 41.4s wav in 15.75s, transcribe produced 98 word timings in 3.71s, `script:ready` ws msg arrived with full payload, `/tts/<hash>.wav` streams real RIFF/WAVE bytes, hello payload includes the scripts map. NOT yet visually verified in a browser (chrome-devtools-mcp wedged during the run with "selected page has been closed" — every list_pages/new_page failed).

---

## status (what's built / what's not)

| phase | description                                                            | state           |
|-------|------------------------------------------------------------------------|-----------------|
| 1     | jsonl tailer + raw event feed                                          | done (+ recursive fs.watch wake-up + lineage collapse + temp-folder filter) |
| 2     | turn assembly + magnitude trigger                                      | done            |
| A     | rename to chunk-to-chat → cut-the-cake + two-view ui shell             | done            |
| B     | multi-session inbox (cc + claude.app local-agent-mode)                 | done            |
| C     | observer wiring (sonnet decisions, single sdk loop)                    | done · committed (profile-resume across restarts not, feedback channel not) |
| C'    | namer subprocess removed; chat sessions get server-derived displayName | done · committed (`54b120c`) |
| D     | break-it-down item flow (POST /chat/send + chat-thread + auto-send)    | done · committed |
| D'    | auto-break-down global toggle (default off)                            | done · committed |
| E     | userpromptsubmit hook for handoff                                      | not started     |
| V     | strawberry/dessert visual system + animations                          | done · committed |
| V'    | per-session colors + sidebar separation + svg frosting                 | done · committed |
| V''   | new frosting svg + sprinkle burst + brand jump-roll + cake-perch       | done · committed |
| V'''  | svg mascots + sidebar mascot hover y-flip with fade in/out             | done · committed |
| V'''' | palette-unified wandering mascot trio + DESIGN.md regen                | done · committed |
| V₅    | wandering mascot pool: 15 mild reactions + 4 specials + pester-wander + undraggable | done · committed (`54b120c`) |
| V₆    | charts-band: animated expand/collapse + first-look intro               | done · committed (`2ca8845`) |
| F     | abtop-style PID-driven discovery (process + claude + codex + registry) | done · committed (shadow mode — registry runs but doesn't drive inbox) |
| F'    | flip registry-as-driver + delete lineage-collapse + slug filter + recentMs gate | not started — next commit |
| F''   | full codex JSONL parser (stateful) — codex sessions feed the inbox like cc | done · committed (`62aea60`) |
| G     | chat-thread collapse to last 2 chunks + per-session expand toggle      | done · committed |
| G'    | inbox separator: user-driven sessions on top, sdk subprocesses below   | done · committed |
| G''   | surgical URL hash recovery (replaces the over-eager full-page reload)  | done · committed |
| H     | scriptifier subprocess + tts module + video-pane karaoke renderer (parallel-modality alternative to reading the conversation strip) | done · committed (server e2e verified live; visual layer unverified — chrome-devtools-mcp wedged during the run) |

**current head:** the video-pane commit (scriptifier + tts + client video-pane).

**working tree:** clean. (the legacy `bar-frost.svg`, `bar-frost-v2.svg`, `empty-state-cake-duo.webp`, `header-banner-cake-clouds.webp`, `mascot-uni-23-anim.svg`, `cake-icon.svg`, `mascot-var-2.svg`, `mascot-var-3-{1,2}.svg`, `send-button-rocket.webp` files referenced in older state.md revisions have all been removed; the asset dir is now: `frosting-new.svg`, `logo-cake-slice.webp`, `mascot-uni-{1,2,3}.svg`.)

---

## architecture

```
TWO discovery paths feed the inbox today. legacy is the source-of-truth;
process-driven runs in shadow mode and is exposed at /diag/discovery.

LEGACY (filesystem-driven, mtime-gated):

~/.claude/projects/<slug>/<uuid>.jsonl                 ← claude code cli
~/Library/Application Support/Claude/                  ← claude.app local-agent-mode
   local-agent-mode-sessions/**/audit.jsonl            (same cc schema)
   local-agent-mode-sessions/**/.claude/projects/.../*.jsonl
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl           ← codex cli
       │
       ▼
src/tailer.ts        per-file FileState (offset + partial + uuid dedupe for
                     cc; codex relies on offset alone since rollout records
                     have no per-record uuid);
                     per-tick re-glob baseline + recursive fs.watch wake-up
                     on each source root (claude-mem §3 pattern);
                     only tails files with recent mtime;
                     codex source carries an extra `CodexParseState` (model
                     from turn_context, pending tokens from token_count,
                     cwdSlug from session_meta) — tailer dispatches to
                     parseCodexRecord vs parseRecord by source.

ABTOP-STYLE (process-driven, PID-gated) — shadow mode:

ps -axo pid,ppid,%cpu,command   ← src/process-discovery.ts
       │  ProcInfo map + childrenMap (one ps per tick, shared)
       ▼
src/claude-discovery.ts   findClaudePids → for each PID:
                            read ~/.claude/sessions/<pid>.json (sid, cwd,
                            startedAt, status, entrypoint, name, version);
                          encodeCwdPath(cwd) → projects/<slug>/<sid>.jsonl;
                          /clear repair via findLiveSessionId (mtime ≥
                          startedAt-5s, exclude sids claimed by other PIDs);
                          worktree fallback in resolveProjectDir;
                          isInternal=true when entrypoint='sdk-cli' &&
                          cwd under ~/.cut-the-cake/.

src/codex-discovery.ts    findCodexPids → batched lsof -F pn -p pid1,pid2…
                          → filter rollout-*.jsonl held open;
                          first-line session_meta parse (sid, cwd,
                          cli_version, git.branch, started_at).

       │  ClaudeSession[] + CodexSession[]
       ▼
src/registry.ts      MultiCollector — one tick = one ps + parallel
                     collectors; codex's lsof gated to slow ticks
                     (every 5th, ≈10s); claude is pure node fs and runs
                     every tick. snapshot kept on .current().
       │
       ▼  (today: only feeds /diag/discovery + /diag/discovery-vs-tailer.
           tomorrow: replaces recentSessions() in src/server.ts when
           META_USE_PROCESS_DISCOVERY flips to 1.)

—————————————————————————————————————————————————————
       │  raw line
       ▼
src/jsonl.ts         claude-side parser → MetaEvent[]; extracts model +
                     input/output tokens + cache fields (sums to context
                     size); lines added/removed for Edit/MultiEdit/Write/
                     NotebookEdit
src/codex-jsonl.ts   codex parser → same MetaEvent[] shape; stateful
                     (CodexParseState carries model from turn_context,
                     pending tokens from token_count, cwdSlug from
                     session_meta). dedupes response_item/message vs
                     event_msg/agent_message — codex emits each agent
                     reply twice; we keep the agent_message branch.
       │  events
       ▼
src/turns.ts         per-turn assembly with running tally (tokens, tool count,
                     lines added/removed). same code paths for cc + codex.
       │
       ▼
src/triggers.ts      magnitude evaluator — used as fallback when observer off
       │  Trigger?
       ▼
src/server.ts        Bun.serve; per-session state map; ws fanout; routes
                     / /state /sessions /chat/send /chat/auto-send /ws /assets/*
       │  ws msg                              ▲
       ▼                                       │ broadcasts: observer:decision/name,
public/index.html    sidebar + detail spa     │ chat:chunk, chat:status, autosend:setting,
   + public/assets/  svg mascots, frosting,   │ session:upsert, event, thread:new
                     empty-state, logo, etc.   │
   + cdn deps        marked@13 (markdown), gsap@3.12 (animations)

src/observer.ts      ONE persistent sdk subprocess driven by startSdkLoop:
                       observer  · sonnet 4.6 · {decisions:[]}
                     batch every 30s, FIFO inflight tracking, auto-respawn
                     on crash, SIGINT → abort + exit. (the haiku namer
                     subprocess was removed in commit 54b120c — chat-agent
                     sessions get a server-derived `displayName: "<upstream
                     -project> · chat"` instead, and other sessions just
                     show their cwd-derived project name.)
       ▲
       │ TurnFeed (closed turns; visible non-self sessions only)

src/chat-agent.ts    WIRED. one persistent sdk subprocess per upstream
                     sessionKey, lazily spawned on first user send,
                     reused for follow-ups. tools disabled (talks only),
                     cwd ~/.cut-the-cake/chat/<sha1-hash>/.
                     send(sessionKey, text, {seed?, userKind?}) — first
                     prompt of a session prepends SYSTEM_INTRO + optional
                     seed block (used by auto-send).
                     onChunk emits {role, text, ts, kind} — kind="auto"
                     when server-fired so the UI badges them.

  /chat/send (POST) ─→ chatHost.send(sessionKey, text, {userKind:"user"})
  observer onDecision (open=true + prefill, autoSendEnabled, cooldown)
                    ─→ buildAutoSendSeed(s, decision)
                    ─→ chatHost.send(sessionKey, decision.prefill,
                                     {seed, userKind:"auto"})
```

**stack:** bun + typescript on the server, vanilla browser js on the client. no react. no build step. server-side dep `@anthropic-ai/claude-agent-sdk@^0.2.128`. client-side cdn deps loaded inline: `marked@13.0.3` (~32 KB), `gsap@3.12.5` (~70 KB).

---

## files (every tracked file, one-liner each)

```
.gitignore                       vendor/, node_modules, env, settings.local.json, diagnostics/
package.json                     name = cut-the-cake (private); + claude-agent-sdk dep
tsconfig.json                    strict, esm, bundler resolution, noEmit
bun.lock                         committed (text format)
PRODUCT.md                       brand: cut-the-cake patisserie press; "fun in voice + 5 places"
DESIGN.md                        visual system: strawberry tokens, plum chart-only, glass nav
.impeccable/design.json          stitch-style sidecar (legacy from indigo era; pre-rename)

src/server.ts                    Bun server: per-session state, ws fanout, observer onDecision,
                                 scriptifier onScript (stores ScriptPayload, broadcasts script:beats,
                                 then runs generateTts in background and broadcasts script:ready /
                                 script:error), chat host, POST /chat/send + /chat/auto-send, auto-send
                                 dispatcher (buildAutoSendSeed + maybeAutoSendChat), temp-folder filter,
                                 chatDisplayNameFor() to resolve cut-the-cake-chat-<sha1[:12]> slugs
                                 back to upstream project name, /assets, /tts/<hash>.wav (hex-only
                                 path-traversal guard), GET /diag/discovery + /diag/discovery-vs-tailer
                                 (registry shadow view).
src/tailer.ts                    multi-source jsonl tailer (cc cli + claude.app + codex rollouts);
                                 per-file FileState carries an optional CodexParseState; poll +
                                 recursive fs.watch wake-up
src/jsonl.ts                     claude record parser → MetaEvent[]; tokens, model, lines added/removed
src/codex-jsonl.ts               codex rollout record parser → same MetaEvent[] shape; stateful
                                 (model from turn_context, pending tokens from token_count, cwdSlug
                                 from session_meta). skips response_item/message to avoid the duplicate
                                 with event_msg/agent_message. handles function_call + custom_tool_call
                                 (apply_patch).
src/turns.ts                     per-turn assembly + tally — source-agnostic
src/triggers.ts                  fallback magnitude evaluator
src/observer.ts                  ONE sdk subprocess (decisions:sonnet) via startSdkLoop helper;
                                 FIFO inflight tracking; respawn. (namer subprocess removed in 54b120c.)
                                 also exports buildTurnFeed → TurnFeed (now carries optional events[]
                                 so the scriptifier can see the full turn transcript, not just excerpts).
src/scriptifier.ts               ONE sdk subprocess (sonnet, all tools disallowed, cwd
                                 ~/.cut-the-cake/scriptifier/). converts each closed turn into a
                                 marker-tagged karaoke script {turnId, beats:[{text, marker?,
                                 emphasis?}]} (markers: INSIGHT|BE_CAREFUL|STEP|NOTE). default
                                 batchMs=2000 (short on purpose so the video lands ~2s after a
                                 turn closes). batch body embeds the full event transcript clipped
                                 to 2000 chars/block; falls back to userPrompt+assistantExcerpt when
                                 events isn't populated. system prompt enforces lowercase prose,
                                 6-15 short beats per turn, ≤3 markers, 0-2 emphasis words/beat.
src/tts.ts                       wraps `npx hyperframes tts` + `npx hyperframes transcribe` + ffprobe.
                                 cache at ~/.cut-the-cake/tts-cache/<hash>.{wav,words.json,txt} keyed
                                 on sha256(voice + text); cache hit when both <hash>.wav and
                                 <hash>.words.json exist. in-memory in-flight Map<hash, Promise>
                                 dedupes concurrent calls. default voice af_heart (kokoro-82m,
                                 verified). returns {hash, audioPath, durationS, words: WordTiming[]}.
src/chat-agent.ts                "break it down" host: one persistent sdk subprocess per upstream
                                 sessionKey; tools disabled; first-prompt seed support; ChatChunk.kind
src/process-discovery.ts         ports vendor/abtop/src/collector/process.rs — pure ProcInfo (pid,
                                 ppid, cpu_pct, command) via ps -axo, getChildrenMap, hasActiveDescendant
                                 (cpu>threshold), cmdHasBinary (handles cc autoupdater layout
                                 <name>/versions/<file>), lastPathSegment.
src/claude-discovery.ts          ports vendor/abtop/src/collector/claude.rs — PID-driven cc session
                                 resolution. findClaudePids, findSessionFileForPid, buildDiscoveryContext
                                 (claimed_sids_by_pid + pids_per_cwd), resolveProjectDir (worktree
                                 fallback), encodeCwdPath (exact `/ \\ : _ . → -`), findLiveSessionId
                                 (`/clear` repair), loadSession. surfaces SessionFile schema cc 2.1.119+
                                 writes (status, entrypoint, updatedAt, name).
src/codex-discovery.ts           ports vendor/abtop/src/collector/codex.rs (macOS arm) — codex has no
                                 sessions/<pid>.json so we lsof -F pn -p the codex PIDs to find their
                                 open rollout-*.jsonl, then parse the first-line session_meta event for
                                 sid/cwd/cli_version/git.branch/started_at. recently-finished pass
                                 (rollouts < 5min old, no PID owner) returns pid=0 + isRecent=true rows.
src/registry.ts                  ports vendor/abtop/src/collector/mod.rs MultiCollector — one tick fetches
                                 process table once, runs both collectors in parallel against the same
                                 snapshot. tick cadence 2s. SLOW_POLL_INTERVAL=5: codex lsof only every
                                 5th tick (≈10s), reuses cached codex snapshot in between. surfaces
                                 RegistrySnapshot{sessions, procs, childrenMap, tookMs, fetchedAt,
                                 tickCount} via .current(). consumed today only by /diag endpoints;
                                 will become inbox source-of-truth when META_USE_PROCESS_DISCOVERY=1.

public/index.html                spa: sticky frosted nav (logo with brand-jump-roll + auto break-down
                                 toggle pill + gh pill) · diff-rendered sidebar with gsap enter/exit/
                                 update + FLIP (transform-leak fixed) · selected-card mascot 36px,
                                 z-index overlay, hover y-flip with fade in/out · chat-style detail
                                 (markdown, tail truncation) · animated charts band (bars stagger-
                                 grow on expand, deflate end-to-start on collapse, band height
                                 folds, toggle pulses) above conversation with frosting-new svg +
                                 color-mix lighter cap (only on tall bars) + hover radial sprinkle
                                 burst dominated by bar color · video-pane between charts and
                                 conversation: scrolling beat stack, current-focused / past-dim /
                                 future-dimmer states, rAF-driven word-level karaoke highlight via
                                 audio.currentTime, marker chips (INSIGHT/BE_CAREFUL/STEP/NOTE) with
                                 fixed cross-session colors, 44px play/pause + scrub + mm:ss time,
                                 runtime cache `videoRuntime: Map<sessionKey, {audio, beatBoundaries,
                                 rafId}>` keyed on (turnId, audioUrl) so refresh ticks reuse the
                                 audio element instead of remounting · chat-thread block + chat
                                 input · wandering cake-perch with 15 mild reactions + 4 over-the-top
                                 specials (1/20 chance) + pester-driven wander (2-5 hovers in a 30s
                                 window relocates) · undraggable mascot images.

public/assets/
  frosting-new.svg               bar-frost cap silhouette (in active use)
  logo-cake-slice.webp           top-nav logo (gets the brand-jump-roll on hover)
  mascot-uni-1.svg               wandering pool variant 1 — also MASCOT_IDLE for the sidebar mascot
  mascot-uni-2.svg               wandering pool variant 2 — also MASCOT_ACTIVE for the sidebar mascot
  mascot-uni-3.svg               wandering pool variant 3

notes/plan.md                    v1 plan: 5 phases, data model, hook contract, defaults
notes/claude-mem-patterns.md     24-section reference of patterns from claude-mem
notes/state.md                   this file
```

**gitignored references** (still around for grep + design study):
- `vendor/claude-mem/` — observer pattern source
- `vendor/abtop/` — token-counter + lineage discovery
- `vendor/magicui/` — `blur-fade.tsx` + `animated-list.tsx` (we ported to vanilla js + gsap)
- `diagnostics/` — exploratory screenshots from the chrome-devtools-mcp loop

---

## the observer (single sonnet decisions loop)

`src/observer.ts` runs ONE persistent sdk subprocess, spawned via `query()` from `@anthropic-ai/claude-agent-sdk` and driven by `startSdkLoop` — a helper that owns lifecycle, FIFO inflight tracking, and respawn. observer pattern is closely modelled on `vendor/claude-mem/src/services/worker/ClaudeProvider.ts`.

(in the prior shape, a parallel haiku "namer" subprocess produced a per-session 2-3 word display name. removed in `54b120c` — internal chat-agent cards now show `<upstream-project> · chat` from `chatDisplayNameFor()` in `src/server.ts`, which sha1-hashes each known upstream sessionKey to find the chat sandbox dir; everything else just shows the cwd-derived project name.)

**setup:**
- **auth**: uses your existing claude auth (whatever `which claude` returns).
- **disallowedTools**: `[Bash, Read, Write, Edit, Grep, Glob, WebFetch, WebSearch, Task, NotebookEdit, AskUserQuestion, TodoWrite]`. it can think + emit text, never touches files.
- **input feed**: an async-generator yielding synthetic user messages built from a queue; `startObserver.feed(t)` enqueues.
- **batch tick**: 30s setInterval early-returns when the queue is empty — quiet windows skip the call. ceiling on send rate, not a heartbeat.
- **system prompt**: prepended to the first batch only.
- **respawn**: lifecycle while-loop, 5s backoff, 5 consecutive-failure cap. SIGINT/SIGTERM → abort + exit after 500ms grace.

**decisions:**
- model: `claude-sonnet-4-6` (env `META_OBSERVER_MODEL`)
- cwd: `~/.chunk-to-chat/observer/` — legacy path; rename to `~/.cut-the-cake/observer/` is open issue #3.
- response shape: `{decisions: [{turnId, open, insight?, tags?, prefill?}, ...]}`
- decisions feed `onDecision` callback in `src/server.ts` → ObserverInsight stored on SessionState → broadcast `observer:decision` ws msg → drives `maybeAutoSendChat` when open=true and the global toggle is on.

**self-feed filter** (`src/server.ts`): jsonl slugs containing `chunk-to-chat-observer` or `cut-the-cake-chat` are surfaced as cards but never fed back to the observer (would be an infinite mirror). plus the temp-folder filter (`-private-var-folders-`) hides claude code's own internal title-generator subprocesses entirely.

**what's not wired yet:**
- profile persistence — `session_id` is captured per spawn but not stored across restarts.
- feedback channel — user interactions not yet sent back to adapt the gate.
- per-turn pairing of tool_use ↔ tool_result — ignored.

**observer cost:** one sonnet batch every active 30s, cache hits dominate.

---

## the chat agent (wired)

`src/chat-agent.ts` exports `startChatHost({model, onChunk, onStatus})` — one persistent sdk subprocess per upstream `sessionKey`, lazily spawned on first send and reused for every follow-up. tools disabled, cwd `~/.cut-the-cake/chat/<sha1-hash>/`, model `claude-sonnet-4-6` by default (env `META_CHAT_MODEL`).

**send signature**: `send(sessionKey, text, {seed?, userKind?})`
- `seed` (optional) — prepended to the FIRST prompt of a given subprocess, after `SYSTEM_INTRO`. used by auto-send to inject the observer insight + recent turn excerpts so the agent's first reply is grounded.
- `userKind` — `"user"` (default, typed) or `"auto"` (server-fired). echoed on the user-role ChatChunk so the UI can badge auto-sent messages.

**design rationale (no fork):** instead of resuming the upstream cc session via SDK `resume:`, we keep this a fresh subprocess per sessionKey and pre-seed with a small context block. forking would dump 100k–500k tokens into every chat turn (cache helps but only within the 5min TTL), and would inherit the upstream session's tool-enabled config — defeating our sandbox + creating concurrency staleness vs the still-running cc session. pre-seeding is ~5k tokens for 80% of the value.

**server wiring (`src/server.ts`):**
- `chatThreads: Map<sessionKey, ChatChunk[]>` — last 200 chunks per session, in-memory only (lost on restart).
- `chatStatuses: Map<sessionKey, {status, message?, ts}>` — latest agent status per session.
- POST `/chat/send` `{sessionKey, text}` → `chatHost.send(sessionKey, text, {userKind:"user"})`. validates sessionKey is known.
- `onChunk` → `pushChatChunk` → broadcast `chat:chunk` ws msg.
- `onStatus` → broadcast `chat:status` ws msg.
- snapshot includes `chatThread` + `chatStatus`, so `hello` payload rehydrates the UI on reload.

**client wiring (`public/index.html`):**
- `chatThreadByKey` Map + `chatStatusByKey` Map.
- send button click → `fetch('/chat/send', ...)`. clears the textarea draft; the server broadcasts the user echo + agent reply back over ws.
- `.chat-thread` block sits between `.conversation` and `.chat-input` in the detail pane. user rows are plain `escapeHtml`; agent rows use `marked.parse({breaks:true, gfm:true})` for markdown. auto-sent user chunks render with a small `auto` pill next to the "you" label.
- status states: `thinking` shows pulsing dot; `respawning` / `error` show muted message text.

---

## auto-break-down (server-driven send)

when the decisions observer flags `open: true` with a non-empty `prefill`, the server fires that prefill into the chat-agent automatically — the user opens the session tab to a primed conversation instead of an empty input.

**triggers** (all must hold for `maybeAutoSendChat` to fire in `src/server.ts`):
1. `autoSendEnabled === true` — global flag, default **off**, runtime-mutable via POST `/chat/auto-send` or env `META_AUTO_SEND_ENABLED=1`.
2. `decision.open` and `decision.prefill` are present.
3. `isVisible(s)` — never auto-fires on ephemeral helpers or our own subprocesses.
4. per-session cooldown (`META_AUTO_SEND_COOLDOWN_MS`, default 5min) since last auto-send.
5. no chat thread activity within the cooldown window — skip if the session already has an in-flight conversation (no second front while the first is unread).

**seed payload** (`buildAutoSendSeed`):
```
The user just watched session "<info.slug>" finish a turn.
Observer flagged: <decision.insight>
Tags: <comma-sep>

Recent <N> closed turn(s) (oldest first):
---
metrics: <tok> tok · <tools> tools · +<la>/-<lr> lines
user: <userPrompt clipped to 800c>
assistant: <assistantExcerpt clipped to 600c>
---
... (up to last 5)
```
seed is prepended to the FIRST chat-agent prompt only (subsequent follow-ups go through naturally).

**recent-turn ring buffer**: `s.recentClosedTurns: Turn[]` capped at 5, pushed every time `result.closed` lands in `onEvent`. used as the seed source so the chat-agent has real context.

**toggle pill** (top-nav, right side): button with a colored dot indicator, label `auto break-down` (or `auto break-down · off` when disabled). aria-pressed reflects state. click → POST `/chat/auto-send` `{enabled}` → server flips `autoSendEnabled` → broadcast `autosend:setting` ws msg → all connected clients re-paint. optimistic local flip on click, reverts if the POST fails.

**auto-sent UI badge**: user-role chat-thread row carries a `auto` pill next to the "you" label when `chunk.kind === "auto"`. visually disambiguates server-fired from typed messages.

---

## ui visual spec (current — strawberry / cut-the-cake)

normative source of truth: `DESIGN.md` (visual) + `PRODUCT.md` (strategic). this section is a quick orientation.

**creative north star:** "the patisserie press." precision instrument that wears strawberry. cream-tinted page, hairline structure, two saturation roles only — strawberry (operative voice) and plum (chart-only second voice). per-session palette spreads the operative-voice role across six dessert hues hashed from sessionId.

**layout:** sticky frosted top nav (the only glass surface in the system). main grid: 1280px max, sidebar 320px sticky, detail pane fills the rest. mobile <880px collapses to one column. **sidebar/detail are visually separated** by a hairline strawberry-tint border-right + two-tone gradients (rose 0.32α on sidebar, cream 0.30α on detail) — barely-there, single-surface feel.

**top nav:**
- left: cake-slice logo + `cut-the-cake` wordmark in strawberry + tagline (>720px)
  - **brand jump-roll**: hovering the logo + wordmark area triggers a gsap timeline (jump up 16px → 360° z-rotation → drop, total ~1.3s, debounced via `playing` flag). ported from `/Users/oronans/workspace/cutcake`'s `brandJumpRoll`.
- right: `reconnecting…` indicator (when ws drops) + **auto-break-down toggle pill** (⚡ + colored dot + label, aria-pressed reflects server state) + GitHub pill (`★ —` placeholder, real link to oronanschel/cut-the-cake)
- background: `glass-paper` (rgba 253,249,250,0.72) + `backdrop-filter: blur(12px) saturate(140%)`. only blur in the system.

**ambient layers (behind everything):**
- `.bg-blobs` — three large blurred radial blobs (warm pink + lavender), `position: fixed`, `z-index: -1`, `filter: blur(80px)`. fixed in viewport, no animation.
- `.sprinkles` — 14 / 30 small dots+dashes (count by viewport), randomized hue+position+rotation, gsap yoyo float (`sine.inOut`, 4–8s). `prefers-reduced-motion` → static.

**per-session colour palette:**
- six hues hashed deterministically (djb2 mod 6) from `sessionId`: strawberry, peach, mint, blueberry, lavender, honey. each defines `accent`/`accent-hover`/`accent-soft`/`plum`.
- applied via inline `style.cssText = sessionColorVars(sid)` on each card root *and* on `#detail-content` when a session is selected. existing CSS rules use the same `--accent`/`--plum` tokens, so the override scopes cleanly. brand-level chrome (top nav, gh-pill) lives outside those scopes and stays strawberry.
- helpers in `public/index.html` near `SESSION_PALETTE` definition.

**sidebar inbox (diff-rendered + FLIP):**
- session cards keyed by `sessionId` in a `cardEls` Map; persists across 5s ticks (no innerHTML clobber).
- enter animation: `scale 0.55 → 1`, `y -22 → 0`, opacity 0 → 1, `filter blur(6px) → 0`, `back.out(1.3)`, 1.4s, with `0.07s * idx` stagger and `transformOrigin: "50% 0%"` (pinned to top — magicui `originY: 0`).
- exit animation: opacity 0, x: -24, height/padding/margin → 0, `power2.in`, 1.2s, then DOM remove.
- **FLIP layout** for inserts: snapshot persisting cards' `getBoundingClientRect().top` BEFORE the upsert, animate from delta after, `power3.out 0.55s, overwrite: "auto"`. mirrors `motion`'s `layout` prop in vanilla js.
- update pulse: when `cardSig` (lastEventTs / latest insight) changes, `is-updated` keyframe fires — accent box-shadow ring (8px) + 2.2% scale, 1.6s, `ease-out`. ignores model/state/elapsed (avoids minute-tick flash).
- card body: project-name title (chat-agent sessions show `<upstream-project> · chat` instead, via server-side `displayName`) + model-tag pill + insight prose (when flagged) + foot line (mono Pewter, optional source · tags · live/Xs ago/idle Xm).
- selected card: accent-tint bg, accent border, **svg mascot** avatar in bottom-right corner (36×36px, `bottom: 1px`, `right: -2px`). MASCOT_ACTIVE = `mascot-uni-2.svg` (live state), MASCOT_IDLE = `mascot-uni-1.svg` (idle ≥5min). overlays the model tag + foot line via `z-index: 2` — no padding-right reserve, so layout doesn't shift. images carry `draggable="false"` + CSS `-webkit-user-drag: none`.
- **mascot hover anim**: jump up 9px + scale 1.07 + 360° rotation around the **y axis** (turntable spin, distinct from the brand's z-spin) + `back.out(1.2)` settle on landing. gradual opacity dive to 45% during the jump (`power2.inOut`, ~400ms), holds at 45% during the flip, gradual return to 100% during the landing. delegated via `mouseover` on document so re-rendered cards pick up the listener for free; `dataset.flipping` cooldown prevents stacked timelines.
- ambient quiet: when every visible session is idle 5min+ and nothing's selected, sidebar collapses to one mono line; mouse movement temporarily wakes for 30s.

**right pane (detail):**
- empty state: cake-duo illustration + italic "select a session" (replaces the old dashed-outline panel).
- when a session is selected, the detail-content children blur-fade in with a **two-tier cascade** — region step `0.12s`, leaf step `0.04s`, duration `0.75s`, `power2.out`. plan: `.session-head` (h2 + .source) → `.charts-band` (#d-chart, #d-code-chart) → `.conversation` (rows) → `.chat-input` (children). every component gets its own beat.

**charts band** (above the conversation, collapsed by default — `chartsBandExpanded: Set<sessionId>`):
- **first-look intro**: very first time a session has charts to show, the band auto-opens, plays the entrance, dwells 2.2s, and animates closed. `chartsIntroducedHas/Set` persists the flag in localStorage so reloads don't replay it. user opening it manually counts as "introduced" too.
- **expand**: bars `scaleY: 0 → 1` with forward stagger and `back.out(1.4)` overshoot. on the renderDetail blur-fade cascade (the `opening` case) we skip the band-level scale entrance since the cascade already animates the chart-cards; on later renders the band itself rises + scales in.
- **collapse**: bars deflate end-to-start (the visual sweeps back toward the toggle), chart-cards shrink + blur in parallel with the tail of that, the band's measured pixel height + margin + opacity fold to 0 with `power3.inOut`, then the toggle button does a 1.0→1.15→1.0 yoyo pulse to mark "the charts went here."
- **reentrancy**: callers flip `chartsBandExpanded` BEFORE calling, so a re-click mid-tween reverses direction; `gsap.killTweensOf` stops in-flight tweens; `animateExpandChartsBand` clearProps any inline styles a killed collapse left behind.
- two-column grid (1fr 1fr), each pinned: `#d-chart` left, `#d-code-chart` right. when one suppresses, its slot stays empty (no auto-stretch).
- each chart in a `.chart-card` with soft tinted gradient (pink for complexity, green for code) + colored hairline border
- head row: tinted icon bubble (line-graph svg / `</>` svg) + uppercase mono title in card's accent color + legend pills (white surface, hairline border, colored square dot, sans label, "you/agent" or "added/removed")
- bars: `flex: 1 1 0`, max-width 56px per pair, max-width 22px per bar — distribute via flex with no horizontal scroll
- complexity: input accent @ 0.55 opacity, output plum @ 0.9; latest pair gets plum @ 1.0
- code-changes: added diff-green @ 0.9, removed diff-red @ 0.9; chart self-suppresses on all-zero
- both charts cap at `CHART_TURNS = 5` (last 5 turns only, no scrolling)
- y-axis: 3 ticks (top yMax, mid yMax/2, bot 0). x-axis: dropped (no time labels). foot: small mono Pewter "Xm ago" right-aligned, derived from latest turn's `endTs`.
- **frosting cap (current):** each `.cx-bar` ≥ `BAR_FROST_MIN_PCT` (25%) carries a `<span class="bar-frost">` styled with `mask-image: url(/assets/frosting-new.svg)` and `background-color: color-mix(in oklab, currentColor 60%, white 40%)` (so icing reads lighter than the bar — not just paint). 36px tall cap with **20% rim above** the bar's top edge / **80% overlap inside** the bar.
- **hover-burst sprinkle spray**: `mouseover` on a frosted bar fires a radial gsap burst — 9 sprinkles distributed across the full 360° (slice + ±35% jitter), 30–50px outward in one tween, ~60% match the bar's own color + ~40% accent picks for variety, 800ms per-bar cooldown via `dataset.burstTs`. only frosted bars participate.

**conversation strip** (between charts and chat input):
- exactly three messages: `prev-agent → you → agent`. older turns intentionally hidden — chat input below is the surface for the current ask.
- agent text rendered as markdown via `marked.parse({breaks: true, gfm: true})` into `.conv-md` (claude-session styling: headings, lists, fenced code, inline code, blockquote, hr, links).
- agent blocks height-truncate at 240px with a fade-out gradient + `show full` toggle (mono accent button). expanded state survives 5s refresh ticks via `expandedBodies` Set keyed `(sessionId, turnId, role)`.
- user text is plain `escapeHtml` + pre-wrap (no markdown).
- role labels: mono 10px uppercase Pewter, with `you` colored accent.

**chat-thread block** (between conversation strip and chat input — only rendered when active):
- one row per chunk in `chatThreadByKey[sessionKey]`. role label `you` (accent) / `agent` (plum), mono uppercase 10px.
- user rows: plain `escapeHtml`, pre-wrap. server-fired chunks (`kind:"auto"`) render with a small `auto` pill next to the role label.
- agent rows: `marked.parse({breaks:true, gfm:true})` into `.conv-md` (same styling as the conversation strip).
- status pill at the bottom: `thinking` (pulsing dot), `respawning` (muted), `error` (with message). hidden when status is `idle` or `spawned`.

**chat input** (one per session):
- container: surface bg, hairline border, panel radius
- context line: ⚡ "break it down" mono accent label + observer's latest insight prose (or italic muted "no observer flag yet — pick this up and edit it.")
- textarea: paper bg → flips to surface on focus + accent border
- send button: 44×44 accent square with **inline svg arrow-up** glyph (Lucide). on click → `fetch('/chat/send', {method:'POST', body: {sessionKey, text}})`. textarea clears on success; chunk arrives back via ws and renders in the chat-thread above. `⌘ ↵` keyboard shortcut wired.
- tip line: mono Pewter "tip: ask for smaller steps, rationale, or alternatives" left + "⌘ ↵ to send" right
- per-session draft state in `chatDrafts` Map (lost on reload).

**wandering cake-perch mascot** (one per detail pane, picks a random target on session-open):
- pool of perch surfaces: `.cx-bar.bar-output` / `.cx-bar.bar-added` (size 26px, only frosted), `.chart-card` (38px, top-right), `.session-head h2` (30px, right of text), `.chat-input` (36px, top-right). size adapts per surface.
- target + tilt are deterministic via `djb2(sessionId + ":" + salt)` so a session keeps a consistent look until the wander-salt bumps. icon hashed without salt: pool of three palette-unified svgs (`mascot-uni-{1,2,3}.svg`) so different sessions get different mascot poses while the cartoon reads as the same character. the sidebar mascot uses uni-1 / uni-2 from the same pool; the wandering perch picks any of the three.
- **15 mild reactions** picked at random per hover (walkFlip, nod, hop, breathe, peek, wiggle, spin, squish, lean, shy, bobble, doubleFlip, shimmy, stretch, bow). 1/20 hovers roll an over-the-top **special** instead: full-screen sparkle explosion radiating from the perch, confetti rain from the top of the viewport, hue-rotate disco spin via a proxy tween, or a comic-burst with an expanding accent ring. each reaction returns a gsap timeline; outer span owns positional CSS transforms so all reactions animate the inner `<img>` (touching the span clobbers `translate(-50%) rotate(tilt)`). cleanup `gsap.set` resets every prop the pool touches so leftover state never leaks between picks.
- **pester-driven wander** (`recordPerchHover` + `wanderPerch`): hover timestamps tracked in a 30s sliding window; crossing a per-trigger threshold (rerolled to 2..5 each fire) bumps a per-session salt mixed into placeCakePerch's hash so the next render lands on a fresh anchor. icon hash deliberately omits the salt — same mascot character, different perch. specials don't count toward the threshold (the reward shouldn't be the bait).
- impl: `placeCakePerch(sessionId, {animate})` + `wanderPerch(sessionId)` in `public/index.html`. `animate:true` fades the prior cake out before the new one mounts; wander adds a `back.out(1.6)` drop-in on the new perch after a 0.18s delay so the cross-fade reads cleanly. images undraggable via CSS + `draggable="false"` attr.

**motion:** `prefers-reduced-motion: reduce` zeroes all gsap + css transitions. default ease `cubic-bezier(0.22, 1, 0.36, 1)`.

**removed in d27b2ac:** the "what happened so far" summary panel + cake-clouds banner backdrop + tag-chips. see commit `d27b2ac` for the diff if you want it back.

---

## session pickup logic (server + client)

both sides cooperate to keep the inbox tight; understand both before touching either.

**server (`src/tailer.ts` + `src/server.ts`):**
- tailer registers a `FileState` for any jsonl whose mtime is within `META_INBOX_MINUTES` (default 240min / 4h).
- two discovery channels: per-tick re-glob (`pollMs` = 500ms) + recursive `fs.watch` on each source root (`~/.claude/projects/`, `~/Library/Application Support/Claude/local-agent-mode-sessions/`). watch fires `wake()` so a new file appears within ~10ms instead of waiting for the next poll. watch errors are swallowed — the poll is the source of truth, watch is a wake-up.
- server's `recentSessions()` further filters by `isInWindow` (same `RECENT_MS` threshold, recomputed against `Date.now()`).

**client (`public/index.html` `sortedSessions()`):**
- displays everything the server kept in-window. (the old `s.threads.length > 0` filter was removed — it hid sessions whose only signal was an observer `open: true` decision, since observer decisions never mirror to `s.threads`.)
- **lineage collapse** (abtop-inspired, `find_live_session_id` at `vendor/abtop/src/collector/claude.rs:1029-1041`): groups sessions by `(source, slug)`. within a lineage, the freshest is always shown; non-freshest siblings show only while *they themselves* had activity in the last `LINEAGE_FRESH_MS` (60s). this hides:
  - `/clear` predecessors after ~60s (claude code mints a new sessionId+jsonl in the same project dir, leaving the old jsonl dormant)
  - dead orphaned subprocesses (e.g. `bun --hot` flushing observer subprocesses in seconds-apart bursts)
  - stale temporary-shell jsonls (`-private-var-folders-...`) that linger for hours
  parallel terminals on the same project keep emitting events and stay visible.
- since we have no PID-FD discovery (would need libproc/Bun bindings), this is a heuristic, not abtop's exact mechanism. good enough in practice; a sibling that pauses >60s and then types again pops back in.

**ALL of the lineage-collapse + temp-folder filter + slug-matching self-feed filter become obsolete the moment `META_USE_PROCESS_DISCOVERY=1` flips.** `src/registry.ts` already returns the live, post-/clear-repaired set, with our own SDK subprocesses tagged `isInternal`. delete plan is in commit 6 (resume-here queue item #1).

if "missing sessions" comes up again:
- `curl -s localhost:3737/sessions` — what the server is keeping (legacy mtime view, source-of-truth today).
- `curl -s localhost:3737/diag/discovery` — what the abtop-style PID-driven view sees this tick.
- `curl -s localhost:3737/diag/discovery-vs-tailer` — set diff. `onlyInDiscovery` should be small (idle-but-live sessions or just-spawned ones); `onlyInTailer` should mostly be `-private-var-folders-...` ephemeral helpers and dead-PID ghosts.

---

## open issues / known bugs

1. **observer profile not persisted.** each respawn = fresh sdk session for the decisions subprocess. fix: capture `session_id` on first response per loop, pass `{ resume: id }` on respawn. profile state would persist across server restarts via `~/.cut-the-cake/observer.session`.

2. ~~**send button is a stub.**~~ **RESOLVED** in `5f2d750`. POST `/chat/send` is wired end-to-end with chat-host + chat-thread block + ws fanout.

3. **observer cwd path still references the old name.** `~/.chunk-to-chat/observer/` is what gets created on first run. local cosmetic — sandbox works fine. rename to `~/.cut-the-cake/observer/` next time observer.ts is touched. (chat-agent uses `~/.cut-the-cake/chat/<hash>/`.)

4. **dev hot-reload conflicts with the observer.** `bun run dev` (`bun --hot`) respawns the server on src edits, orphaning the existing sdk subprocesses. for now: use `bun run src/server.ts` directly when observer is on. better fix: process-exit cleanup hook.

5. **task-notification turns trigger** — system-reminder text from claude code task-notifications gets parsed as `user_message` records and can flag threads. observer's `meta-feedback` tag handles this when it works, but a parser-level filter in `jsonl.ts` would be cleaner.

6. **doc drift — "passive" / old name in older notes:**
   - `notes/plan.md` — still references "chunk-to-chat" + "passive observer" framing
   - `notes/claude-mem-patterns.md` — still references "passive"
   - `.impeccable/design.json` — sidecar from the indigo era; STILL stale even after the DESIGN.md regen at `38b5be5` (impeccable's own doc says "regenerate the sidecar whenever you regenerate root DESIGN.md"; the regen pass was interrupted before the sidecar got rewritten).
   - DESIGN.md vs PRODUCT.md drift: DESIGN.md now enumerates **six** "concentrated whimsy spots" (logo + sidebar mascot + wandering cake-perch + frosting caps + sprinkle hover-burst + empty-state cake-duo); PRODUCT.md still says "five places exactly, no more." resolve before the next visual pass — either drop one (cake-duo + cake-perch overlap conceptually) or update the rule.
   doc-only cleanup; not user-facing.

7. **abort propagation depth.** server shutdown calls `observer.stop()` + `chatHost.stop()`, then `setTimeout(exit, 500)`. unverified the sdk subprocesses actually die in that window — could orphan on slow shutdown.

8. **bg-blobs occasionally render outside the viewport on very small windows** — `position: fixed; inset: 0; overflow: hidden` should clip them but on iOS Safari with rubber-band scroll the blobs can briefly peek. minor.

9. **gh-pill star count is hardcoded `—` placeholder.** real github star fetch not wired (would need a client-side fetch to `api.github.com/repos/oronanschel/cut-the-cake` with rate-limit awareness, or a build step).

10. ~~**orphaned assets.**~~ **RESOLVED** — the asset directory has been pruned to just `frosting-new.svg` + `logo-cake-slice.webp` + `mascot-uni-{1,2,3}.svg`. legacy frost / banner / cake-duo / send-button-rocket / cake-icon / mascot-var-2 / mascot-var-3 / mascot-uni-23-anim files all gone.

11. **chat input prefills the same insight even after auto-fire.** when auto-send fires using the observer's latest prefill, the chat-input textarea still shows that same prefill — a user might re-send it. fix: when `lastAutoSendTs[sessionKey]` covers the current insight, render an empty placeholder textarea instead of the prefill. (cosmetic, called out during verification of the auto-send wire-up.)

12. **chat thread state is in-memory only.** `chatThreads` and `chatStatuses` are server-side Maps that don't persist across restarts. on a server reboot, an in-flight conversation is lost from the UI even if the chat-agent subprocess could conceptually be resumed.

13. **the registry discovers our own server's bun process indirectly.** `bun run src/server.ts` doesn't match `cmdHasBinary(cmd, 'claude')` so we don't pick it up as a session, but it does spawn one ps-shell-out per tick (every 2s). on a quiet machine this is ~700 procs scanned per tick. fine for now; if it becomes hot we can cache per slow-tick like abtop does.

14. **`/diag/discovery` only covers the cc default config dir** (`~/.claude`). users with a custom `CLAUDE_CONFIG_DIR` won't see those sessions in the abtop view. abtop reads `/proc/<pid>/environ` (linux) / libproc (mac) per PID on slow-tick to discover the env var; for our needs the default-only path is fine — if anyone hits this we can add the env walk later. fully-defaulted machines (i.e. ours) match abtop output exactly.

---

## what's next (priority order)

**already landed in this run** (commits since last state.md update):
- ✅ `38b5be5` — DESIGN.md regenerated from current code via `/impeccable document` (per-session palette, six dessert hues, mascots, frosting caps, sprinkle burst, FLIP, charts band, chat-thread, brand jump-roll). +345 / −220 lines. tagged `pre-design-md-refresh` (on `d72ec37`) and `post-design-md-refresh` (on `38b5be5`).
- ✅ `87b0745` → `10b3d16` — wandering cake-perch pool iteration, ending with palette-unified `mascot-uni-{1,2,3}.svg` (tagged `wandering-mascot-unified`).
- ✅ `267c8ea` → `7c05566` — **abtop pivot, 5 commits, methodical port** of `vendor/abtop/src/collector/{process,claude,codex,mod}.rs` into typescript. process-driven session discovery runs every 2s in shadow mode at `/diag/discovery` + `/diag/discovery-vs-tailer`. legacy mtime-driven tailer is still source-of-truth for the inbox (flag default `META_USE_PROCESS_DISCOVERY=0`).
- ✅ `b112783` — chat-thread UX: only the last 2 chunks render by default; older history hides behind a "show N earlier" toggle; sending auto-collapses again.
- ✅ `841c940` — inbox separator + hash recovery. user-driven sessions on top, dashed-hairline `internal · sdk subprocesses` divider, then internal sdk subprocess threads. surgical `maybeRecoverStaleHash()` replaces the previous reload-on-upstream.
- ✅ `54b120c` — observer + mascot: **drop namer**, name chat sessions via server-derived `displayName: "<upstream-project> · chat"`, expand the wandering cake-perch reactions (15 mild + 4 over-the-top specials at 1/20 hover chance + pester-driven wander on 2-5 hovers in 30s + undraggable mascot images).
- ✅ `2ca8845` — charts-band: animated expand/collapse + first-look intro. shared timeline drives both manual toggle and a one-time auto-intro (band opens, dwells 2.2s, auto-collapses). bars stagger-grow on expand, deflate end-to-start on collapse, band height folds, toggle pulses.
- ✅ `62aea60` — codex: port abtop's JSONL schema into the tailer pipeline. new `src/codex-jsonl.ts` with stateful `parseCodexRecord(raw, state)`. tailer adds a codex source target. codex sessions now feed the inbox like cc, with full turn aggregation + token counts.
- ✅ video-pane build (3-hour autonomous run; pre-anchor `pre-registry-flip` at `a1044a9`) — new `src/scriptifier.ts` (sonnet sdk subprocess modelled on observer.ts; tools off; cwd `~/.cut-the-cake/scriptifier/`; per-turn batch with batchMs=2000 default; emits `{turnId, beats:[{text, marker?, emphasis?}]}` with markers INSIGHT/BE_CAREFUL/STEP/NOTE), new `src/tts.ts` (wraps `npx hyperframes tts` + `npx hyperframes transcribe`; sha256-keyed cache at `~/.cut-the-cake/tts-cache/`; default voice `af_heart`). server.ts adds `SessionState.scripts` lifecycle (`drafting→rendering→ready|error`), per-turn dispatch alongside observer, ws msgs `script:beats` / `script:ready` / `script:error`, `GET /tts/<hash>.wav` route. `public/index.html` adds a `.video-pane` block between charts-band and conversation: scrolling beat stack, rAF-driven word-level karaoke highlight via `audio.currentTime`, marker chips with fixed cross-session colors, play/pause + scrub + mm:ss time, runtime cache so refresh ticks reuse the audio element. e2e verified live (synthesized closed turn → 9 beats / 2 markers in <2s, tts in 15.75s, transcribe in 3.71s, full payload in `/state` and ws hello, `/tts/<hash>.wav` streams real WAVE bytes). visual layer NOT verified in a browser this run — chrome-devtools-mcp wedged on every list_pages/new_page with "selected page has been closed".

---

**resume-here queue** (in priority order):

1. **visual verification of the video-pane.** open http://localhost:3737/ in chrome with a closed turn already in `s.scripts`, confirm: video-pane card renders between charts-band and conversation; beats stack scrolls; current beat is larger + opaque while past/future beats are dimmed; rAF karaoke highlight steps through words in sync with the wav; marker chips show with their fixed colors (yellow/amber/blue/cream-dashed); play/pause + scrub + time labels work; cascade blur-fade picks up the new region; reduced-motion path doesn't break. Likely small CSS/animation tweaks land here. The hour-2 worker flagged a few "polish" TODOs that fit naturally in this pass: older-script picker (multiple turns per session — `activeScriptByKey` is wired but no UI yet); auto-play once `script:ready` arrives if the session is currently visible AND there's been a user gesture; multi-word emphasis matching (today's tokenizer can't match `["edge case"]` because it splits on whitespace); fallback word-distribution recompute on `loadedmetadata` when timings absent; mobile/narrow stacking for the controls row; `aria-live="polite"` on the stage; pause-all on ws close.

2. **flip the registry to drive the inbox.** delete `LINEAGE_FRESH_MS` lineage-collapse in `public/index.html`, delete the slug-matching self-feed filter in `src/server.ts` (lines around the `chunk-to-chat-observer` / `cut-the-cake-chat` / `cut-the-cake-scriptifier` includes — `entrypoint:'sdk-cli'+isInternal=true` covers it), drop the `recentMs` first-touch gate in `src/tailer.ts` (server-side `isInWindow` is enough), then change `META_USE_PROCESS_DISCOVERY` default to `1` and rewrite `recentSessions()` in `server.ts` to merge `registry.current().sessions` with the existing per-session SessionState map. claude.app local-agent-mode source has no `sessions/{PID}.json` so it stays on the legacy fs-watch path — the registry handles cc only. (codex was on the registry already; with `62aea60` it now also flows through the tailer event pipeline, so the registry-as-driver flip should make the two views consistent.) ~150 line net deletion. one PR.

3. **regenerate `.impeccable/design.json` sidecar.** DESIGN.md was refreshed at `38b5be5` but the sidecar is still on the indigo-era schema (says "chunk-to-chat", carries old tokens). simple fix: re-run `/impeccable document` and accept the sidecar write this time, or hand-edit. (open issue #6.)

4. **observer profile persistence (M2)** — store `session_id` to `~/.cut-the-cake/observer.session`, pass `resume: id` on respawn. preserves accumulated context across server restarts. same idea applies to the new scriptifier subprocess once observer's pattern is settled.

5. **chat input prefill cleanup after auto-send** — when an auto-send has fired for a session, blank the textarea instead of re-rendering the same prefill the server just sent. one-line conditional in `renderChatInput`. (open issue #11.)

6. **PRODUCT.md "five places" vs DESIGN.md "six concentrated whimsy spots".** drop one (cake-duo + cake-perch overlap) or update PRODUCT.md to six. (open issue #6.) — note: the video-pane is *not* a whimsy spot; it's a functional alternative-modality, so it doesn't bump the count.

7. **sidebar update-pulse signature tuning.** `cardSig` currently includes `lastEventTs`, which jumps on every event. for very chatty sessions the pulse fires constantly. consider gating to `insight` only, leaving the live-border + opacity for "still active" signal.

8. **rename observer cwd.** `~/.chunk-to-chat/observer/` → `~/.cut-the-cake/observer/`. cosmetic but consistent. (open issue #3.)

9. **github stars on the gh-pill.** small cdn fetch; cache 10min in localStorage; fall back to `★` glyph + repo name if rate-limited.

10. **rewrite `notes/plan.md` and `notes/claude-mem-patterns.md`** to drop "passive" framing and the old name. doc cleanup.

backend / observer work (independent of the design queue):

11. **feedback channel (M3)** — server tracks user interactions (which auto-fires the user kept vs ignored, which prefills they edited heavily, which sessions they opened then closed without reading, *which video-pane scripts they actually played versus skipped*), pushes a periodic summary back into the decisions observer. observer adapts gate.

12. **userpromptsubmit hook (phase E)** — once we have a refined "break it down" thread, a hook script should be able to inject the chat-agent's last reply into the user's main cc session. correct stdout shape per `claude-mem-patterns.md` §21.

13. **PID → FD session discovery (abtop-style).** would replace lineage-collapse heuristic with authoritative "this jsonl is held open by a live claude process" signal. requires libproc bindings on macOS / `/proc/<pid>/fd` on Linux / sysinfo on Windows. defer until the heuristic visibly fails.

14. **video-pane: explore live-render path** — current implementation renders MP4-equivalent latency (~3-5s for sonnet beats + 15-20s for TTS) before any video content shows. for "truly parallel to the text back and forth" the next horizon is per-beat streaming: scriptifier emits beats as it produces them (sonnet token streaming → beat-level batching), tts is invoked per-beat instead of once-per-script, client appends as audio segments arrive. requires switching from `query()` non-streaming to a streaming consumer in scriptifier.ts and a chained `<audio>` queue or media-source-extensions on the client.

---

**process notes for the next session:**
- per saved feedback memory: invoke `codex:rescue` for an independent pass after big chunks, before starting the next.
- design source-of-truth: `PRODUCT.md` (strategic) + `DESIGN.md` (visual). both are normative. DESIGN.md was refreshed at `38b5be5` and is now the canonical token reference; the sidecar at `.impeccable/design.json` is stale and should not be trusted.
- the user prefers short replies. when iterating on UI, propose 2–3 directions tightly and let them pick a letter. **escalation:** when relaying long structured output from `/impeccable` or other agent skills, summarize into a few bullets first — the user said "this is too much for me to read at once" mid-`/impeccable` critique and asked for the shorter version. relay tightly, don't dump.
- after any animation change, the user has stated "too fast" / "milder" multiple times — bias slow + soft on initial proposals.
- when verifying UI changes, drive the page via chrome-devtools-mcp (snapshot → click/fill → evaluate_script) — saved an enormous amount of round-tripping during the chat-agent + auto-send wire-up.
- if "missing sessions" comes up, hit `curl -s localhost:3737/sessions` first to see what the server's actually tracking. layered filters are: temp-folder filter → `isInWindow` → lineage collapse → client `sortedSessions`.
- **mascot eye conventions** (clarified this session): when the user says "right eye" they mean the viewer's right side of the image, not the cupcake's anatomical right. confirmed during the wink-animation work — they wanted the higher-x (viewer's right) eye to wink, not the lower-x.

---

## key references

- **`notes/plan.md`** — v1 plan: phases, data model, hook contract, defaults (still uses old name; see issue #7)
- **`notes/claude-mem-patterns.md`** — 24-section reference. especially:
  - §1 FileTailer (we lifted this)
  - §3 file discovery (we now use both per-tick poll + recursive fs.watch wake-up — see `src/tailer.ts`)
  - §11 worker daemon health/readiness (skipped — overkill for our scale)
  - §21 additionalContext injection (will be load-bearing for phase E)
- **magicui sources** at `vendor/magicui/` (gitignored). copies of `apps/www/registry/magicui/blur-fade.tsx` and `apps/www/registry/magicui/animated-list.tsx`. we ported them to vanilla js + gsap.
- **`vendor/claude-mem/`** — observer pattern source; especially `src/services/worker/ClaudeProvider.ts`. also `src/services/transcripts/watcher.ts` for the tailer's recursive fs.watch shape.
- **`vendor/abtop/`** — token-counter and discovery patterns. especially:
  - `collector/claude.rs:1323-1343` (token counter, consulted earlier)
  - `collector/claude.rs:1029-1041` (`find_live_session_id`, the shape that inspired our lineage collapse)
- **`public/assets/frosting-new.svg`** — current bar-plot frosting cap silhouette; loaded via CSS `mask-image` on `.bar-frost`.
- **`/Users/oronans/workspace/cutcake`** — reference site we ported `brandJumpRoll` from. `app.js:618-635` is the original animation timeline.

---

## conventions (per `~/.claude/CLAUDE.md` global)

- **never co-author commits.** all commits in user's name only.
- **after commits, check** if `CLAUDE.md` / `README.md` need updating (we have neither yet).
- **diagnostics scripts** go in `diagnostics/` (gitignored unless committed deliberately).
- **no console.log in committed code.** observer.ts + chat-agent.ts logs are intentional — that's stdout, not console.log. client `console.warn` lines exist for `/chat/send` failure paths, kept on purpose.
- **voice in code/copy:** lowercase prose, terminal flavor, dry-with-a-wink. variable names camelCase.
- **bun PATH:** `export PATH="$HOME/.bun/bin:$PATH"` in any new shell.

---

## dev-server lifecycle

- run (default, with observer): `bun run src/server.ts`
- run (no observer, hot-reload safe): `META_OBSERVER_ENABLED=0 bun run dev`
- typecheck: `bun run typecheck` (`tsc --noEmit`)
- port conflict: `lsof -ti :3737 | xargs -r kill -TERM`
- kill stray observer subprocesses: `pkill -f claude-agent-sdk`
- **do not** `pkill -f claude` — that matches your own claude code session.
- LAN access (e.g. from phone on same wifi): server already binds to `*:3737`; visit `http://<mac LAN ip>:3737/` (find via `ipconfig getifaddr en0`). first connection may trigger a macOS firewall prompt.

---

## quick smoke test

```bash
curl -s http://localhost:3737/sessions | python3 -c "
import sys, json, time
d = json.load(sys.stdin)
ss = d.get('sessions') or []
now = int(time.time() * 1000)
print(f'sessions reported: {len(ss)}')
groups = {}
for s in ss:
  k = s['info']['source'] + ' | ' + s['info']['slug'][:40]
  groups.setdefault(k, []).append(s)
for k, items in groups.items():
  items.sort(key=lambda s: -s['lastEventTs'])
  fresh = items[0]['lastEventTs']
  print(f'\n{k}  ({len(items)} jsonls)')
  for s in items:
    age = (now - s['lastEventTs']) / 60000
    visible = (s['lastEventTs'] >= fresh or (now - s['lastEventTs']) < 60_000) and s['inWindow']
    print(f'  age={age:6.1f}m thr={s[\"threadCount\"]:2} obs={1 if (s.get(\"observerDecisions\") or [{}])[0].get(\"open\") else 0} sid={s[\"info\"][\"sessionId\"][:8]} {\"VISIBLE\" if visible else \"hidden\"}')
"
```

if observer is up and there's been activity, expect at least 1 visible card per active project. dead orphaned subprocesses and stale temporary-shell jsonls should be hidden by lineage collapse.
