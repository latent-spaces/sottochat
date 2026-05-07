# state.md — cut-the-cake

cold-start brief. read this first when resuming. intentionally redundant with `plan.md` and `claude-mem-patterns.md`.

---

## what is this

**cut-the-cake** (formerly chunk-to-chat) — *turn long agent runs into a quick iterative chat.*

a chat layer for long claude code (and other autonomous agent) sessions. tails session jsonl files in real time, runs **two** long-lived sdk observers over the closed-turn stream — sonnet for per-turn decisions, haiku for session naming — and (when auto-break-down is on) automatically fires a sonnet chat-agent into a "break it down" thread the moment the decisions observer flags a turn.

the loop:

1. agents run (claude code cli, claude.app local-agent-mode; codex deferred)
2. cut-the-cake tails every cc-schema jsonl across all known roots, parses events, groups into turns
3. when turns close, they're batched (every 30s) and sent to **two** persistent sdk subprocesses:
   - **observer** (sonnet 4.6) returns per-turn `{open, insight, tags, prefill}`
   - **namer** (haiku 4.5) returns per-session `{sessionName}` (rolling display title)
4. ui shows a sidebar of session cards (left) + selected session detail (right). detail pane = charts band → 3-message chat strip → per-session chat-thread (the live "break it down" conversation) → chat input prefilled with the observer's prefill.
5. when the observer flags `open: true` *and* the global auto-break-down toggle is on, the server fires the prefill into the chat-agent automatically — pre-seeded with the observer insight + last 5 turn excerpts. user opens the tab to a primed conversation. follow-ups go through the same sdk subprocess (one per upstream sessionKey).
6. when auto-break-down is off (the default), the user clicks the send button → POST `/chat/send` does the same thing, just user-initiated.

what's wired: multi-source tailer (recursive fs.watch + per-tick poll, lineage collapse + temp-folder filter) · **abtop-style PID-driven session discovery in shadow mode** (process-discovery + claude-discovery + codex-discovery + registry; runs every 2s alongside the legacy tailer, exposed at `/diag/discovery` for parity verification, doesn't drive the inbox yet) · multi-session inbox · diff-rendered sidebar with magicui-style enter/exit/update pulse + FLIP layout (transform-leak fix) · **inbox separator + grouping**: user-driven sessions on top, `internal · sdk subprocesses` divider, then namer + observer + chat-agent threads · split observer (sonnet decisions + haiku namer, both with auto-respawn) · chat-agent host (sonnet, one persistent subprocess per upstream sessionKey, tools disabled) · POST `/chat/send` + ws chat:chunk/chat:status broadcasts · auto-send on observer open=true with 5-min cooldown + global toggle (default off) · chat-thread block in detail pane (markdown, "auto" badge for server-fired chunks) · **chat-thread collapses to last 2 messages by default** (per-session "show N earlier" toggle, auto-collapses on send) · charts above the conversation, panel-styled, capped to last 5 turns · soft pink visual system (full strawberry/dessert redesign, six-hue per-session palette) · sticky frosted nav with github pill + auto-break-down toggle · sidebar/detail visual separation · svg dripping-frosting cap on bar plots (color-mix lightened, only on tall bars) · hover-burst radial sprinkle spray out of frosted bars · brand jump-roll on the cake logo · wandering cake-perch mascot picks a random DOM target on session-open · palette-unified mascot trio (`mascot-uni-1/2/3.svg`) in the wandering pool · sidebar selected-card mascot with hover y-flip + fade in/out · DESIGN.md regenerated from current code (tagged `pre-design-md-refresh` / `post-design-md-refresh`).

what's not wired yet: **registry-as-driver** (flag exists at `META_USE_PROCESS_DISCOVERY=0`; flipping it + deleting lineage-collapse + slug-matching self-feed filter + `recentMs` first-touch gate is the next commit) · full codex jsonl parser (only `session_meta` is parsed today, enough for the inbox card; turn aggregation + token counts land when codex sessions plug into observer.ts) · observer profile persistence (`session_id` resume across restarts) · feedback channel back to observer · userpromptsubmit hook for the final injection back into the user's main claude session.

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
| `META_NAMER_MODEL`             | `claude-haiku-4-5`   | model for the session-naming subprocess                 |
| `META_CHAT_MODEL`              | `claude-sonnet-4-6`  | model for the "break it down" chat-agent subprocesses   |
| `META_OBSERVER_BATCH_MS`       | 30000                | batch interval for closed turns (ceiling, not heartbeat — quiet windows skip the call) |
| `META_OBSERVER_FRESH_MS`       | 300000               | only feed turns whose endTs is within this window       |
| `META_AUTO_SEND_ENABLED`       | 0 (off)              | set `1` to default-on the auto-break-down toggle        |
| `META_AUTO_SEND_COOLDOWN_MS`   | 300000               | per-session cooldown between auto-fired chats           |
| `META_MAGNITUDE_TOK`           | 1500                 | fallback trigger threshold (used when observer is off)  |
| `META_MAGNITUDE_TC`            | 5                    | fallback trigger threshold (tools/turn)                 |
| `META_MAGNITUDE_CHARS`         | 6000                 | fallback char trigger                                   |
| `META_USE_PROCESS_DISCOVERY`   | 0 (off, shadow mode) | when `1`, the abtop-style PID-driven registry (`src/registry.ts`) replaces the legacy mtime-driven tailer view as the source-of-truth for `recentSessions()`. shadow-mode runs the registry either way, exposed at `/diag/discovery`. |

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
- commit `841c940` — current head: inbox separator + surgical hash recovery.
  - sidebar: user-driven sessions on top, then a `internal · sdk subprocesses` dashed-hairline divider, then sessions whose slug matches `cut-the-cake-{chat,namer,observer}` / `chunk-to-chat-observer` (chat-agent + namer + observer). lazily-created separator that's removed when there are no internals to show. classification is slug-based today; once `META_USE_PROCESS_DISCOVERY=1` flips, the registry's `isInternal` flag becomes the authoritative source.
  - replaced the `b112783` debounced reload with `maybeRecoverStaleHash()` — runs once at hello, drops the URL hash silently iff it points at a sid the server doesn't have. the previous reload was firing on every upstream cc reply (every few seconds during active dev), nuking the textarea draft + per-session expand state mid-typing. chat-agent multi-turn already worked server-side; the bug was the browser killing itself.

---

## status (what's built / what's not)

| phase | description                                                            | state           |
|-------|------------------------------------------------------------------------|-----------------|
| 1     | jsonl tailer + raw event feed                                          | done (+ recursive fs.watch wake-up + lineage collapse + temp-folder filter) |
| 2     | turn assembly + magnitude trigger                                      | done            |
| A     | rename to chunk-to-chat → cut-the-cake + two-view ui shell             | done            |
| B     | multi-session inbox (cc + claude.app local-agent-mode)                 | done            |
| C     | observer wiring (split: sonnet decisions + haiku namer)                | done · committed (profile-resume across restarts not, feedback channel not) |
| D     | break-it-down item flow (POST /chat/send + chat-thread + auto-send)    | done · committed |
| D'    | auto-break-down global toggle (default off)                            | done · committed |
| E     | userpromptsubmit hook for handoff                                      | not started     |
| V     | strawberry/dessert visual system + animations                          | done · committed |
| V'    | per-session colors + sidebar separation + svg frosting                 | done · committed |
| V''   | new frosting svg + sprinkle burst + brand jump-roll + cake-perch       | done · committed |
| V'''  | svg mascots + sidebar mascot hover y-flip with fade in/out             | done · committed |
| V'''' | palette-unified wandering mascot trio + DESIGN.md regen                | done · committed |
| F     | abtop-style PID-driven discovery (process + claude + codex + registry) | done · committed (shadow mode — registry runs but doesn't drive inbox) |
| F'    | flip registry-as-driver + delete lineage-collapse + slug filter + recentMs gate | not started — that's the next commit |
| G     | chat-thread collapse to last 2 chunks + per-session expand toggle      | done · committed |
| G'    | inbox separator: user-driven sessions on top, sdk subprocesses below   | done · committed |
| G''   | surgical URL hash recovery (replaces the over-eager full-page reload)  | done · committed |

**current head:** `841c940` (inbox separator + hash recovery).

**working tree:** dirty (mid-flight asset work, none of it landed by this session):
- 4 deleted files (`bar-frost.svg`, `bar-frost-v2.svg`, `empty-state-cake-duo.webp`, `header-banner-cake-clouds.webp`) — the empty-state webp is still referenced at `public/index.html:1000` so the page will show a missing image until it's restored or the html swaps it out.
- untracked: `public/assets/mascot-var-3-{1,2}.svg` (legacy alternates after the unify), `public/assets/mascot-uni-23-anim.svg` (animated wink mascot, see below).
- modified: `notes/state.md` (this file — being updated post-pivot).

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
       │
       ▼
src/tailer.ts        per-file FileState (offset + partial + uuid dedupe);
                     per-tick re-glob baseline + recursive fs.watch
                     wake-up on each source root (claude-mem §3 pattern);
                     only tails files with recent mtime

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
src/jsonl.ts         parser → MetaEvent[]; extracts model + input/output tokens
                     + cache fields (sums to context size); lines added/removed
                     for Edit/MultiEdit/Write/NotebookEdit
       │  events
       ▼
src/turns.ts         per-turn assembly with running tally (tokens, tool count,
                     lines added/removed)
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

src/observer.ts      TWO persistent sdk subprocesses driven by a shared
                     startSdkLoop helper:
                       observer  · sonnet 4.6 · {decisions:[]}
                       namer     · haiku 4.5  · {names:[]}
                     batch every 30s, FIFO inflight tracking per loop,
                     auto-respawn on crash, SIGINT → abort + exit.
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

src/server.ts                    Bun server: per-session state, ws fanout, observer onDecision/onName,
                                 chat host, POST /chat/send + /chat/auto-send, auto-send dispatcher
                                 (buildAutoSendSeed + maybeAutoSendChat), temp-folder filter, /assets,
                                 GET /diag/discovery + /diag/discovery-vs-tailer (registry shadow view)
src/tailer.ts                    multi-source jsonl tailer (cc cli + claude.app); poll + recursive fs.watch
src/jsonl.ts                     record parser → MetaEvent[]; tokens, model, lines added/removed
src/turns.ts                     per-turn assembly + tally
src/triggers.ts                  fallback magnitude evaluator
src/observer.ts                  TWO sdk subprocesses (decisions:sonnet + namer:haiku) sharing a
                                 generic startSdkLoop helper; FIFO inflight per loop; respawn
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
                                 (markdown, tail truncation) · charts above conversation with
                                 frosting-new svg + color-mix lighter cap (only on tall bars) +
                                 hover radial sprinkle burst dominated by bar color · chat-thread
                                 block + chat input · wandering cake-perch mascot picks a random
                                 DOM target on session-open (size adapts per surface)

public/assets/
  cake-icon.svg                  primary mascot SVG (sidebar live state)
  mascot-var-2.svg               secondary mascot SVG (sidebar idle state ≥5min)
  mascot-uni-1.svg               wandering pool — canonical wine + strawberry palette (= mascot-var-2 verbatim)
  mascot-uni-2.svg               wandering pool — palette-unified recolor of legacy mascot-var-3-1
  mascot-uni-3.svg               wandering pool — palette-unified recolor of legacy mascot-var-3-2
  frosting-new.svg               bar-frost cap silhouette (in active use)
  logo-cake-slice.webp           top-nav logo (gets the brand-jump-roll on hover)
  send-button-rocket.webp        orphan (replaced by inline svg arrow) — safe to delete

  (untracked / dirty)
  mascot-uni-23-anim.svg         animated wink mascot — base = uni-2, eye-open paths + an
                                 eye-closed wink-arc lifted from uni-3 crossfade on a 4s loop
                                 (built by diagnostics/build-mascot-animation.mjs).
  mascot-var-3-1.svg             legacy alternate (pre-unify); now redundant.
  mascot-var-3-2.svg             legacy alternate (pre-unify); now redundant.

  (deleted on disk, not yet committed)
  bar-frost.svg, bar-frost-v2.svg            — legacy frost alternates; only frosting-new.svg is wired.
  empty-state-cake-duo.webp                  — STILL REFERENCED at public/index.html:1000.
  header-banner-cake-clouds.webp             — long orphan.

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

## the observer (split: decisions + namer)

`src/observer.ts` runs **two** persistent sdk subprocesses, both spawned via `query()` from `@anthropic-ai/claude-agent-sdk` and driven by a shared `startSdkLoop` helper that owns lifecycle, FIFO inflight tracking, and respawn. observer pattern is closely modelled on `vendor/claude-mem/src/services/worker/ClaudeProvider.ts`.

**common:**
- **auth**: uses your existing claude auth (whatever `which claude` returns).
- **disallowedTools**: `[Bash, Read, Write, Edit, Grep, Glob, WebFetch, WebSearch, Task, NotebookEdit, AskUserQuestion, TodoWrite]`. both subprocesses can think + emit text; neither can touch your files.
- **input feed**: an async-generator yielding synthetic user messages built from a queue; each loop has its own queue but `startObserver.feed(t)` enqueues into both.
- **batch tick**: 30s setInterval early-returns when the queue is empty — quiet windows skip the call. ceiling on send rate, not a heartbeat.
- **system prompt**: prepended to the first batch only.
- **respawn**: lifecycle while-loop, 5s backoff, 5 consecutive-failure cap. SIGINT/SIGTERM → abort + exit after 500ms grace.

**decisions subprocess** (the "observer" loop):
- model: `claude-sonnet-4-6` (env `META_OBSERVER_MODEL`)
- cwd: `~/.chunk-to-chat/observer/` — legacy path; rename to `~/.cut-the-cake/observer/` is open issue #3.
- response shape: `{decisions: [{turnId, open, insight?, tags?, prefill?}, ...]}`
- decisions feed `onDecision` callback in `src/server.ts` → ObserverInsight stored on SessionState → broadcast `observer:decision` ws msg → drives `maybeAutoSendChat` when open=true and the global toggle is on.

**namer subprocess** (the "namer" loop):
- model: `claude-haiku-4-5` (env `META_NAMER_MODEL`) — naming is a short label task, haiku is plenty.
- cwd: `~/.cut-the-cake/namer/` (fresh, on the new path)
- response shape: `{names: [{sessionKey, sessionName}, ...]}` — ≤20 chars, 2–3 words, lowercase, omit if only 1 turn seen this run.
- names feed `onName` callback → `s.sessionName` → broadcast `observer:name` ws msg → sidebar card title.

**self-feed filter** (`src/server.ts`): jsonl slugs containing `chunk-to-chat-observer`, `cut-the-cake-namer`, or `cut-the-cake-chat` are surfaced as cards but never fed back to the observer (would be an infinite mirror). plus the temp-folder filter (`-private-var-folders-`) hides claude code's own internal title-generator subprocesses entirely.

**what's not wired yet:**
- profile persistence — `session_id` is captured per spawn but not stored across restarts.
- feedback channel — user interactions not yet sent back to adapt the gate.
- per-turn pairing of tool_use ↔ tool_result — ignored.

**observer cost:** one sonnet batch + one haiku batch every active 30s, cache hits dominate. roughly the same envelope as the prior single-sonnet loop (haiku is cheap enough to be a rounding error).

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
The user just watched session "<sessionName>" finish a turn.
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
- update pulse: when `cardSig` (lastEventTs / latest insight / sessionName) changes, `is-updated` keyframe fires — accent box-shadow ring (8px) + 2.2% scale, 1.6s, `ease-out`. ignores model/state/elapsed (avoids minute-tick flash).
- card body: `[project] observer-name` title + model-tag pill + insight prose (when flagged) + foot line (mono Pewter, optional source · tags · live/Xs ago/idle Xm).
- selected card: accent-tint bg, accent border, **svg mascot** avatar in bottom-right corner (36×36px, `bottom: 1px`, `right: -2px`). MASCOT_ACTIVE = `cake-icon.svg` (live state), MASCOT_IDLE = `mascot-var-2.svg` (idle ≥5min). overlays the model tag + foot line via `z-index: 2` — no padding-right reserve, so layout doesn't shift.
- **mascot hover anim**: jump up 9px + scale 1.07 + 360° rotation around the **y axis** (turntable spin, distinct from the brand's z-spin) + `back.out(1.2)` settle on landing. gradual opacity dive to 45% during the jump (`power2.inOut`, ~400ms), holds at 45% during the flip, gradual return to 100% during the landing. delegated via `mouseover` on document so re-rendered cards pick up the listener for free; `dataset.flipping` cooldown prevents stacked timelines.
- ambient quiet: when every visible session is idle 5min+ and nothing's selected, sidebar collapses to one mono line; mouse movement temporarily wakes for 30s.

**right pane (detail):**
- empty state: cake-duo illustration + italic "select a session" (replaces the old dashed-outline panel).
- when a session is selected, the detail-content children blur-fade in with a **two-tier cascade** — region step `0.12s`, leaf step `0.04s`, duration `0.75s`, `power2.out`. plan: `.session-head` (h2 + .source) → `.charts-band` (#d-chart, #d-code-chart) → `.conversation` (rows) → `.chat-input` (children). every component gets its own beat.

**charts band** (above the conversation):
- two-column grid (1fr 1fr), each pinned: `#d-chart` left, `#d-code-chart` right. when one suppresses, its slot stays empty (no auto-stretch).
- each chart in a `.chart-card` with soft tinted gradient (pink for complexity, green for code) + colored hairline border
- head row: tinted icon bubble (line-graph svg / `</>` svg) + uppercase mono title in card's accent color + legend pills (white surface, hairline border, colored square dot, sans label, "you/agent" or "added/removed")
- bars: `flex: 1 1 0`, max-width 56px per pair, max-width 22px per bar — distribute via flex with no horizontal scroll
- complexity: input accent @ 0.55 opacity, output plum @ 0.9; latest pair gets plum @ 1.0
- code-changes: added diff-green @ 0.9, removed diff-red @ 0.9; chart self-suppresses on all-zero
- both charts cap at `CHART_TURNS = 5` (last 5 turns only, no scrolling)
- y-axis: 3 ticks (top yMax, mid yMax/2, bot 0). x-axis: dropped (no time labels). foot: small mono Pewter "Xm ago" right-aligned, derived from latest turn's `endTs`.
- **frosting cap (current):** each `.cx-bar` ≥ `BAR_FROST_MIN_PCT` (25%) carries a `<span class="bar-frost">` styled with `mask-image: url(/assets/frosting-new.svg)` and `background-color: color-mix(in oklab, currentColor 60%, white 40%)` (so icing reads lighter than the bar — not just paint). 36px tall cap with **20% rim above** the bar's top edge / **80% overlap inside** the bar. legacy `bar-frost.svg` + alternate `bar-frost-v2.svg` are kept as alternates if we want to swap masks later.
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
- target + tilt are deterministic via `djb2(sessionId)` so a session keeps a consistent look — different sessions pick different surfaces. icon also hashed: pool of three palette-unified svgs (`mascot-uni-1.svg`, `mascot-uni-2.svg`, `mascot-uni-3.svg`) so different sessions get different mascot poses while the cartoon reads as the same character. all three derive from the same canonical wine + strawberry + lavender palette (see `diagnostics/unify-mascot-colors.mjs`). the sidebar selected-card mascot pulls from a separate two-svg pair (`cake-icon.svg` for live, `mascot-var-2.svg` for idle); pools are intentionally distinct.
- **mounts silently** (no entrance gsap). prior cake fades out softly on session change before the new one mounts. re-mounted on every 5s refresh tick (chart/chat-input innerHTML wipes wreck DOM nodes inside them) with no animation, so the cake stays visually pinned.
- impl: `placeCakePerch(sessionId, {animate})` in `public/index.html`. `animate` only controls the prior cleanup fade — the new cake always mounts at rest.

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

1. **observer profile not persisted.** each respawn = fresh sdk session for both the decisions and namer subprocesses. fix: capture `session_id` on first response per loop, pass `{ resume: id }` on respawn. profile state would persist across server restarts via `~/.cut-the-cake/{observer,namer}.session`.

2. ~~**send button is a stub.**~~ **RESOLVED** in `5f2d750`. POST `/chat/send` is wired end-to-end with chat-host + chat-thread block + ws fanout.

3. **observer cwd path still references the old name.** `~/.chunk-to-chat/observer/` is what gets created on first run for the decisions loop. local cosmetic — sandbox works fine. rename to `~/.cut-the-cake/observer/` next time observer.ts is touched. (the namer already uses the new path: `~/.cut-the-cake/namer/`. chat-agent uses `~/.cut-the-cake/chat/<hash>/`.)

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

10. **orphaned assets.** `public/assets/send-button-rocket.webp` is still on disk but unreferenced (replaced by inline svg). `header-banner-cake-clouds.webp` was deleted in the working tree this session but not yet committed. legacy webp mascots already deleted in `c21139f`. **separate caveat:** `empty-state-cake-duo.webp` was also deleted in the working tree but is still referenced at `public/index.html:1000` — don't commit that deletion alone or the empty state will show a broken image.

11. **chat input prefills the same insight even after auto-fire.** when auto-send fires using the observer's latest prefill, the chat-input textarea still shows that same prefill — a user might re-send it. fix: when `lastAutoSendTs[sessionKey]` covers the current insight, render an empty placeholder textarea instead of the prefill. (cosmetic, called out during verification of the auto-send wire-up.)

12. **chat thread state is in-memory only.** `chatThreads` and `chatStatuses` are server-side Maps that don't persist across restarts. on a server reboot, an in-flight conversation is lost from the UI even if the chat-agent subprocess could conceptually be resumed.

13. **the registry discovers our own server's bun process indirectly.** `bun run src/server.ts` doesn't match `cmdHasBinary(cmd, 'claude')` so we don't pick it up as a session, but it does spawn one ps-shell-out per tick (every 2s). on a quiet machine this is ~700 procs scanned per tick. fine for now; if it becomes hot we can cache per slow-tick like abtop does.

14. **`/diag/discovery` only covers the cc default config dir** (`~/.claude`). users with a custom `CLAUDE_CONFIG_DIR` won't see those sessions in the abtop view. abtop reads `/proc/<pid>/environ` (linux) / libproc (mac) per PID on slow-tick to discover the env var; for our needs the default-only path is fine — if anyone hits this we can add the env walk later. fully-defaulted machines (i.e. ours) match abtop output exactly.

---

## what's next (priority order)

**already landed in this run** (commits since last state.md update):
- ✅ `38b5be5` — DESIGN.md regenerated from current code via `/impeccable document` (per-session palette, six dessert hues, mascots, frosting caps, sprinkle burst, FLIP, charts band, chat-thread, brand jump-roll). +345 / −220 lines. tagged `pre-design-md-refresh` (on `d72ec37`) and `post-design-md-refresh` (on `38b5be5`).
- ✅ `87b0745` — wandering cake-perch: pool swapped to two new mascot-var-3 svgs (mid-step toward the unified set).
- ✅ `f876adf` — wandering cake-perch: re-add `mascot-var-2.svg` for three variants total. tagged `wandering-mascot-var3`.
- ✅ `10b3d16` — wandering cake-perch: pool swapped to palette-unified `mascot-uni-{1,2,3}.svg`. all three share a canonical palette (wine outlines, body-pink + body-coral, cream + peach skin, orange + orange-deep, lavender pair) so the cartoon reads as the same character across sessions. legacy `mascot-var-3-{1,2}.svg` linger as untracked alternates. tagged `wandering-mascot-unified`. recoloring done by `diagnostics/unify-mascot-colors.mjs` (gitignored).
- ✅ `267c8ea` → `7c05566` — **abtop pivot, 5 commits, methodical port** of `vendor/abtop/src/collector/{process,claude,codex,mod}.rs` into typescript. process-driven session discovery now runs every 2s in shadow mode at `/diag/discovery` + `/diag/discovery-vs-tailer`. legacy mtime-driven tailer is still source-of-truth for the inbox (flag default `META_USE_PROCESS_DISCOVERY=0`). on this machine the diff endpoint shows the new view drops 3 `-private-var-folders-` ephemeral helpers + dead-PID ghosts that the legacy view leaks, and surfaces `entrypoint` / `status` / `name` / `version` fields cc 2.1.119+ writes that the tailer never read.
- ✅ `b112783` — chat-thread UX: only the last 2 chunks render by default; older history hides behind a "show N earlier" toggle; sending auto-collapses again so a fresh ask anchors on the new pair.
- ✅ `841c940` — inbox separator + hash recovery. user-driven sessions on top, dashed-hairline `internal · sdk subprocesses` divider, then namer + observer + chat-agent threads. surgical `maybeRecoverStaleHash()` replaces the previous reload-on-upstream which was too aggressive (was firing on every cc reply, killing in-progress chat-agent threads).

---

**resume-here queue** (in priority order):

1. **commit 6: flip the registry to drive the inbox.** delete `LINEAGE_FRESH_MS` lineage-collapse in `public/index.html`, delete the slug-matching self-feed filter in `src/server.ts` (lines around the `chunk-to-chat-observer`/`cut-the-cake-namer`/`cut-the-cake-chat` includes — `entrypoint:'sdk-cli'+isInternal=true` covers it), drop the `recentMs` first-touch gate in `src/tailer.ts:175` (server-side `isInWindow` is enough), then change `META_USE_PROCESS_DISCOVERY` default to `1` and rewrite `recentSessions()` in `server.ts` to merge `registry.current().sessions` with the existing per-session SessionState map (registry tells us *which* sessions; SessionState carries the per-session events/threads/observer decisions/chat thread). claude.app local-agent-mode source has no `sessions/{PID}.json` so it stays on the legacy fs-watch path — the registry handles cc only. ~150 line net deletion. one PR.

2. **finish the asset-cleanup commit.** the working tree carries 4 deletions + 2 untracked legacy mascots + the animated wink svg. resolve before continuing: restore or replace `empty-state-cake-duo.webp` (still referenced by `public/index.html:1000`), commit the `bar-frost*.svg` + `header-banner-cake-clouds.webp` deletions, decide whether to commit `mascot-uni-23-anim.svg` (built but not wired anywhere yet — see issue #13).

3. **regenerate `.impeccable/design.json` sidecar.** DESIGN.md was refreshed at `38b5be5` but the sidecar is still on the indigo-era schema (says "chunk-to-chat", carries old tokens). impeccable's doc says regenerate with the root file. simple fix: re-run `/impeccable document` and accept the sidecar write this time, or hand-edit. (open issue #6.)

4. **observer profile persistence (M2)** — store `session_id` to `~/.cut-the-cake/{observer,namer}.session`, pass `resume: id` on respawn. preserves accumulated context across server restarts. arguably the highest-value backend item now that the chat path is wired.

5. **chat input prefill cleanup after auto-send** — when an auto-send has fired for a session, blank the textarea instead of re-rendering the same prefill the server just sent. one-line conditional in `renderChatInput`. (open issue #11.)

6. **full codex jsonl parser (`src/codex-jsonl.ts`)** — `src/codex-discovery.ts` only parses the first-line `session_meta` event today. wiring codex sessions through the same observer/turns/triggers pipeline as cc requires emitting `MetaEvent`s for `event_msg` (user_message, agent_message, token_count, task_complete) and `response_item` (function_call/function_call_output for tool calls). reference: `vendor/abtop/src/collector/codex.rs:580-1150`. once landed, codex sessions get chat-thread treatment + observer flags identical to cc.

5. **PRODUCT.md "five places" vs DESIGN.md "six concentrated whimsy spots".** drop one (cake-duo + cake-perch overlap) or update PRODUCT.md to six. (open issue #6.)

6. **sidebar update-pulse signature tuning.** `cardSig` currently includes `lastEventTs`, which jumps on every event. for very chatty sessions the pulse fires constantly. consider gating to `(insight|sessionName)` only, leaving the live-border + opacity for "still active" signal.

7. **rename observer cwd.** `~/.chunk-to-chat/observer/` → `~/.cut-the-cake/observer/`. cosmetic but consistent. (open issue #3.)

8. **github stars on the gh-pill.** small cdn fetch; cache 10min in localStorage; fall back to `★` glyph + repo name if rate-limited.

9. **rewrite `notes/plan.md` and `notes/claude-mem-patterns.md`** to drop "passive" framing and the old name. doc cleanup.

backend / observer work (independent of the design queue):

10. **feedback channel (M3)** — server tracks user interactions (which auto-fires the user kept vs ignored, which prefills they edited heavily, which sessions they opened then closed without reading), pushes a periodic summary back into the decisions observer. observer adapts gate.

11. **userpromptsubmit hook (phase E)** — once we have a refined "break it down" thread, a hook script should be able to inject the chat-agent's last reply into the user's main cc session. correct stdout shape per `claude-mem-patterns.md` §21.

12. **codex schema parser** — `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`; uses different `{type, payload}` envelope. straightforward second parser branch in `jsonl.ts`.

13. **decide where the animated wink mascot lives.** `mascot-uni-23-anim.svg` was built but isn't wired into the wandering pool yet. options: replace one of the three uni svgs with the animated version (so ~1/3 of sessions get a winking cake), add as a fourth pool entry, or repurpose for a different surface (top-nav logo? sidebar mascot for "live"?). animation is pure inline css (opacity crossfade between open-eye and wink-arc paths), so it works inside `<img src=...>`.

14. **PID → FD session discovery (abtop-style).** would replace lineage-collapse heuristic with authoritative "this jsonl is held open by a live claude process" signal. requires libproc bindings on macOS / `/proc/<pid>/fd` on Linux / sysinfo on Windows. defer until the heuristic visibly fails.

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
- **`public/assets/frosting-new.svg`** — current bar-plot frosting cap silhouette; loaded via CSS `mask-image`. swap to `bar-frost.svg` or `bar-frost-v2.svg` by editing the `mask` URL in `.bar-frost`.
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
