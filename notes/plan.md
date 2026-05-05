# chunk-to-chat v1 plan

> note: project was renamed from `claude-meta` to **chunk-to-chat** during phase 2. the framing shifted from "passive observer" to "passive review layer" — same product, sharper tagline. this plan still describes the engine; the v1.5 ui brief lives in `notes/ui-chunk-to-chat.md` (todo).

a passive review layer for live claude code sessions. watches the active session jsonl, surfaces "moments worth breaking down" when claude produces a large or decision-heavy output, and turns each moment into a guided one-piece-at-a-time review flow that converges on a refined instruction injected back into the next prompt.

reference for stolen patterns: [`claude-mem-patterns.md`](./claude-mem-patterns.md).

## table of contents

1. [goal & non-goals](#goal--non-goals)
2. [user-visible behavior](#user-visible-behavior)
3. [architecture](#architecture)
4. [data model](#data-model)
5. [build phases](#build-phases)
6. [file layout](#file-layout)
7. [hook contract](#hook-contract)
8. [defaults & tunables](#defaults--tunables)
9. [open questions](#open-questions)
10. [explicit non-decisions (deferred)](#explicit-non-decisions-deferred)

---

## goal & non-goals

**goal.** a single-user dev tool that the author runs alongside claude code. when a turn produces "a lot" (lots of files, big diff, long plan, long file), claude-meta opens a side thread in a web ui where the user and a separate sonnet model can talk through what claude is doing, converge on a refined instruction, and send that instruction back into claude as the prefix of the next user prompt.

**non-goals (v1).**

- not a memory tool. no cross-session persistence. each session resets.
- not multi-user. localhost only. no auth.
- not a marketplace plugin. installed by `bun install` + a one-line hook config.
- not a control surface. claude is **never** paused. meta only ever observes; the only feedback path is a user-mediated `userpromptsubmit` injection that the user has to actively approve and trigger.
- not a notification system. **pure passive** — the user opens the tab when they remember.
- not cross-project. one server instance watches one project at a time.

## user-visible behavior

three surfaces.

1. **the web ui at `http://localhost:3737`.** one column, lowercase voice. shows:
   - a one-line header (`meta · <project> · <elapsed>`)
   - a running prose summary of "where we are" (sonnet-maintained, refreshed on each `stop`)
   - active threads as arrow-prefixed mono lines
   - empty-state line at the bottom (`nothing pressing? cool, close the tab.`)

2. **a thread page** when the user clicks an arrow. guided flow with phases:
   - **summary**: meta restates what claude was doing in 2–3 bullets
   - **probes**: 1–3 targeted questions ("scope creep on files X/Y?", "off-limits area touched?", "stage in two PRs?")
   - **draft**: meta composes a refined instruction
   - **approve / edit / send**: the user clicks send → instruction is queued
   - **escape hatch**: a "free chat" button on every thread for when the script doesn't fit

3. **next user prompt in claude code**. when the queue has a pending instruction, the userpromptsubmit hook prepends it (with a visible delimiter so the user knows it's there). queue clears on consume.

## architecture

```
┌──────────────────────────────────────────────────────┐
│ claude-meta server (bun, single process, :3737)     │
│                                                      │
│  ┌────────────┐    ┌─────────────┐    ┌──────────┐  │
│  │  tailer    │───▶│  state      │───▶│  ws      │  │
│  │  (jsonl)   │    │  + classify │    │  fanout  │  │
│  └────────────┘    └─────────────┘    └──────────┘  │
│        ▲                  │                   ▲      │
│        │                  ▼                   │      │
│        │          ┌──────────────┐            │      │
│        │          │  sonnet      │            │      │
│        │          │  classifier  │            │      │
│        │          │  + summary   │            │      │
│        │          │  + dialogue  │            │      │
│        │          └──────────────┘            │      │
│  ~/.claude/projects/<slug>/*.jsonl   ┌────────┴──┐  │
│                                       │  static   │  │
│                                       │  ui (/)   │  │
│                                       └───────────┘  │
└──────────────────────────────────────────────────────┘
        │                                       ▲
        ▼                                       │
   queue file                               browser
   (refined instructions)                   (web ui)
        │
        ▼
   userpromptsubmit hook (claude code side)
        │
        ▼
   prepended into next claude code prompt
```

**three runtime concerns.**

- **i/o:** tailer polls the active jsonl every 500ms. byte-offset tracking; dedupe by record `uuid`. (pattern from claude-mem §1, simplified — single-watch, single-file.)
- **state:** in-memory only for v1. events list, current summary, active threads, dialogue history per thread, queued instructions. lost on restart — fine for a single-user dev tool.
- **llm:** every sonnet call is fire-and-forget from the http handler's perspective. classifier on each turn boundary, summary refresh on each `stop`, dialogue replies on each user message in a thread. failures degrade gracefully (no crash, just no thread / no summary update).

## data model

```ts
type metaEvent =
  | { kind: "user"; uuid; text; ts }
  | { kind: "assistant_text"; uuid; text; tokens?; ts }
  | { kind: "tool_use"; uuid; tool; summary; ts }
  | { kind: "stop"; uuid; ts };

type turn = {
  id;                     // hash of first event uuid
  startTs; endTs;
  events: metaEvent[];
  outputTokens;           // sum across assistant_text in the turn
  toolCalls;              // count of tool_use events
};

type thread = {
  id;                     // uuid
  turnId;                 // the turn that triggered it
  trigger: "magnitude" | "complexity";
  status: "open" | "drafting" | "queued" | "consumed" | "dismissed";
  phase: "summary" | "probes" | "draft" | "approve" | "free_chat";
  messages: { role: "meta" | "user"; text; ts }[];
  draft?: string;
  createdTs; updatedTs;
};

type sessionState = {
  sessionId; projectSlug; jsonlPath;
  startTs;
  events: metaEvent[];
  turns: turn[];
  summary: string;        // sonnet-maintained, plain prose
  threads: thread[];
  queue: string[];        // pending refined instructions, fifo
};
```

websocket messages from server to client:

- `hello` — full snapshot on connect
- `event` — single new metaEvent
- `summary` — updated prose summary
- `thread:new` / `thread:update` — thread state changes
- `queue:update` — queue length changed (so the ui can show "queued for next prompt")

## build phases

ordered for fastest path to "i can see this thing doing something useful." each phase ends with a working, testable cut.

### phase 1 — plumbing: tailer + raw feed

- `src/jsonl.ts`: parser. record types we keep: `user`, `assistant`, `system{subtype:"stop_hook_summary"}`. dedupe by `uuid`. produce `metaEvent`s.
- `src/tailer.ts`: discovers active jsonl (most recently modified `.jsonl` across `~/.claude/projects/` by default; overridable via `META_PROJECT_SLUG` env). polls 500ms, byte-offset, partial-line buffer. stable across re-reads (claude-mem §0 caveat: file is not strictly append-only — uuid dedupe handles that).
- `src/server.ts`: wire tailer → broadcast. add `GET /state`.
- `public/index.html`: render incoming events as a raw mono feed at the bottom of the column (debug view; will be hidden in phase 3).

**done when:** running claude code in another terminal, `bun run dev` here, watching the page show user/assistant/tool events live with <1s latency.

### phase 2 — turn assembly + magnitude trigger

- `src/turns.ts`: group events into `turn`s by detecting boundary (`stop` event, or new `user` after `assistant_text`).
- `src/triggers.ts`: per-turn evaluator. magnitude = sum of `output_tokens` (or char-count fallback) > threshold OR tool-call count > threshold. emits `triggerHit(turn, reason)`.
- `src/server.ts`: on trigger, create a `thread` in `status: "open"`, broadcast `thread:new`. no llm yet — thread title is just `"<reason>"`, no probes, no draft.

**done when:** a heavy turn (e.g., big plan) shows up as an arrow line in the ui within a couple of seconds of the turn ending.

### phase 3 — sonnet: summary + classifier + dialogue

- `src/llm.ts`: thin anthropic sdk wrapper. one model (`claude-sonnet-4-6`), one timeout, retry-on-overload. **prompt caching on the system prompt + recent turns** (see [claude-api skill]). single anthropic key from `$ANTHROPIC_API_KEY`.
- `src/summary.ts`: maintains the running prose summary. inputs: previous summary + recent turns. fires on every `stop`. write to `sessionState.summary`, broadcast `summary` ws message.
- `src/classify.ts`: complexity classifier. on each turn, alongside the magnitude check, asks sonnet "does this turn warrant a thread? if yes, what's a one-line title and what 1–3 probes would be most useful?" structured output via tool-use (one tool, schema enforces `verdict / title / probes[]`). cheap to fail — if sonnet fails or says no, the turn is skipped unless magnitude already triggered.
- `src/dialogue.ts`: handles user messages within a thread. phase machine (`summary` → `probes` → `draft` → `approve`). transitions are model-driven (sonnet emits a tool-call indicating the next phase) but constrained — a thread cannot skip past `approve` to `consumed` without an explicit user click.
- ui: render summary at the top, threads in the middle, thread expand on click with the phase indicator.

**done when:** opening a thread shows a real meta-composed summary, real probes, and the user can chat with meta and end up with a draft instruction.

### phase 4 — handoff: queue + userpromptsubmit hook

- `src/queue.ts`: append a refined instruction to `~/.claude/claude-meta/queue.jsonl` (per-project file). `POST /queue/push` from ui; reads it back on `userpromptsubmit`.
- `hooks/user-prompt-submit.ts`: bun script. reads the queue for the current cwd's project slug, pops any pending lines, returns json with `additionalContext` so claude prepends them into the user's prompt. **spot-check** the json shape against current claude code docs before relying on it (claude-mem §21 used this and it worked at the time, but the contract may have changed).
- ui: thread `[send →]` button calls `POST /queue/push`. show a small `queued for next prompt` badge in the thread + `queue:update` broadcast updates a header count.
- one-time setup: a `bun run install:hook` script that writes the `userpromptsubmit` entry into `.claude/settings.local.json` for the project being observed.

**done when:** clicking send in a thread, then typing anything in the main claude terminal, results in claude receiving the refined instruction prefixed onto the user's message.

### phase 5 — polish (only what hurts)

deferred to "we'll do this if it actually bothers us":

- nicer empty states / first-run welcome
- tab title badge (will violate "pure passive" — only if forgetting threads becomes a real problem)
- `.env` loader for api key
- restart resilience for the queue (currently file-backed, so already mostly fine; thread state is in-memory, lost on restart)
- structured logs (bun's default `console.log` is enough until something breaks)

## file layout

```
claude-meta/
├── package.json
├── tsconfig.json
├── bun.lock
├── .gitignore
├── notes/
│   ├── claude-mem-patterns.md
│   └── plan.md                         # this file
├── public/
│   └── index.html                      # static ui
├── src/
│   ├── server.ts                       # bun.serve + ws + routes
│   ├── jsonl.ts                        # record parser
│   ├── tailer.ts                       # discovery + poll + dedupe
│   ├── turns.ts                        # event → turn assembly
│   ├── triggers.ts                     # magnitude + complexity dispatch
│   ├── llm.ts                          # anthropic client wrapper
│   ├── summary.ts                      # running prose summary
│   ├── classify.ts                     # complexity classifier
│   ├── dialogue.ts                     # thread phase machine
│   ├── queue.ts                        # handoff queue (file-backed)
│   └── state.ts                        # in-memory sessionState
├── hooks/
│   └── user-prompt-submit.ts           # bun script invoked by claude code
└── scripts/
    └── install-hook.ts                 # writes the hook config to a target project
```

## hook contract

we install **one** hook in the *target project* (not in claude-meta's repo): `userpromptsubmit`. it runs as `bun /Users/oronans/workspace/claude-meta/hooks/user-prompt-submit.ts` on every prompt.

contract (best understood from claude-mem §21 and the live claude code docs — verify before trusting):

- stdin: json, including `cwd` (used to derive the project slug → queue file path).
- behavior: read `~/.claude/claude-meta/queue.jsonl` for that slug. if non-empty, pop everything and emit them concatenated.
- stdout: json `{ "continue": true, "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<concatenated instructions>\n\n---\n" } }`.
- failure mode: if the queue read or the json emit fails, exit 0 with no output. **never block the user's prompt.** at most we silently lose a refinement.

## defaults & tunables

| setting                  | default                   | env var               |
|--------------------------|---------------------------|-----------------------|
| port                     | 3737                      | `META_PORT`           |
| poll interval            | 500ms                     | `META_POLL_MS`        |
| project slug             | most-recent jsonl globally| `META_PROJECT_SLUG`   |
| magnitude threshold      | 1500 output tokens / turn | `META_MAGNITUDE_TOK`  |
| tool-call threshold      | 5 tool_use blocks / turn  | `META_MAGNITUDE_TC`   |
| sonnet model             | `claude-sonnet-4-6`       | `META_MODEL`          |
| anthropic api key        | required                  | `ANTHROPIC_API_KEY`   |

defaults are gut-feel starting points. tune in phase 3 once we see real triggers fire on real sessions.

## open questions

these don't block phase 1 but should be answered before phase 4 lands.

1. **persistence.** server runs continuously across sessions, but `sessionState` resets on restart. is that ok? if not, do we persist `summary` and `queue` to disk and rehydrate on boot?
2. **multiple sessions.** if the user has two claude code sessions running in the same project, the tailer follows whichever jsonl is most recently touched — which can flip between them. do we accept that for v1, or scope strictly to one sessionid?
3. **threshold tuning loop.** every "skip" or "dismiss" of a thread is a learning signal. for v1 we just record it; do we want even a primitive "lower the threshold if user dismisses 3 in a row" rule, or strictly leave that to v2?
4. **first-run experience.** what does the ui show before any session events have been seen? right now: an italic "waiting for the first turn…". probably enough.
5. **which project does `bun run install:hook` target?** we need an explicit `--project <path>` flag — defaulting to cwd is dangerous if the user runs it from inside `claude-meta` itself.

## explicit non-decisions (deferred)

things we've discussed but explicitly punted on. listed here so they don't leak into v1 scope.

- **personal vs shippable.** v1 is "tool i run for myself." packaging, install scripts, public docs, telemetry — all v2.
- **cross-session memory.** dropped C and D from the read-access discussion. v1 reads only the active session jsonl + repo. multi-session and cross-project are v2.
- **bypass / quick-skip.** moot since meta never blocks claude.
- **notifications.** not in v1. pure passive.
- **autonomous handoff.** meta never speaks to claude unprompted by the user. every handoff requires a user click.
- **hooks for postooluse / stop.** the original design used these; we replaced them with jsonl tailing because tailing is simpler and the tailer is sufficient. only `userpromptsubmit` survives, because it's the only hook that actually changes claude's behavior.
- **multi-tenant.** localhost-only single-user.
