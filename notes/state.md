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
4. observer returns per-turn `{open, insight, tags, prefill}` json plus a rolling `{sessionName, sessionSummary}` per session
5. ui shows a sidebar of session cards (left) + selected session detail (right). detail pane is now a chat-style strip (prev-agent → you → agent, markdown-rendered, height-truncated) with one chat input at the bottom prefilled with the observer's prefill
6. user clicks the rocket send → **placeholder** (logs only); next step is to spawn a new sdk agent with that text and stream replies into the strip

what's wired: multi-source tailer · multi-session inbox · diff-rendered sidebar with magicui-style enter/exit + update-pulse · observer (sonnet 4.6 sdk) with auto-respawn · chat strip with markdown + tail truncation · summary panel with cake-clouds banner backdrop · charts above the conversation, panel-styled, capped to last 5 turns · soft pink visual system (full strawberry/dessert redesign) · sticky frosted nav + github pill.

what's not wired yet: send → spawn new agent · observer profile persistence (`session_id` resume across restarts) · feedback channel back to observer · userpromptsubmit hook for the final injection back into the user's main claude session.

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
| `META_POLL_MS`            | 500                  | tailer poll interval                                    |
| `META_PROJECT_SLUG`       | unset                | restrict cc tailing to one project dir                  |
| `META_INBOX_MINUTES`      | 60                   | only tail jsonl files whose mtime is within this window |
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

**revert anchor:** tag `pre-cut-the-cake` points at `cc383e9` — the last clean state before the strawberry redesign. recover the indigo system from there if needed.

---

## status (what's built / what's not)

| phase | description                                                            | state           |
|-------|------------------------------------------------------------------------|-----------------|
| 1     | jsonl tailer + raw event feed                                          | done            |
| 2     | turn assembly + magnitude trigger                                      | done            |
| A     | rename to chunk-to-chat → cut-the-cake + two-view ui shell             | done            |
| B     | multi-session inbox (cc + claude.app local-agent-mode)                 | done            |
| C     | sonnet observer wiring (gate + insights + prefills + summaries)        | partial · uncommitted (M1 + M1.5 done; profile + resume not) |
| D     | break-it-down item flow                                                | partial · uncommitted (chat strip + input wired; spawn-new-agent on send not) |
| E     | userpromptsubmit hook for handoff                                      | not started     |
| V     | strawberry/dessert visual system + animations                          | done · uncommitted |

current head: `cc383e9` (chat-style detail pane + `[project]` prefix on session names). everything since is **uncommitted** — the entire cut-the-cake redesign + animations + chart restyling is sitting in the working tree. five files modified + `public/assets/` added.

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
                     re-globs per tick; only tails files with recent mtime
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
       ▼                                       │ ObserverInsight (broadcast)
public/index.html    sidebar + detail spa     │
   + public/assets/  webp art (mascots, banner, empty-state, logo, rocket)
   + cdn deps        marked@13 (markdown), gsap@3.12 (animations)
                                              │
src/observer.ts      single sdk subprocess (sonnet 4.6); batch every 30s;
                     parses {decisions[], summaries[]} json;
                     auto-respawn on crash; SIGINT → abort + exit
       ▲
       │ TurnFeed (closed turns from server, only when queue non-empty)
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
src/server.ts                    Bun server: per-session state, ws fanout, observer onDecision, /assets static
src/tailer.ts                    multi-source jsonl tailer (cc cli + claude.app)
src/jsonl.ts                     record parser → MetaEvent[]; tokens, model, lines added/removed
src/turns.ts                     per-turn assembly + tally
src/triggers.ts                  fallback magnitude evaluator
src/observer.ts                  sdk observer: spawn, batch, parse, respawn (batch tick is ceiling, not heartbeat)
public/index.html                spa: sticky frosted nav · diff-rendered sidebar with gsap enter/exit/update ·
                                 chat-style detail (markdown, tail truncation) · charts above conversation
notes/plan.md                    v1 plan: 5 phases, data model, hook contract, defaults
notes/claude-mem-patterns.md     24-section reference of patterns from claude-mem
notes/state.md                   this file
```

untracked (in working tree):

- `public/assets/` — six webp files: `logo-cake-slice`, `header-banner-cake-clouds`, `send-button-rocket`, `mascot-cupcake-wand`, `mascot-cupcake-fork`, `empty-state-cake-duo`. needs `git add`.
- `vendor/claude-mem/` — gitignored reference clone of claude-mem
- `vendor/abtop/` — gitignored reference clone of graykode/abtop
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
- **response shape:** `{decisions: [...], summaries: [...]}` (legacy bare-array still parsed). decisions = one entry per turn; summaries = ≥2-turn sessions, with `sessionName` (≤24 char, 2-3 words) + `sessionSummary`.
- **respawn:** lifecycle while-loop, 5s backoff, 5 consecutive-failure cap. SIGINT/SIGTERM → abort + exit after 500ms grace.

**what's not wired yet:**
- profile persistence — `session_id` is captured per spawn but not stored across restarts.
- feedback channel — user interactions not yet sent back to adapt the gate.
- per-turn pairing of tool_use ↔ tool_result — ignored.

**observer cost:** one sonnet batch every active 30s, cache hits dominate. ~$0.20–$0.50/day for one developer running cc all day.

---

## ui visual spec (current — strawberry / cut-the-cake)

normative source of truth: `DESIGN.md` (visual) + `PRODUCT.md` (strategic). this section is a quick orientation.

**creative north star:** "the patisserie press." precision instrument that wears strawberry. cream-tinted page, hairline structure, two saturation roles only — strawberry (operative voice) and plum (chart-only second voice).

**five named illustration spots (hard count):** logo, live-session avatar, welcome banner, empty state, send rocket. terminal block stays unchanged from the indigo era (anchor of seriousness — it doesn't ship in the current detail layout but the token set is preserved for future use).

**layout:** sticky frosted top nav (the only glass surface in the system). main grid: 1280px max, sidebar 320px sticky, detail pane fills the rest. mobile <880px collapses to one column.

**top nav:**
- left: cake-slice logo + `cut-the-cake` wordmark in strawberry + tagline (>720px)
- right: `reconnecting…` indicator (when ws drops) + GitHub pill (`★ —` placeholder, real link to oronanschel/cut-the-cake)
- background: `glass-paper` (rgba 253,249,250,0.72) + `backdrop-filter: blur(12px) saturate(140%)`. only blur in the system.

**ambient layers (behind everything):**
- `.bg-blobs` — three large blurred radial blobs (warm pink + lavender), `position: fixed`, `z-index: -1`, `filter: blur(80px)`. fixed in viewport, no animation.
- `.sprinkles` — 14 / 30 small dots+dashes (count by viewport), randomized hue+position+rotation, gsap yoyo float (`sine.inOut`, 4–8s). `prefers-reduced-motion` → static.

**sidebar inbox (diff-rendered):**
- session cards keyed by `sessionId` in a `cardEls` Map; persists across 5s ticks (no innerHTML clobber).
- enter animation: `scale 0 → 1`, opacity 0 → 1, `back.out(1.3)`, 1.4s, with `0.07s * idx` stagger (visible on first hello).
- exit animation: opacity 0, x: -24, height/padding/margin → 0, `power2.in`, 1.2s, then DOM remove.
- update pulse: when `cardSig` (lastEventTs / latest insight / summary / sessionName) changes, `is-updated` keyframe fires — strawberry box-shadow ring + 1.5% scale, 1.6s, `ease-out`. ignores model/state/elapsed (avoids minute-tick flash).
- card body: `[project] observer-name` title + model-tag pill + insight prose (when flagged) + foot line (mono Pewter, optional source · tags · live/Xs ago/idle Xm).
- selected card: strawberry tint bg, strawberry border, mascot avatar (wand if active, fork if idle ≥5min) tucked into bottom-right with overflow-hidden clip.
- ambient quiet: when every visible session is idle 5min+ and nothing's selected, sidebar collapses to one mono line; mouse movement temporarily wakes for 30s.

**right pane (detail):**
- empty state: cake-duo illustration + italic "select a session" (replaces the old dashed-outline panel).
- when a session is selected, the detail-content children blur-fade in with stagger:
  - `gsap.set` synchronously pre-hides children before unhide (no flash)
  - per-element `gsap.to`: opacity 0→1, blur 6px→0, y -6→0, 0.5s, `power2.out`, `0.05s * idx` stagger
  - children: `.session-head` → `.summary-panel` → `.charts-band` → `.conversation` → `.chat-input`

**summary panel** (`what happened so far`):
- panel with strawberry-tint border, surface bg
- mono uppercase "what happened so far" label in strawberry with ✦ glyph prefix
- summary text in 15px Ink (≤60ch), fades to ink-soft + `(stale)` mono tag when session age ≥5min
- observer tags below summary as strawberry-tint pill chips (mono Pewter labels)
- right edge: `header-banner-cake-clouds.webp` absolutely positioned, opacity 1, the asset's own taper does the fade. hidden on <720px.

**charts band** (above the conversation):
- two-column grid (1fr 1fr), each pinned: `#d-chart` left, `#d-code-chart` right. when one suppresses, its slot stays empty (no auto-stretch).
- each chart in a `.chart-card` with soft tinted gradient (pink for complexity, green for code) + colored hairline border
- head row: tinted icon bubble (line-graph svg / `</>` svg) + uppercase mono title in card's accent color + legend pills (white surface, hairline border, colored square dot, sans label, "you/agent" or "added/removed")
- bars: `flex: 1 1 0`, max-width 56px per pair, max-width 22px per bar — distribute via flex with no horizontal scroll
- complexity: input strawberry @ 0.55 opacity, output plum @ 0.9; latest pair gets plum @ 1.0
- code-changes: added diff-green @ 0.9, removed diff-red @ 0.9; chart self-suppresses on all-zero
- both charts cap at `CHART_TURNS = 5` (last 5 turns only, no scrolling)
- y-axis: 3 ticks (top yMax, mid yMax/2, bot 0). x-axis: dropped (no time labels). foot: small mono Pewter "Xm ago" right-aligned, derived from latest turn's `endTs`.

**conversation strip** (between charts and chat input):
- exactly three messages: `prev-agent → you → agent`. older turns intentionally hidden — chat input below is the surface for the current ask.
- agent text rendered as markdown via `marked.parse({breaks: true, gfm: true})` into `.conv-md` (claude-session styling: headings, lists, fenced code, inline code, blockquote, hr, links).
- agent blocks height-truncate at 240px with a fade-out gradient + `show full` toggle (mono strawberry button). expanded state survives 5s refresh ticks via `expandedBodies` Set keyed `(sessionId, turnId, role)`.
- user text is plain `escapeHtml` + pre-wrap (no markdown).
- role labels: mono 10px uppercase Pewter, with `you` colored strawberry.

**chat input** (one per session):
- container: surface bg, hairline border, panel radius
- context line: ⚡ "break it down" mono strawberry label + observer's latest insight prose (or italic muted "no observer flag yet — pick this up and edit it.")
- textarea: paper bg → flips to surface on focus + strawberry border
- send button: 44×44 strawberry square with rocket asset (28px), strawberry-tinted shadow, `⌘ ↵` keyboard shortcut wired
- tip line: mono Pewter "tip: ask for smaller steps, rationale, or alternatives" left + "⌘ ↵ to send" right
- per-session draft + sent state in `chatDrafts` Map / `chatSent` Set (lost on reload).

**motion:** `prefers-reduced-motion: reduce` zeroes all gsap + css transitions. default ease `cubic-bezier(0.22, 1, 0.36, 1)`.

---

## open issues / known bugs

1. **observer profile not persisted.** each respawn = fresh sdk session. fix: capture `session_id` on first response, pass `{ resume: id }` on respawn.

2. **send button is a stub.** clicking the rocket logs `[chat] send {sessionKey, text}`; doesn't spawn anything. real fix: spawn ephemeral sdk subprocess with the textarea text as init prompt, stream replies into the conversation strip above the input.

3. **observer cwd path still references the old name.** `~/.chunk-to-chat/observer/` is what gets created on first run. local cosmetic — sandbox works fine. rename to `~/.cut-the-cake/observer/` next time observer.ts is touched.

4. **dev hot-reload conflicts with the observer.** `bun run dev` (`bun --hot`) respawns the server on src edits, orphaning the existing sdk subprocess. for now: use `bun run src/server.ts` directly when observer is on. better fix: process-exit cleanup hook.

5. **client-side filter for empty sessions.** sessions with `threads.length === 0` are hidden from the inbox in `sortedSessions()`. the server still tracks them (visible at `/state` and `/sessions`).

6. **task-notification turns trigger** — system-reminder text from claude code task-notifications gets parsed as `user_message` records and can flag threads. observer's `meta-feedback` tag handles this when it works, but a parser-level filter in `jsonl.ts` would be cleaner.

7. **doc drift — "passive" / old name in older notes:**
   - `notes/plan.md` — still references "chunk-to-chat" + "passive observer" framing
   - `notes/claude-mem-patterns.md` — still references "passive"
   - `.impeccable/design.json` — sidecar from the indigo era; not yet rewritten for the strawberry tokens
   doc-only cleanup; not user-facing.

8. **abort propagation depth.** `observer.stop()` calls `abortController.abort()` and waits 500ms before `process.exit(0)`. unverified the sdk subprocess actually dies in that window — could orphan on slow shutdown.

9. **bg-blobs occasionally render outside the viewport on very small windows** — `position: fixed; inset: 0; overflow: hidden` should clip them but on iOS Safari with rubber-band scroll the blobs can briefly peek. minor.

10. **gh-pill star count is hardcoded `—` placeholder.** real github star fetch not wired (would need a client-side fetch to `api.github.com/repos/oronanschel/cut-the-cake` with rate-limit awareness, or a build step).

---

## what's next (priority order)

**already landed in this run:**
- ✅ chat-style detail pane (queue #1 from prior state.md): `prev-agent → you → agent` strip
- ✅ project rename: `chunk-to-chat` → `cut-the-cake` (github repo, package.json, ui wordmark, gh-pill href)
- ✅ tag `pre-cut-the-cake` on `cc383e9` as revert anchor
- ✅ strawberry/dessert visual system (Lane A): tokens, top nav (frosted glass), summary banner, mascot avatars, empty state, send rocket
- ✅ ambient layers: bg-blobs + gsap-driven sprinkles (with reduce-motion guard)
- ✅ sidebar diff-rendered: enter (back.out spring) / exit (collapse) / update (strawberry pulse)
- ✅ blur-fade stagger on detail open (per-component, not whole-pane)
- ✅ markdown rendering for agent text via marked cdn
- ✅ height-based tail truncation with show-full toggle
- ✅ charts moved above conversation, panel-styled, capped to last 5 turns, no scrolling, no x-axis time labels (just an "Xm ago" foot)
- ✅ server: `/assets/*` static handler with `..` traversal guard
- ✅ observer batch tick: comment confirms quiet-window skip (no heartbeat)
- ✅ PRODUCT.md + DESIGN.md rewritten for cut-the-cake (Lane A); design-principle 5 flipped to "fun in voice + 5 named places"

---

**resume-here queue** (in priority order):

1. **commit the redesign.** five files modified + `public/assets/` untracked. logical chunks if splitting: (a) rename + assets + server static handler, (b) DESIGN.md + PRODUCT.md, (c) public/index.html visual + animation overhaul. or one big commit with a descriptive body. probably one commit is fine — this is a coherent visual-system swap.

2. **bump `META_INBOX_MINUTES` default.** current 60min feels too short; gone projects vanish on reload. user previously asked for 4h–24h. recommended: 240 (4h). one-line in `src/server.ts` + the table above.

3. **send button copy-to-clipboard interim.** rocket writes textarea to clipboard, swaps to ✓ for 1.4s, indicator copy "copied — paste into your claude session." superseded when #4 lands.

4. **wire send → spawn agent.** when rocket clicked, spawn an ephemeral sdk subprocess with the textarea text as init prompt, stream assistant replies into the conversation strip (above the input box). this is the actual product.

5. **sidebar update-pulse signature tuning.** `cardSig` currently includes `lastEventTs`, which jumps on every event. for very chatty sessions the pulse fires constantly. consider gating to `(insight|summary|sessionName)` only, and leaving the live-border + opacity for "still active" signal.

6. **rename observer cwd.** `~/.chunk-to-chat/observer/` → `~/.cut-the-cake/observer/`. cosmetic but consistent.

7. **github stars on the gh-pill.** small cdn fetch; cache 10min in localStorage; fall back to `★` glyph + repo name if rate-limited.

8. **rewrite `notes/plan.md` and `notes/claude-mem-patterns.md`** to drop "passive" framing and the old name. doc cleanup.

backend / observer work (independent of the design queue):

9. **observer profile persistence (M2)** — store `session_id` to `~/.cut-the-cake/observer.session`, resume on respawn. preserves accumulated context.
10. **feedback channel (M3)** — server tracks user interactions, pushes "since last batch the user did X, Y, Z" to the observer periodically. observer adapts gate.
11. **userpromptsubmit hook (phase E)** — once we have a draft instruction in the chat, a hook script should be able to inject it into the user's main cc session. correct stdout shape per `claude-mem-patterns.md` §21.
12. **codex schema parser** — `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`; uses different `{type, payload}` envelope. straightforward second parser branch in `jsonl.ts`.

---

**process notes for the next session:**
- after big chunks, run `/codex:review` (generic) or ask the user to invoke `/codex:adversarial-review <args>` themselves (the latter is gated against model invocation). don't confuse with `codex:rescue`.
- design source-of-truth: `PRODUCT.md` (strategic) + `DESIGN.md` (visual). both are normative.
- the user prefers short replies. when iterating on UI, propose 2–3 directions tightly and let them pick a letter.
- the impeccable skill's preflight + register checks were honored at the start of the redesign; the brand register stays "product" + Lane A.
- after any animation change, the user has stated "too fast" multiple times — bias slow on initial proposals.

---

## key references

- **`notes/plan.md`** — v1 plan: phases, data model, hook contract, defaults (still uses old name; see issue #7)
- **`notes/claude-mem-patterns.md`** — 24-section reference. especially:
  - §1 FileTailer (we lifted this)
  - §3 file discovery (we adapted — re-glob per tick instead of recursive watch)
  - §11 worker daemon health/readiness (skipped — overkill for our scale)
  - §21 additionalContext injection (will be load-bearing for phase E)
- **magicui sources** (fetched via `gh api repos/magicuidesign/magicui/...`) — we ported `BlurFade` and `AnimatedList` defaults to vanilla js + gsap. originals at `apps/www/registry/magicui/blur-fade.tsx` and `apps/www/registry/magicui/animated-list.tsx`.
- **`vendor/claude-mem/`** — observer pattern source; especially `src/services/worker/ClaudeProvider.ts`
- **`vendor/abtop/`** — token counter pattern; especially `collector/claude.rs:1323-1343`

---

## conventions (per `~/.claude/CLAUDE.md` global)

- **never co-author commits.** all commits in user's name only.
- **after commits, check** if `CLAUDE.md` / `README.md` need updating (we have neither yet).
- **diagnostics scripts** go in `diagnostics/` (gitignored unless committed deliberately).
- **no console.log in committed code.** observer.ts logs intentionally — that's stdout, not console.log. `[chat] send {...}` in index.html is the send-button stub and gets removed when #4 lands.
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

---

## quick smoke test

```bash
curl -s http://localhost:3737/state | python3 -c "
import sys, json
data = json.load(sys.stdin)
ss = data.get('sessions') or []
print(f'sessions: {len(ss)}')
for s in ss[:5]:
    info = s['info']
    name = (info.get('slug') or '').split('-')[-1]
    decs = s.get('observerDecisions') or []
    open_ct = sum(1 for d in decs if d.get('open'))
    print(f'  {info[\"source\"]:12} {name:20} threads={len(s[\"threads\"]):2} ctx={s.get(\"contextTokens\",0):>7} obs_open={open_ct}')
"
echo '--- assets ---'
for f in logo-cake-slice send-button-rocket mascot-cupcake-wand mascot-cupcake-fork header-banner-cake-clouds empty-state-cake-duo; do
  curl -s -o /dev/null -w "  %{http_code} /assets/${f}.webp\n" "http://localhost:3737/assets/${f}.webp"
done
```

if observer is up and there's been activity, expect at least 1 session with `obs_open >= 1`. all six assets should return `200`.
