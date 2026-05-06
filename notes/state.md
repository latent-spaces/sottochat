# state.md — cut-the-cake

cold-start brief. read this first when resuming. intentionally redundant with `plan.md` and `claude-mem-patterns.md`.

---

## what is this

**cut-the-cake** (formerly chunk-to-chat) — *turn long agent runs into a quick iterative chat.*

a chat layer for long claude code (and other autonomous agent) sessions. tails session jsonl files in real time, runs a single long-lived sonnet observer over the closed-turn stream, and surfaces moments worth user attention as 1-sentence insights + editable prefills the user can hand back to the original agent.

the loop:

1. agents run (claude code cli, claude.app local-agent-mode; codex deferred)
2. cut-the-cake tails every cc-schema jsonl across all known roots, parses events, groups into turns
3. when turns close, they're batched (every 30s) and sent to a persistent sonnet observer subprocess
4. observer returns per-turn `{open, insight, tags, prefill}` json plus a per-session `sessionName` (rolling display title — used in cards and detail header)
5. ui shows a sidebar of session cards (left) + selected session detail (right). detail pane is now a chat-style strip (prev-agent → you → agent, markdown-rendered, height-truncated) with one chat input at the bottom prefilled with the observer's prefill
6. user clicks the send button → **placeholder** (logs only); next step is to spawn a new sdk agent with that text and stream replies into the strip — `src/chat-agent.ts` is drafted but not yet wired

what's wired: multi-source tailer (recursive fs.watch + per-tick poll, lineage collapse) · multi-session inbox · diff-rendered sidebar with magicui-style enter/exit/update pulse + FLIP layout for inserts · observer (sonnet 4.6 sdk) with auto-respawn · chat strip with markdown + tail truncation · charts above the conversation, panel-styled, capped to last 5 turns · soft pink visual system (full strawberry/dessert redesign, six-hue per-session palette) · sticky frosted nav + github pill · sidebar/detail visual separation (hairline + two-tone gradient) · svg dripping-frosting cap on bar plots.

what's not wired yet: send → spawn new agent (chat-agent.ts drafted, not connected) · observer profile persistence (`session_id` resume across restarts) · feedback channel back to observer · userpromptsubmit hook for the final injection back into the user's main claude session.

---

## jump start

```bash
cd /Users/oronans/workspace/claude-meta   # local dir kept; github renamed to cut-the-cake
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun run src/server.ts
open http://localhost:3737/
```

observer is on by default. set `META_OBSERVER_ENABLED=0` to opt out — useful when iterating in `bun run dev` (`bun --hot` orphans the sdk subprocess on every file edit, see issue #4).

env vars (all optional):

| var                       | default              | purpose                                                 |
|---------------------------|----------------------|---------------------------------------------------------|
| `META_PORT`               | 3737                 | server port                                             |
| `META_POLL_MS`            | 500                  | tailer poll interval (fs.watch wakes earlier on new files) |
| `META_PROJECT_SLUG`       | unset                | restrict cc tailing to one project dir                  |
| `META_INBOX_MINUTES`      | 240                  | only tail jsonl files whose mtime is within this window |
| `META_OBSERVER_ENABLED`   | 1 (on)               | set `0` to skip spawning the sdk observer               |
| `META_OBSERVER_MODEL`     | `claude-sonnet-4-6`  | model the observer subprocess runs                      |
| `META_OBSERVER_BATCH_MS`  | 30000                | batch interval for sending closed turns (ceiling, not heartbeat — quiet windows skip the call) |
| `META_OBSERVER_FRESH_MS`  | 300000               | only feed turns whose endTs is within this window       |
| `META_MAGNITUDE_TOK`      | 1500                 | fallback trigger threshold (used when observer is off)  |
| `META_MAGNITUDE_TC`       | 5                    | fallback trigger threshold (tools/turn)                 |
| `META_MAGNITUDE_CHARS`    | 6000                 | fallback char trigger                                   |

**locations:**

- repo: https://github.com/oronanschel/cut-the-cake (private; renamed from chunk-to-chat — github keeps a redirect)
- local dir: `/Users/oronans/workspace/claude-meta` (not renamed)
- bun: `~/.bun/bin/bun`
- claude binary used by sdk: located via `which claude` (currently `~/.local/bin/claude`)

**revert anchors:**
- tag `pre-cut-the-cake` → `cc383e9` — last clean state before the strawberry redesign.
- commit `d27b2ac` — current head: removal of what-happened summary panel + svg send icon + sidebar FLIP + slower cascade.

---

## status (what's built / what's not)

| phase | description                                                            | state           |
|-------|------------------------------------------------------------------------|-----------------|
| 1     | jsonl tailer + raw event feed                                          | done (+ recursive fs.watch wake-up + lineage collapse) |
| 2     | turn assembly + magnitude trigger                                      | done            |
| A     | rename to chunk-to-chat → cut-the-cake + two-view ui shell             | done            |
| B     | multi-session inbox (cc + claude.app local-agent-mode)                 | done            |
| C     | sonnet observer wiring (gate + insights + prefills + names)            | partial · committed (M1 + M1.5 done; sessionSummary removed; profile + resume not) |
| D     | break-it-down item flow                                                | partial · uncommitted (chat strip + input wired; chat-agent.ts drafted but not connected to send button) |
| E     | userpromptsubmit hook for handoff                                      | not started     |
| V     | strawberry/dessert visual system + animations                          | done · committed |
| V'    | per-session colors + sidebar separation + svg frosting                 | done · uncommitted |

**current head:** `d27b2ac` (remove what-happened panel; SVG send icon; sidebar FLIP + slower cascade).

**uncommitted in working tree:**
- `M public/index.html` — per-session palette + sidebar separation + frosting cap (mask-image) + lineage filter + threads-filter removed
- `M src/server.ts` — `META_INBOX_MINUTES` default 60 → 240
- `M src/tailer.ts` — recursive `fs.watch` wake-up signal (claude-mem §3 pattern)
- `?? public/assets/bar-frost.svg` — svg source-of-truth for the bar-plot frosting cap (mask-image)
- `?? src/chat-agent.ts` — drafted "break it down" companion (one persistent sdk subprocess per session); NOT wired into server.ts yet

---

## architecture

```
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
                     / /state /sessions /ws /assets/*
       │  ws msg                              ▲
       ▼                                       │ ObserverInsight + name (broadcast)
public/index.html    sidebar + detail spa     │
   + public/assets/  webp art (mascots, empty-state, logo) + bar-frost.svg
   + cdn deps        marked@13 (markdown), gsap@3.12 (animations)
                                              │
src/observer.ts      single sdk subprocess (sonnet 4.6); batch every 30s;
                     parses {decisions[], names[]} json (sessionSummary
                     removed entirely); auto-respawn on crash; SIGINT →
                     abort + exit
       ▲
       │ TurnFeed (closed turns from server, only when queue non-empty)

src/chat-agent.ts    DRAFTED, NOT WIRED. one persistent sdk subprocess per
                     upstream sessionKey; lazily spawned on first user
                     send; reuses across follow-ups; tools disabled (talks
                     only); cwd in ~/.cut-the-cake/chat/<hash>/.
```

**stack:** bun + typescript on the server, vanilla browser js on the client. no react. no build step. server-side dep `@anthropic-ai/claude-agent-sdk@^0.2.128`. client-side cdn deps loaded inline: `marked@13.0.3` (~32 KB), `gsap@3.12.5` (~70 KB).

---

## files (every tracked file, one-liner each)

```
.gitignore                       vendor/, node_modules, env, settings.local.json
package.json                     name = cut-the-cake (private); + claude-agent-sdk dep
tsconfig.json                    strict, esm, bundler resolution, noEmit
bun.lock                         committed (text format)
PRODUCT.md                       brand: cut-the-cake patisserie press; "fun in voice + 5 places"
DESIGN.md                        visual system: strawberry tokens, plum chart-only, glass nav
.impeccable/design.json          stitch-style sidecar (legacy from indigo era; pre-rename)
src/server.ts                    Bun server: per-session state, ws fanout, observer onDecision/onName, /assets static
src/tailer.ts                    multi-source jsonl tailer (cc cli + claude.app); poll + recursive fs.watch
src/jsonl.ts                     record parser → MetaEvent[]; tokens, model, lines added/removed
src/turns.ts                     per-turn assembly + tally
src/triggers.ts                  fallback magnitude evaluator
src/observer.ts                  sdk observer: spawn, batch, parse, respawn (batch tick is ceiling, not heartbeat)
public/index.html                spa: sticky frosted nav · diff-rendered sidebar with gsap enter/exit/update + FLIP ·
                                 chat-style detail (markdown, tail truncation) · charts above conversation ·
                                 per-session color palette · sidebar/detail two-tone separation · svg frosting cap
notes/plan.md                    v1 plan: 5 phases, data model, hook contract, defaults
notes/claude-mem-patterns.md     24-section reference of patterns from claude-mem
notes/state.md                   this file
```

**uncommitted / untracked in working tree:**

- `src/chat-agent.ts` — drafted "break it down" subprocess host (see "what's not wired yet" #2 below). uses claude-agent-sdk `query()` with disabled tools.
- `public/assets/` — webp files (committed in d27b2ac):
  `logo-cake-slice`, `mascot-cupcake-wand`, `mascot-cupcake-fork`, `empty-state-cake-duo`.
  `header-banner-cake-clouds.webp` and `send-button-rocket.webp` are now orphaned (panel + send rocket replaced) — safe to delete.
- `public/assets/bar-frost.svg` — single source of truth for the bar-plot frosting cap; loaded as a CSS `mask-image` so the bar's `currentColor` fills the silhouette.
- `vendor/claude-mem/` — gitignored reference clone of claude-mem
- `vendor/abtop/` — gitignored reference clone of graykode/abtop
- `vendor/magicui/` — gitignored reference copies of `blur-fade.tsx` + `animated-list.tsx` (the magicui sources we ported to vanilla js + gsap)
- `node_modules/`

---

## the observer

one persistent claude code subprocess spawned by `query()` from `@anthropic-ai/claude-agent-sdk` at `src/observer.ts`. closely follows `vendor/claude-mem/src/services/worker/ClaudeProvider.ts`.

- **sandbox:** cwd `~/.chunk-to-chat/observer/` (path not renamed yet — TODO), `disallowedTools: [Bash, Read, Write, Edit, Grep, Glob, WebFetch, WebSearch, Task, NotebookEdit, AskUserQuestion, TodoWrite]`, `settingSources: []`, `mcpServers: {}`. observer can think and emit text; can't touch your files.
- **auth:** uses your existing claude auth (whatever `which claude` returns).
- **model:** `claude-sonnet-4-6` by default. swap via `META_OBSERVER_MODEL`.
- **input feed:** an async-generator yielding synthetic user messages built from a queue; the queue receives one `TurnFeed` per closed turn that's within `META_OBSERVER_FRESH_MS`. server filters out the observer's own subprocess jsonl by slug match.
- **batch tick:** the 30s setInterval early-returns when the queue is empty — so quiet windows make zero sonnet calls. the interval is a ceiling on send rate, not a heartbeat. comment in observer.ts pins this so it can't regress.
- **system prompt:** prepended to the first batch only.
- **response shape:** `{decisions: [...], names: [...]}`. decisions = one entry per turn `{turnId, open, insight?, tags?, prefill?}`. names = ≥2-turn sessions, just `{sessionKey, sessionName}` (≤24 chars, 2–3 words, lowercase). **`sessionSummary` was removed in d27b2ac** along with the "what happened so far" panel — observer prompt + parser + ws kind (`observer:summary` → `observer:name`) all rewritten.
- **respawn:** lifecycle while-loop, 5s backoff, 5 consecutive-failure cap. SIGINT/SIGTERM → abort + exit after 500ms grace.

**what's not wired yet:**
- profile persistence — `session_id` is captured per spawn but not stored across restarts.
- feedback channel — user interactions not yet sent back to adapt the gate.
- per-turn pairing of tool_use ↔ tool_result — ignored.

**observer cost:** one sonnet batch every active 30s, cache hits dominate. ~$0.20–$0.50/day for one developer running cc all day.

---

## the chat agent (drafted, not wired)

`src/chat-agent.ts` defines a `startChatHost({onChunk, onStatus})` factory that mirrors the observer's pattern but spawns **one sdk subprocess per upstream `sessionKey`**, lazily on first user send and reused for follow-ups. tools disabled (same DISALLOWED_TOOLS list as observer); cwd is sandboxed under `~/.cut-the-cake/chat/<sha1-hash>/`. system prompt: short "break it down companion" preamble prepended only to the first prompt of a given subprocess.

**status:** file written, typechecks, NOT yet imported by `src/server.ts`. pending wire-up:

1. server.ts: import `startChatHost`, instantiate alongside the observer, expose POST `/chat/send` route taking `{sessionKey, text}`, broadcast `chat:user` and `chat:assistant` ws messages.
2. public/index.html: replace the send-button stub (`console.log("[chat] send", ...)`) with a `fetch("/chat/send", ...)` call. add per-session `chatThreads: Map<sessionKey, {role, text, ts}[]>` state, ws handlers for `chat:user`/`chat:assistant` that append, and a `.chat-thread` render block between `.conversation` and `.chat-input`.

design rationale: see the "let's connect the additional subprocess" exchange in chat history. ephemeral one-shot was rejected in favour of persistent-per-session because "break it down" is iterative — needs sdk session memory across user replies.

---

## ui visual spec (current — strawberry / cut-the-cake)

normative source of truth: `DESIGN.md` (visual) + `PRODUCT.md` (strategic). this section is a quick orientation.

**creative north star:** "the patisserie press." precision instrument that wears strawberry. cream-tinted page, hairline structure, two saturation roles only — strawberry (operative voice) and plum (chart-only second voice). per-session palette spreads the operative-voice role across six dessert hues hashed from sessionId.

**layout:** sticky frosted top nav (the only glass surface in the system). main grid: 1280px max, sidebar 320px sticky, detail pane fills the rest. mobile <880px collapses to one column. **sidebar/detail are visually separated** by a hairline strawberry-tint border-right + two-tone gradients (rose 0.32α on sidebar, cream 0.30α on detail) — barely-there, single-surface feel.

**top nav:**
- left: cake-slice logo + `cut-the-cake` wordmark in strawberry + tagline (>720px)
- right: `reconnecting…` indicator (when ws drops) + GitHub pill (`★ —` placeholder, real link to oronanschel/cut-the-cake)
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
- selected card: accent-tint bg, accent border, mascot avatar (wand if active, fork if idle ≥5min) tucked into bottom-right with overflow-hidden clip.
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
- **frosting cap:** each `.cx-bar` carries a `<span class="bar-frost">` styled with `mask-image: url(/assets/bar-frost.svg)` and `background: currentColor`. svg is a 36×12-viewBox dripping-icing silhouette (irregular puffs + two pendant drips). edit `public/assets/bar-frost.svg` to change the shape; the inline rendering follows.

**conversation strip** (between charts and chat input):
- exactly three messages: `prev-agent → you → agent`. older turns intentionally hidden — chat input below is the surface for the current ask.
- agent text rendered as markdown via `marked.parse({breaks: true, gfm: true})` into `.conv-md` (claude-session styling: headings, lists, fenced code, inline code, blockquote, hr, links).
- agent blocks height-truncate at 240px with a fade-out gradient + `show full` toggle (mono accent button). expanded state survives 5s refresh ticks via `expandedBodies` Set keyed `(sessionId, turnId, role)`.
- user text is plain `escapeHtml` + pre-wrap (no markdown).
- role labels: mono 10px uppercase Pewter, with `you` colored accent.

**chat input** (one per session):
- container: surface bg, hairline border, panel radius
- context line: ⚡ "break it down" mono accent label + observer's latest insight prose (or italic muted "no observer flag yet — pick this up and edit it.")
- textarea: paper bg → flips to surface on focus + accent border
- send button: 44×44 accent square with **inline svg arrow-up** glyph (Lucide `arrow-up`, white stroke). previously was a paper-plane svg; before that, the rocket asset. `⌘ ↵` keyboard shortcut wired.
- tip line: mono Pewter "tip: ask for smaller steps, rationale, or alternatives" left + "⌘ ↵ to send" right
- per-session draft + sent state in `chatDrafts` Map / `chatSent` Set (lost on reload).

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

if "missing sessions" comes up again: `curl -s localhost:3737/sessions | jq` is authoritative for what the server is keeping. if the server has it but the UI doesn't, it's a client filter or a stale browser cache.

---

## open issues / known bugs

1. **observer profile not persisted.** each respawn = fresh sdk session. fix: capture `session_id` on first response, pass `{ resume: id }` on respawn.

2. **send button is a stub.** clicking the arrow-up logs `[chat] send {sessionKey, text}`; doesn't spawn anything. the *real* fix is partially drafted (`src/chat-agent.ts`) — see "the chat agent" section above for the wire-up checklist.

3. **observer cwd path still references the old name.** `~/.chunk-to-chat/observer/` is what gets created on first run. local cosmetic — sandbox works fine. rename to `~/.cut-the-cake/observer/` next time observer.ts is touched. (chat-agent.ts already uses the new path: `~/.cut-the-cake/chat/<hash>/`.)

4. **dev hot-reload conflicts with the observer.** `bun run dev` (`bun --hot`) respawns the server on src edits, orphaning the existing sdk subprocess. exacerbates "no observer flags" perception because each orphan dies before flagging anything. for now: use `bun run src/server.ts` directly when observer is on. better fix: process-exit cleanup hook.

5. ~~**client-side filter for empty sessions.**~~ **RESOLVED** (working tree). `s.threads.length > 0` filter dropped; all in-window sessions are now shown.

6. **task-notification turns trigger** — system-reminder text from claude code task-notifications gets parsed as `user_message` records and can flag threads. observer's `meta-feedback` tag handles this when it works, but a parser-level filter in `jsonl.ts` would be cleaner.

7. **doc drift — "passive" / old name in older notes:**
   - `notes/plan.md` — still references "chunk-to-chat" + "passive observer" framing
   - `notes/claude-mem-patterns.md` — still references "passive"
   - `.impeccable/design.json` — sidecar from the indigo era; not yet rewritten for the strawberry tokens
   doc-only cleanup; not user-facing.

8. **abort propagation depth.** `observer.stop()` calls `abortController.abort()` and waits 500ms before `process.exit(0)`. unverified the sdk subprocess actually dies in that window — could orphan on slow shutdown.

9. **bg-blobs occasionally render outside the viewport on very small windows** — `position: fixed; inset: 0; overflow: hidden` should clip them but on iOS Safari with rubber-band scroll the blobs can briefly peek. minor.

10. **gh-pill star count is hardcoded `—` placeholder.** real github star fetch not wired (would need a client-side fetch to `api.github.com/repos/oronanschel/cut-the-cake` with rate-limit awareness, or a build step).

11. **orphaned assets.** `public/assets/header-banner-cake-clouds.webp` (used by removed summary panel) and `public/assets/send-button-rocket.webp` (replaced by inline svg) are still on disk but unreferenced. safe to delete.

---

## what's next (priority order)

**already landed in this run** (since last state.md update):
- ✅ commit at `d27b2ac`: removed "what happened so far" panel end-to-end (HTML/CSS/state/observer/server/ws — channel renamed `summaries` → `names`, schema is now just `{sessionKey, sessionName}`).
- ✅ commit at `d27b2ac`: send button → inline svg (paper-plane → arrow-up, Lucide style).
- ✅ commit at `d27b2ac`: sidebar FLIP layout for inserts; top-anchor scale (`originY: 0`); update pulse ring 6px→8px / scale 1.015→1.022.
- ✅ commit at `d27b2ac`: detail open is now a two-tier cascade (`region 0.12s` + `leaf 0.04s` + `duration 0.75s`).
- ✅ uncommitted: per-session 6-hue palette (djb2 hash), applied to card + detail.
- ✅ uncommitted: sidebar/detail visual separation (hairline + two-tone gradients).
- ✅ uncommitted: svg dripping-frosting cap on bar plots (`public/assets/bar-frost.svg` as mask-image source of truth).
- ✅ uncommitted: tailer recursive `fs.watch` wake-up + lineage collapse (abtop-inspired).
- ✅ uncommitted: client `threads.length > 0` filter dropped; `META_INBOX_MINUTES` default 60 → 240.
- ✅ uncommitted: `src/chat-agent.ts` drafted (typechecks, not wired).
- ✅ saved magicui sources to `vendor/magicui/` for future reference (`blur-fade.tsx`, `animated-list.tsx`).

---

**resume-here queue** (in priority order):

1. **commit the working tree.** logical chunks if splitting:
   - (a) `src/tailer.ts` recursive fs.watch + `META_INBOX_MINUTES` bump + filter removal + lineage collapse — *session pickup hardening*.
   - (b) per-session palette + sidebar separation + frosting svg + bar-frost.svg — *visual upgrades*.
   - (c) `src/chat-agent.ts` drafted (orphan until #2 lands) — could fold into #2 or hold until wired.
   one commit per chunk feels right — they're independent themes.

2. **wire send → spawn chat agent.** `src/chat-agent.ts` already implements the host. wire-up checklist in "the chat agent" section above. this is the actual product moment.

3. **sidebar update-pulse signature tuning.** `cardSig` currently includes `lastEventTs`, which jumps on every event. for very chatty sessions the pulse fires constantly. consider gating to `(insight|sessionName)` only, leaving the live-border + opacity for "still active" signal.

4. **rename observer cwd.** `~/.chunk-to-chat/observer/` → `~/.cut-the-cake/observer/`. cosmetic but consistent.

5. **github stars on the gh-pill.** small cdn fetch; cache 10min in localStorage; fall back to `★` glyph + repo name if rate-limited.

6. **rewrite `notes/plan.md` and `notes/claude-mem-patterns.md`** to drop "passive" framing and the old name. doc cleanup.

7. **delete orphaned assets.** `public/assets/header-banner-cake-clouds.webp` + `public/assets/send-button-rocket.webp`.

backend / observer work (independent of the design queue):

8. **observer profile persistence (M2)** — store `session_id` to `~/.cut-the-cake/observer.session`, resume on respawn. preserves accumulated context.
9. **feedback channel (M3)** — server tracks user interactions, pushes "since last batch the user did X, Y, Z" to the observer periodically. observer adapts gate.
10. **userpromptsubmit hook (phase E)** — once we have a draft instruction in the chat, a hook script should be able to inject it into the user's main cc session. correct stdout shape per `claude-mem-patterns.md` §21.
11. **codex schema parser** — `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`; uses different `{type, payload}` envelope. straightforward second parser branch in `jsonl.ts`.
12. **PID → FD session discovery (abtop-style).** would replace lineage-collapse heuristic with authoritative "this jsonl is held open by a live claude process" signal. requires libproc bindings on macOS / `/proc/<pid>/fd` on Linux / sysinfo on Windows. defer until the heuristic visibly fails.

---

**process notes for the next session:**
- after big chunks, run `/codex:review` (generic) or ask the user to invoke `/codex:adversarial-review <args>` themselves (the latter is gated against model invocation). don't confuse with `codex:rescue`.
- design source-of-truth: `PRODUCT.md` (strategic) + `DESIGN.md` (visual). both are normative.
- the user prefers short replies. when iterating on UI, propose 2–3 directions tightly and let them pick a letter.
- the impeccable skill's preflight + register checks were honored at the start of the redesign; the brand register stays "product" + Lane A.
- after any animation change, the user has stated "too fast" multiple times — bias slow on initial proposals.
- if "missing sessions" comes up, hit `curl -s localhost:3737/sessions` first to see what the server's actually tracking. the lineage filter is the most aggressive thing in front of the user; the threads filter is gone.

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
- **`public/assets/bar-frost.svg`** — single source of truth for the bar-plot frosting cap; loaded via CSS `mask-image`. edit the file to change the silhouette.

---

## conventions (per `~/.claude/CLAUDE.md` global)

- **never co-author commits.** all commits in user's name only.
- **after commits, check** if `CLAUDE.md` / `README.md` need updating (we have neither yet).
- **diagnostics scripts** go in `diagnostics/` (gitignored unless committed deliberately).
- **no console.log in committed code.** observer.ts logs intentionally — that's stdout, not console.log. `[chat] send {...}` in index.html is the send-button stub and gets removed when chat-agent wire-up lands.
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
