# state.md — chunk-to-chat

cold-start brief. read this first when resuming. intentionally redundant with `plan.md` and `claude-mem-patterns.md`.

---

## what is this

**chunk-to-chat** — *turn long agent runs into a quick iterative chat.*

a chat layer for long claude code (and other autonomous agent) sessions. tails session jsonl files in real time, runs a single long-lived sonnet observer over the closed-turn stream, and surfaces moments worth user attention as 1-sentence insights + editable prefills the user can hand back to the original agent.

the loop:

1. agents run (claude code cli, claude.app local-agent-mode; codex deferred)
2. chunk-to-chat tails every cc-schema jsonl across all known roots, parses events, groups into turns
3. when turns close, they're batched (every 30s) and sent to a persistent sonnet observer subprocess
4. observer returns per-turn `{open, insight, tags, prefill}` json
5. ui shows a sidebar of session cards (left) + selected session detail (right); each flagged turn becomes a chat slot in the detail pane with the prefill in an editable textarea
6. user clicks `›` to send → **placeholder** (logs only); next step is to spawn a new sdk agent with that text and stream replies back into the slot

what's wired: multi-source tailer · multi-session inbox · turn complexity + code-changes charts · token totals · model tag · observer (sonnet 4.6 sdk) with auto-respawn · chat-slot ui with default + observer-flagged prefills.

what's not wired yet: send → spawn new agent · observer profile persistence (`session_id` resume across restarts) · feedback channel back to observer · userpromptsubmit hook for the final injection back into the user's main claude session.

---

## jump start

```bash
cd /Users/oronans/workspace/claude-meta   # repo renamed to chunk-to-chat on github; local dir kept
export PATH="$HOME/.bun/bin:$PATH"
bun install
META_OBSERVER_ENABLED=1 bun run src/server.ts
open http://localhost:3737/
```

note: prefer `bun run src/server.ts` (no `--hot`) when the observer is enabled — `bun --hot` reloads on file edits and each reload spawns a new sdk subprocess. orphans accumulate fast.

env vars (all optional):

| var                       | default              | purpose                                                 |
|---------------------------|----------------------|---------------------------------------------------------|
| `META_PORT`               | 3737                 | server port                                             |
| `META_POLL_MS`            | 500                  | tailer poll interval                                    |
| `META_PROJECT_SLUG`       | unset                | restrict cc tailing to one project dir                  |
| `META_INBOX_MINUTES`      | 60                   | only tail jsonl files whose mtime is within this window |
| `META_OBSERVER_ENABLED`   | 0 (off)              | set `1` to spawn the sdk observer                       |
| `META_OBSERVER_MODEL`     | `claude-sonnet-4-6`  | model the observer subprocess runs                      |
| `META_OBSERVER_BATCH_MS`  | 30000                | batch interval for sending closed turns                 |
| `META_OBSERVER_FRESH_MS`  | 300000               | only feed turns whose endTs is within this window       |
| `META_MAGNITUDE_TOK`      | 1500                 | fallback trigger threshold (used when observer is off)  |
| `META_MAGNITUDE_TC`       | 5                    | fallback trigger threshold (tools/turn)                 |
| `META_MAGNITUDE_CHARS`    | 6000                 | fallback char trigger                                   |

**locations:**

- repo: https://github.com/oronanschel/chunk-to-chat (private)
- local dir: `/Users/oronans/workspace/claude-meta` (not renamed)
- bun: `~/.bun/bin/bun`
- claude binary used by sdk: located via `which claude` (currently `~/.local/bin/claude`)

---

## status (what's built / what's not)

| phase | description                                                            | state           |
|-------|------------------------------------------------------------------------|-----------------|
| 1     | jsonl tailer + raw event feed                                          | done            |
| 2     | turn assembly + magnitude trigger                                      | done            |
| A     | rename to chunk-to-chat + two-view ui shell                            | done            |
| B     | multi-session inbox (cc + claude.app local-agent-mode)                 | done · uncommitted |
| C     | sonnet observer wiring (gate + insights + prefills)                    | partial · uncommitted (M1 + M1.5 done; profile + resume not) |
| D     | break-it-down item flow                                                | partial · uncommitted (ui wired; spawn-new-agent on send not) |
| E     | userpromptsubmit hook for handoff                                      | not started     |

current head: `6ae6e69` (impeccable context committed; ui polish + this state.md update lands next).

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
                     / /state /sessions /ws
       │  ws msg                              ▲
       ▼                                       │ ObserverInsight (broadcast)
public/index.html    sidebar + detail spa     │
                                              │
                                              │
src/observer.ts      single sdk subprocess (sonnet 4.6); batch every 30s;
                     parses {turnId, open, insight, tags, prefill} json;
                     auto-respawn on crash; SIGINT → abort + exit
       ▲
       │ TurnFeed (closed turns from server)
```

**stack:** bun + typescript on the server, vanilla browser js on the client. no react. no build step. one new dep this session: `@anthropic-ai/claude-agent-sdk@^0.2.128`.

---

## files (every tracked file, one-liner each)

```
.gitignore                       vendor/, node_modules, env, settings.local.json
package.json                     name = chunk-to-chat (private); + claude-agent-sdk dep
tsconfig.json                    strict, esm, bundler resolution, noEmit
bun.lock                         committed (text format)
PRODUCT.md                       impeccable strategic frame: register, users, principles, anti-references
DESIGN.md                        impeccable visual system: tokens, type, components, named rules
.impeccable/design.json          stitch-style sidecar: tonal ramps, motion, component html/css snippets
src/server.ts                    Bun server: per-session state, ws fanout, observer onDecision
src/tailer.ts                    multi-source jsonl tailer (cc cli + claude.app)
src/jsonl.ts                     record parser → MetaEvent[]; tokens, model, lines added/removed
src/turns.ts                     per-turn assembly + tally
src/triggers.ts                  fallback magnitude evaluator
src/observer.ts                  sdk observer: spawn, batch, parse, respawn
public/index.html                spa: three-band detail, ambient idle, live/idle cards, terminal collapse
notes/plan.md                    v1 plan: 5 phases, data model, hook contract, defaults
notes/claude-mem-patterns.md     24-section reference of patterns from claude-mem
notes/state.md                   this file
```

untracked (gitignored):

- `vendor/claude-mem/` — reference clone of claude-mem
- `vendor/abtop/` — reference clone of graykode/abtop (cribbed token-counter strategy from `collector/claude.rs`)
- `node_modules/`

---

## the observer (the new heart of the system)

one persistent claude code subprocess spawned by `query()` from `@anthropic-ai/claude-agent-sdk` at `src/observer.ts`. closely follows `vendor/claude-mem/src/services/worker/ClaudeProvider.ts`.

- **sandbox:** cwd `~/.chunk-to-chat/observer/`, `disallowedTools: [Bash, Read, Write, Edit, Grep, Glob, WebFetch, WebSearch, Task, NotebookEdit, AskUserQuestion, TodoWrite]`, `settingSources: []`, `mcpServers: {}`. observer can think and emit text; can't touch your files.
- **auth:** uses your existing claude auth (whatever `which claude` returns).
- **model:** `claude-sonnet-4-6` by default. swap via `META_OBSERVER_MODEL`.
- **input feed:** an async-generator yielding synthetic user messages built from a queue; the queue receives one `TurnFeed` per closed turn that's within `META_OBSERVER_FRESH_MS`. server filters out the observer's own subprocess jsonl by slug match.
- **system prompt:** prepended to the first batch only. tells the observer the heuristics to start with (>1500 tok / >5 tools / >100 lines / signs of trouble), the json schema, and the prefill voice (≤14 words, second-person to the agent, "one at a time" + ask user response per item).
- **response shape:** `[{turnId, open, insight, tags, prefill}, ...]` — one object per turn in input order. prefill is null for `open: false`.
- **respawn:** the sdk loop is wrapped in a lifecycle while-loop with 5s backoff; up to 5 consecutive failures before giving up. each respawn creates a fresh AbortController and drops in-flight prompts. on shutdown, SIGINT/SIGTERM trigger `observer.stop()` → abort → exit after 500ms grace.

**what's not wired yet:**
- profile persistence — observer's `session_id` is captured per spawn but not stored, so a respawn loses prior context.
- feedback channel — user interactions (open/click/dismiss/send) are not yet sent back to the observer to adapt the gate.
- per-turn pairing of tool_use ↔ tool_result (claude-mem-patterns §6) — ignored; errored edits aren't discounted.

**observer cost rough order:** one sonnet batch every 30s while there's activity, with cache hits dominating after the first batch. plan ~$0.20–$0.50/day for one developer running cc all day.

---

## ui visual spec (current)

normative source of truth is **`DESIGN.md`** at the repo root (visual system) and **`PRODUCT.md`** (strategic frame). this section is just a quick orientation for cold-start.

**layout:** split, two columns. max-width 1280px. mobile fallback (<880px) collapses to single column.

- **header**: H1 + tag, with a `reconnecting…` indicator (mono Pewter) that appears when the ws drops and clears on reconnect.
- **left sidebar** (320px, sticky-top): session cards. each card is two or three lines:
  - title row: session name + model-tag pill
  - (when observer flagged) latest insight prose, 13px Ink sans, no callout chrome — placement is the role
  - foot line, mono Pewter: optional source · optional tags · `live` / `Xs ago` / `idle Xm`
  - card states: `live` (indigo border, <30s since last event) · `recent` (default, <5min) · `idle` (0.55 opacity, ≥5min). selected always wins (indigo border + tint + full opacity).
- **ambient quiet:** when every visible session is idle 5min+ and nothing is selected, the sidebar collapses to a single mono line: `quiet — N agents running, last activity Xm ago`. mouse movement temporarily wakes the inbox; re-arms after 30s of stillness.
- **right pane (detail)**: when no selection → "select a session" placeholder. when selected, three bands:
  - **action band** (top): session header (name + source · elapsed), optional `untouched for Xm` line (per-session, persisted in localStorage on click-into), chat slots.
  - **instrument band** (middle): paired complexity + code-changes charts in a 2-column grid (collapses to 1 column at <880px or when one chart is suppressed).
  - **reference band** (bottom): collapsed `▸ latest output` toggle (HTML `<details>`); expanded state persists per session in localStorage. the dark terminal block lives inside the `<details>`.

**chat slot** (per flagged turn or default):
- context line: insight + tags (or "no observer flag yet — pick this up and edit it.")
- editable textarea prefilled with observer's prefill (or `DEFAULT_PREFILL`).
- `›` send button (indigo). currently no-op — logs `[chat] send {turnId, text}` to console + shows "queued (agent not wired yet)". copy-to-clipboard interim deferred per design walkthrough.
- drafts and sent-state stored in two in-memory maps keyed `(sessionKey, turnId)`. survives 5s render ticks. lost on page reload.

**charts** (turn complexity + code changes): paired bars per turn.
- complexity: `input` (Pewter at 0.55 opacity) + `output` (Signal Indigo at 0.9; latest = Live Coral at 1.0). suppressed entirely when `<2 turns` (a single bar reads as broken).
- code changes: `added` (Diff Green) + `removed` (Diff Red), both `var(--diff-*)` tokens now (`#10b981` / `#ef4444` brought into the system per Data-Color Quarantine Rule). chart self-suppresses when all turns have 0 changes.
- detail pane shows full history of both charts side-by-side; sidebar cards no longer carry a chart (was last-5-turns; dropped per the design walkthrough).

**observer-insight callout** (detail pane, when an insight exists in context):
- background: Signal Indigo Tint (`--accent-soft`)
- no border (the side-stripe was banned per DESIGN.md and removed)
- mono `OPEN` label in Signal Indigo at 9px uppercase + 13px Ink prose body + optional 10px mono Pewter tag list

**motion**: `prefers-reduced-motion: reduce` zeroes all transitions and animations. Default ease is `cubic-bezier(0.22, 1, 0.36, 1)`; live/idle border + opacity changes are 400ms.

**dropped this session (and from earlier):** severity badges (`light/medium/heavy`), card sparkline of code changes, "open session →" link footer, the standalone `view-detail` toggle, the legacy `.cta` and `.card-action` styles, the per-card `items` and `tokens` kv pairs, the per-card source line (now conditional on multi-source inboxes), the `OPEN` label inside cards (insight prose stands on its own), the placeholder "what happened so far" panel (returns when commit 3 ships the rolling observer summary), the "review load" line, the "break it down — one at a time" section header.

---

## open issues / known bugs

1. **observer profile not persisted.** each respawn = fresh sdk session, no memory of prior decisions/tags. fix is to capture `session_id` on first response and pass `{ resume: id }` on respawn (claude-mem pattern). M3+ in observer roadmap.

2. **send button is a stub.** clicking `›` logs the message; doesn't spawn anything. design walkthrough recommended a copy-to-clipboard interim (`navigator.clipboard.writeText(textarea.value)` → `✓` swap → "copied — paste into your claude session"); user deferred to a later pass. real fix: spawn a new sdk agent with the textarea text as first user message, stream replies into the slot.

3. **observer's own subprocess sessions appear in the tailer log** as `[tailer] new session ... -chunk-to-chat-observer`. they're filtered at `server.ts` `onEvent` (slug includes "chunk-to-chat-observer") so events don't reach state, but the discovery log lines are noisy. cosmetic.

4. **dev hot-reload conflicts with the observer.** `bun run dev` (`bun --hot`) respawns the server on src edits, which orphans the existing sdk subprocess. for now: use `bun run src/server.ts` directly when observer is on. better fix: process-exit cleanup hook.

5. **client-side filter for empty sessions.** sessions with `threads.length === 0` are hidden from the inbox in `sortedSessions()`. the server still tracks them (visible at `/state` and `/sessions`).

6. **task-notification turns trigger** — system-reminder text from claude code task-notifications gets parsed as `user_message` records and can flag threads. observer's `meta-feedback` tag handles this when it works, but a parser-level filter in `jsonl.ts` would be cleaner.

7. **"passive" word still in older docs:**
   - `notes/plan.md:34, 189, 267`
   - `notes/claude-mem-patterns.md:259, 347`
   doc-only cleanup; not user-facing.

8. **abort propagation depth.** `observer.stop()` calls `abortController.abort()` and waits 500ms before `process.exit(0)`. unverified the sdk subprocess actually dies in that window — could orphan on slow shutdown.

9. ~~**coral paints per-chart, not globally.**~~ withdrawn after verification: sidebar cards do not carry charts (`renderChartHtml` is only called once, in `renderDetail`), so coral can only paint in one place on the page at any time. the latest-only rule is enforced by the architecture for free. DESIGN.md tightened to make that explicit. if mini-charts are ever added to cards, the freshest-only split has to land too.

**recently fixed:** observer-insight side-stripe (now tint-only, no border, per DESIGN.md Don'ts) in `1d0d1a9`.

---

## what's next (priority order, my read)

ui design queue (locked via `/impeccable critique` walkthrough; commit 1 done; commit 2 absorbed into a doc tightening):

1. **commit 3: observer rolling sessionSummary** — extend observer system prompt to also produce a top-level `sessionSummary` per session per batch (1 sentence, present-tense, lowercase, ≤25 words, covers the last 3 closed turns, null if <2 turns). server stores latest per session. ui renders in the now-real `#d-summary` panel above chat slots, fades to muted ink-soft after 5min staleness. brings back the "what happened so far" panel, this time load-bearing.

then the deferred design items (per the walkthrough):

3. **send button copy-to-clipboard interim** — `›` writes textarea to clipboard, swaps to `✓` for 1.4s, indicator copy "copied — paste into your claude session." real send (#4) supersedes when ready.
4. **wire send → spawn agent** — when `›` clicked, spawn an ephemeral sdk subprocess with the textarea text as init prompt, stream assistant replies into the slot below the input. observer isn't part of this — different agent, different role. this is the actual product.
5. **feed-vs-dashboard reframe** (held as v2) — the current shape is two-pane dashboard. the brief is glance-from-side-monitor, which is feed-shaped. revisit once we've lived with the cleaned-up dashboard for a week.

backend / observer work (independent of the design queue):

6. **observer profile persistence (M2)** — store `session_id` to `~/.chunk-to-chat/observer.session`, resume on respawn. preserves accumulated context.
7. **feedback channel (M3)** — server tracks user interactions (which sessions the user opens, which slots they send, dwell time), pushes a "since last batch the user did X, Y, Z" prompt to the observer periodically. observer adapts gate.
8. **userpromptsubmit hook (phase E)** — once we have a draft instruction in the chat, a hook script should be able to inject it into the user's main cc session. correct stdout shape per `claude-mem-patterns.md` §21.
9. **codex schema parser** — `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`; uses different `{type, payload}` envelope. straightforward second parser branch in `jsonl.ts` after we sketch a `RawCodexRecord` type.

---

## key references

- **`notes/plan.md`** — v1 plan: phases, data model, hook contract, defaults
- **`notes/claude-mem-patterns.md`** — 24-section reference. especially:
  - §1 FileTailer (we lifted this)
  - §3 file discovery (we adapted — re-glob per tick instead of recursive watch)
  - §11 worker daemon health/readiness (skipped — overkill for our scale)
  - §21 additionalContext injection (will be load-bearing for phase E)
- **`vendor/claude-mem/`** — observer pattern source; especially `src/services/worker/ClaudeProvider.ts`
- **`vendor/abtop/`** — token counter pattern; especially `collector/claude.rs:1323-1343` (4 separate counters, not summed)

---

## conventions (per `~/.claude/CLAUDE.md` global)

- **never co-author commits.** all commits in user's name only.
- **after commits, check** if `CLAUDE.md` / `README.md` need updating (we have neither).
- **diagnostics scripts** go in `diagnostics/` (gitignored unless committed deliberately).
- **no console.log in committed code.** observer.ts logs intentionally — that's stdout, not console.log.
- **voice in code/copy:** lowercase prose, terminal flavor, dry-with-a-wink. variable names camelCase.
- **bun PATH:** `export PATH="$HOME/.bun/bin:$PATH"` in any new shell.

---

## dev-server lifecycle

- run (with observer): `META_OBSERVER_ENABLED=1 bun run src/server.ts`
- run (without observer, hot-reload): `bun run dev`
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
```

if observer is up and there's been activity, expect at least 1 session with `obs_open >= 1`.
