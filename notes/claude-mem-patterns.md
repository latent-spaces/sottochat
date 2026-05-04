# claude-mem patterns reference

## orientation

claude-mem is a Claude Code plugin that captures tool/session activity, compresses it via the Claude Agent SDK, and re-injects relevant context on future sessions. Its runtime is a long-lived Bun-based Express daemon (`src/services/worker-service.ts`) on a per-user port (`37700 + (uid % 100)`); a thin Node "bun-runner" launched from `plugin/hooks/hooks.json` shells lifecycle events to that worker over HTTP, while a separate `TranscriptWatcher` tails third-party JSONL transcripts (currently Codex) by byte offset into the same ingestion pipeline. Source under `src/`, distributable plugin under `plugin/`, marketplace manifest at `.claude-plugin/marketplace.json`.

## table of contents

1. [FileTailer (byte-offset jsonl tailing)](#1-filetailer-byte-offset-jsonl-tailing)
2. [Watch-state file for resume across restarts](#2-watch-state-file-for-resume-across-restarts)
3. [File discovery: globs, dir auto-expansion, recursive root watcher](#3-file-discovery-globs-dir-auto-expansion-recursive-root-watcher)
4. [Session ID extraction from file paths](#4-session-id-extraction-from-file-paths)
5. [Per-session state machine in TranscriptEventProcessor](#5-per-session-state-machine-in-transcripteventprocessor)
6. [Tool-call / tool-result pairing via pendingTools map](#6-tool-call--tool-result-pairing-via-pendingtools-map)
7. [Schema-driven field extraction (FieldSpec / MatchRule)](#7-schema-driven-field-extraction-fieldspec--matchrule)
8. [Hook lifecycle: hooks.json schema, matchers, dispatcher worker](#8-hook-lifecycle-hooksjson-schema-matchers-dispatcher-worker)
9. [Hook exit-code conventions](#9-hook-exit-code-conventions)
10. [bun-runner.js: Node-launches-Bun bridge](#10-bun-runnerjs-node-launches-bun-bridge)
11. [Worker daemon: Express + lazy spawn + health/readiness gates](#11-worker-daemon-express--lazy-spawn--healthreadiness-gates)
12. [Per-user port allocation `37700 + (uid % 100)`](#12-per-user-port-allocation-37700--uid--100)
13. [PID file with start-token ownership verification](#13-pid-file-with-start-token-ownership-verification)
14. [Worker-fallback wrapper for hooks](#14-worker-fallback-wrapper-for-hooks)
15. [Hook stdin: incremental JSON parse with safety timeout](#15-hook-stdin-incremental-json-parse-with-safety-timeout)
16. [Platform adapter layer for hook input normalization](#16-platform-adapter-layer-for-hook-input-normalization)
17. [SettingsDefaultsManager — env-overridable settings.json](#17-settingsdefaultsmanager--env-overridable-settingsjson)
18. [Atomic state writes (tmp + rename)](#18-atomic-state-writes-tmp--rename)
19. [Logger as append-only daily file](#19-logger-as-append-only-daily-file)
20. [Plugin/marketplace install model](#20-pluginmarketplace-install-model)
21. [`additionalContext` injection via UserPromptSubmit hook](#21-additionalcontext-injection-via-userpromptsubmit-hook)
22. [GracefulShutdown sequencing](#22-gracefulshutdown-sequencing)
23. [Server-Sent Events for the live viewer](#23-server-sent-events-for-the-live-viewer)
24. [skip list](#skip-list)

---

## 1. FileTailer (byte-offset jsonl tailing)

**what it is.** A small class that watches a single jsonl file with `fs.watch`, reads only the bytes appended since the last read, and emits whole lines to a callback. Survives restarts because the offset is persisted externally.

**where in the code.** `vendor/claude-mem/src/services/transcripts/watcher.ts:15-85` (the class itself; `TailState` interface is `:10-13`).

```ts
// watcher.ts:44-84
private async readNewData(): Promise<void> {
  if (!existsSync(this.filePath)) return;
  let size = 0;
  try { size = statSync(this.filePath).size; } catch { return; }
  if (size < this.tailState.offset) { this.tailState.offset = 0; }   // truncation reset
  if (size === this.tailState.offset) return;
  const stream = createReadStream(this.filePath, {
    start: this.tailState.offset, end: size - 1, encoding: 'utf8'
  });
  let data = ''; for await (const chunk of stream) data += chunk;
  this.tailState.offset = size;
  this.onOffset(this.tailState.offset);
  const combined = this.tailState.partial + data;
  const lines = combined.split('\n');
  this.tailState.partial = lines.pop() ?? '';   // hold incomplete final line
  for (const line of lines) { const t = line.trim(); if (t) await this.onLine(t); }
}
```

**why it works.** Three things matter and they're all here: (a) `fs.watch` only fires the trigger — actual data is read by stat-then-stream from a known offset, so coalesced events are fine; (b) a `partial` buffer holds half-written final lines until the next event completes them; (c) truncation (size shrinks) resets offset to 0 instead of throwing or skipping. There's also a `poke()` method (`watcher.ts:40-42`) for cases where the recursive root watcher fires before the file watcher itself attaches.

**relevance to claude-meta.** **Adopt as-is.** This is exactly what we need for live-tailing the active Claude Code session jsonl. The whole class is ~75 lines and has no claude-mem-specific dependencies beyond a logger.

## 2. Watch-state file for resume across restarts

**what it is.** A flat `{ offsets: { [filePath]: number } }` json blob written next to the data dir, persisted on every offset change. On startup the watcher resumes from each saved offset; if missing, it can optionally `startAtEnd` (start from the current EOF, ignoring history).

**where in the code.** `src/services/transcripts/state.ts:1-41` (load/save), `src/services/transcripts/watcher.ts:233-253` (apply on tailer creation), example file at `vendor/claude-mem/transcript-watch.example.json`.

**why it works.** Persisting on every offset bump (line 251 `saveWatchState(this.statePath, this.state)`) is technically chatty but writes are tiny and synchronous, and it means a crash never re-emits already-processed lines. Save is best-effort with a try/catch that logs and moves on (`state.ts:34-39`); load tolerates missing/garbled files and returns `{ offsets: {} }` (`state.ts:18-24`).

**caveat to note.** The save is *not* atomic (plain `writeFileSync`) — a crash mid-write could corrupt the json. Compare with the hook-failure state, which *does* use tmp+rename (see §18). For our purposes, write-on-every-line is overkill; we should probably batch (see relevance).

**relevance to claude-meta.** **Adapt.** Adopt the shape and the resume logic, but: (a) write atomically (tmp+rename), (b) debounce saves to e.g. every N lines or every 250ms — claude-meta is purely a UI-side observer, so re-emitting a few lines on crash is fine; we don't need per-line durability. Also `startAtEnd` is the right default for us (we don't want to replay an entire historical session into the side panel on reconnect).

## 3. File discovery: globs, dir auto-expansion, recursive root watcher

**what it is.** Three behaviors stacked: a watch path can be a glob (`~/.codex/sessions/**/*.jsonl`), a directory (auto-expanded to `**/*.jsonl`), or a single file. After initial discovery, a recursive `fs.watch` on the deepest non-glob ancestor catches newly created files and pokes the corresponding tailer.

**where in the code.** `src/services/transcripts/watcher.ts:114-221`.
- `setupWatch` orchestrates: `watcher.ts:114-158`.
- `deepestNonGlobAncestor` walks segments to find the literal-prefix dir to give to `fs.watch({ recursive: true })`: `watcher.ts:160-184`.
- `resolveWatchFiles` handles the glob/dir/file trichotomy: `watcher.ts:193-213`.
- `hasGlob`: `watcher.ts:219-221`.

```ts
// watcher.ts:135-149 — recursive watch + new-file detection
const watcher = fsWatch(watchRoot, { recursive: true, persistent: true }, (event, name) => {
  if (!name) return;
  const changed = resolvePath(watchRoot, name).replace(/\\/g, '/');
  const existingTailer = this.tailers.get(changed);
  if (existingTailer) { existingTailer.poke(); return; }
  const matches = this.resolveWatchFiles(resolvedPath);
  for (const filePath of matches) {
    if (!this.tailers.has(filePath)) {
      void this.addTailer(filePath, watch, schema, false);
    }
  }
});
```

**why it works.** Two-level watch pattern: the recursive watcher catches *creations* and routes them either to existing tailers (poke) or to a re-glob-and-attach. Per-file watchers handle *appends* for already-known files. Re-globbing on every directory event is cheap because `globSync` against a small jsonl tree is ms-level, and the `tailers.has(...)` guard keeps it idempotent.

**relevance to claude-meta.** **Adapt.** For Claude Code, the active jsonl lives at `~/.claude/projects/<project-encoded-cwd>/<session-uuid>.jsonl`. We want: (a) glob-discovery similar to claude-mem's, (b) but specifically prefer "the most recently modified jsonl in the project dir" as the active session (vs. tailing all of them). The `deepestNonGlobAncestor` + recursive watch trick is worth keeping verbatim.

## 4. Session ID extraction from file paths

**what it is.** Pull a UUID out of the file path as a fallback session identifier when the jsonl entries don't carry one (or for early-stream events before the first `session_meta`).

**where in the code.** `src/services/transcripts/watcher.ts:290-293`.

```ts
private extractSessionIdFromPath(filePath: string): string | null {
  const match = filePath.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}
```

This is then passed as `sessionIdOverride` into `processEntry`, used only when the schema-resolved `sessionId` field is missing (`processor.ts:57-71`).

**why it works.** UUID-shaped path components are unambiguous; no false positives in practice. Cheap regex, computed once per tailer.

**relevance to claude-meta.** **Adopt as-is.** Claude Code's jsonl filenames are exactly UUIDs (`<uuid>.jsonl`), so this regex hits on the first try.

## 5. Per-session state machine in TranscriptEventProcessor

**what it is.** A single `TranscriptEventProcessor` holds an in-memory `Map<sessionKey, SessionState>` (keyed `${watch.name}:${sessionId}`) and routes parsed jsonl entries through a switch on `event.action`. SessionState carries `cwd`, `project`, `lastUserMessage`, `lastAssistantMessage`, `pendingTools`. Cleared on `session_end`.

**where in the code.** `src/services/transcripts/processor.ts` — class scaffold + `handleEvent` switch at `:15-160`; the load-bearing per-action handlers (`handleToolUse`, `handleToolResult`, `sendObservation`, `handleSessionEnd`) at `:184-317`. The action enum is in `src/services/transcripts/types.ts:19-28`:

```ts
export type EventAction =
  | 'session_init' | 'session_context' | 'user_message' | 'assistant_message'
  | 'tool_use' | 'tool_result' | 'observation' | 'file_edit' | 'session_end';
```

Switch dispatch: `processor.ts:125-159`.

**why it works.** Decoupling "what kind of event is this" (schema-defined `action`) from "what to do with it" (handler method) keeps the watcher schema-pluggable. The session map gives O(1) lookup and lets late-arriving fields (e.g. `cwd` from a `session_meta` line that follows the first `user_message` for a recovered session) update accumulating state without re-parsing.

**relevance to claude-meta.** **Adapt.** For us a "session" maps cleanly to a single Claude Code jsonl. Most of the actions translate directly. We probably don't need `file_edit` or `observation` as separate actions — the side conversation cares about prompts, assistant turns, and tool activity. Also, we only ever have *one* watch (Claude Code's jsonl), so the `${watch.name}:${sessionId}` compounding is unnecessary; flat sessionId keys are fine.

## 6. Tool-call / tool-result pairing via pendingTools map

**what it is.** Tool calls (with `toolUseID`) and their results may arrive on separate jsonl lines. `SessionState.pendingTools: Map<toolId, {toolName, toolInput}>` holds the call until the matching result is seen, then both are emitted together as one observation.

**where in the code.** `src/services/transcripts/processor.ts:184-241`.

```ts
// processor.ts:200-211 — tool_use side
if (toolName && toolResponse !== undefined) {
  await this.sendObservation(session, { toolName, toolInput, toolResponse, toolUseId: toolId });
} else if (toolName && toolId) {
  if (!session.pendingTools) session.pendingTools = new Map();
  session.pendingTools.set(toolId, { toolName, toolInput });
}

// processor.ts:219-226 — tool_result side
if (toolId && session.pendingTools) {
  const pending = session.pendingTools.get(toolId);
  if (pending) {
    if (!toolName) toolName = pending.toolName;
    if (toolInput === undefined) toolInput = pending.toolInput;
    session.pendingTools.delete(toolId);
  }
}
```

**why it works.** Tool calls and results are correlated by an opaque id but split across lines (in Codex sessions; the same is true of Claude Code, where the assistant message contains a `tool_use` block and a later `user`-role line carries the matching `tool_result`). Holding the call lets us emit a complete row downstream rather than two halves. Cleanup on `session_end` (`processor.ts:314 session.pendingTools?.clear()`).

**caveat.** No bound on the map. A tool that never returns leaks memory until session_end. Fine for short sessions; for long-running daemons watching weeks of activity, add a TTL.

**relevance to claude-meta.** **Adopt as-is** — with a max-size or TTL guard. We need exactly this pairing for the live UI.

## 7. Schema-driven field extraction (FieldSpec / MatchRule)

**what it is.** Each watched format declares a `TranscriptSchema` in JSON: a list of `events`, each with a `match` rule and a `fields` map. `FieldSpec` lets a field be a plain JSONPath-ish string, a `coalesce` chain, or a literal `value`. `MatchRule` supports `equals` / `in` / `contains` / `exists` / `regex`. This is what makes the watcher format-agnostic.

**where in the code.**
- types: `src/services/transcripts/types.ts:1-69`.
- resolution + matching: `src/services/transcripts/field-utils.ts:32-153`.
- example schema: `src/services/transcripts/config.ts:9-85` (Codex) or `vendor/claude-mem/transcript-watch.example.json`.

```ts
// field-utils.ts:67-99 — FieldSpec resolver
export function resolveFieldSpec(spec, entry, ctx) {
  if (typeof spec === 'string') {
    const fromContext = resolveFromContext(spec, ctx);   // $watch.name, $schema.x, $session.cwd
    if (fromContext !== undefined) return fromContext;
    return getValueByPath(entry, spec);
  }
  if (spec.coalesce) {
    for (const candidate of spec.coalesce) {
      const value = resolveFieldSpec(candidate, entry, ctx);
      if (!isEmptyValue(value)) return value;
    }
  }
  if (spec.path) { /* ... */ }
  if (spec.value !== undefined) return spec.value;
  if (spec.default !== undefined) return spec.default;
}
```

The path mini-language (`field-utils.ts:10-42`) handles `payload.id`, `messages[3].content`, and a leading `$.` prefix.

**why it works.** Decouples ingestion code from format quirks. Adding a new transcript format is a JSON file, not a code change. The `coalesce` operator is the secret weapon — Codex tool calls have `payload.name` for `function_call` but `payload.type` for `exec_command`; coalescing tries them in order.

**relevance to claude-meta.** **Skip — but steal the path mini-language.** For claude-meta we have *one* well-known format (Claude Code jsonl). A schema-driven engine is overkill; hand-rolled match logic in plain TS is clearer and easier to maintain. However, `getValueByPath` (`field-utils.ts:32-43`) is a useful 12-line utility for safe nested field access — keep that. The `coalesce` idea is good in spirit (Claude Code's content-block array vs. plain string), but inline with `??` chains.

## 8. Hook lifecycle: hooks.json schema, matchers, dispatcher worker

**what it is.** Claude Code reads `plugin/hooks/hooks.json` and fires shell commands at lifecycle points (`Setup`, `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`). Each hook entry has an optional `matcher` (e.g. `"Read"` for PreToolUse, `"startup|clear|compact"` for SessionStart), a `command` string, and a `timeout`. claude-mem funnels them all into a single dispatcher (`worker-service.cjs hook claude-code <event>`).

**where in the code.** `vendor/claude-mem/plugin/hooks/hooks.json` (whole file) declares the lifecycle commands. The end-to-end dispatch flow is in `src/cli/hook-command.ts:46-100` (read stdin → adapter → handler → adapter format → exit code). The argv switch in the daemon entry is at `src/services/worker-service.ts:823-841` (the `hook` case). Adapters and handlers are wired through `src/cli/adapters/index.ts` and `src/cli/handlers/index.ts` (51 lines).

```jsonc
// hooks.json shape (abridged)
"PostToolUse": [{
  "matcher": "*",
  "hooks": [{ "type": "command", "shell": "bash",
    "command": "... node bun-runner.js worker-service.cjs hook claude-code observation",
    "timeout": 120
  }]
}]
```

The Setup-phase `version-check.js` is the **only** standalone hook script — everything else routes through `bun-runner.js` → `worker-service.cjs`. The dispatcher's per-event branching is in `src/cli/handlers/index.ts:1-51`.

**why it works.** One process per hook is mandatory (Claude Code spawns a fresh shell each time), but compiling all hook logic into one bundled `worker-service.cjs` and dispatching by argv keeps the cold-start cost low (one Bun startup, one bundled file) and makes shared state (logger, settings, http client) trivial. Matchers narrow when hooks fire — `"matcher": "Read"` on PreToolUse means we only pay the hook cost on file reads, not every tool.

**relevance to claude-meta.** **Adopt the dispatcher pattern, simplify the schema.** We probably need only `SessionStart` (to know which jsonl to tail) and `UserPromptSubmit` (to inject context from the side panel). Skip Setup-version-check, it's plugin-distribution machinery. Match `"startup|clear|compact"` on SessionStart same as claude-mem.

## 9. Hook exit-code conventions

**what it is.** Three exit codes: `0` = success/silent, `1` = non-blocking error (stderr shown), `2` = blocking error (stderr fed back to Claude as input). Plus `3` = "user-message only" used internally.

**where in the code.** `src/shared/hook-constants.ts:13-18`.

```ts
export const HOOK_EXIT_CODES = {
  SUCCESS: 0, FAILURE: 1, BLOCKING_ERROR: 2, USER_MESSAGE_ONLY: 3,
} as const;
```

claude-mem's policy is **graceful by default, fail-loud after repeated specific failures, blocking on uncaught errors**. Concretely (per `src/cli/hook-command.ts`):

- **Worker unreachable** → exit 0 silently (`hook-command.ts:84-90`).
- **Adapter rejected input** (`AdapterRejectedInput`) → exit 0 silently (`hook-command.ts:76-82`).
- **Fail-loud escalation** after N consecutive worker-unreachable hooks → exit 2 with stderr (`worker-utils.ts:344-351`).
- **Generic uncaught errors** → exit 2 (`BLOCKING_ERROR`) at `hook-command.ts:92-96`. This is the default catch-all, *not* exit 0.

So the project's CLAUDE.md aspiration ("hooks always exit 0 to avoid Windows Terminal tab accumulation") is partially aspirational — only *recognized* degradation paths swallow the error; unanticipated exceptions still block.

**why it works.** Plugins that bail noisily train users to disable them. claude-mem's "silent failure on the known-failure modes + counter that escalates + blocking exit on truly unexpected errors" balances "don't be disruptive" with "don't be a black hole" *and* "don't hide bugs in our own code".

**relevance to claude-meta.** **Adopt as-is.** Same calculus applies: a passive observer absolutely must not break Claude Code. The fail-loud-after-N pattern (`worker-utils.ts:276-353`) is also worth copying — atomic write, threshold from settings, escalates to exit 2 only after repeated failures.

## 10. bun-runner.js: Node-launches-Bun bridge

**what it is.** A pure-Node ESM script that finds Bun (PATH lookup, then a hard-coded fallback list), forwards stdin/argv, and `spawn`s Bun on the target script. Used because Claude Code only guarantees Node on PATH — Bun must be located by the plugin itself.

**where in the code.** `vendor/claude-mem/plugin/scripts/bun-runner.js` (whole file, 156 lines).

Key bits:
- find-Bun search order: `bun-runner.js:23-61` (which/where → home `.bun/bin/bun` → `/usr/local`, `/opt/homebrew`, `/home/linuxbrew`).
- early-exit if plugin disabled: `bun-runner.js:63-77` (reads `~/.claude/settings.json` and bails on `enabledPlugins["claude-mem@thedotmack"] === false`). The worker daemon also self-checks via `isPluginDisabledInClaudeSettings` (`src/shared/plugin-state.ts`, called at `worker-service.ts:740`) — belt-and-suspenders so the daemon won't keep running if the plugin gets disabled after launch.
- stdin pass-through with 5s timeout fallback: `bun-runner.js:96-118`.
- broken-script-path repair: `bun-runner.js:13-21` (handles a known Claude Code bug where `${CLAUDE_PLUGIN_ROOT}/scripts/foo` becomes `/scripts/foo`).

**why it works.** Plugin distribution can't assume Bun is installed where Claude Code can find it (especially on Windows / on macOS without `~/.bun/bin` on the shell-PATH inherited by the plugin shell). The runner is small, has no deps beyond Node stdlib, and handles the cross-platform PATH dance once.

**relevance to claude-meta.** **Adopt with simplifications.** We almost certainly need the same Node-shim. Skip the broken-path repair if we control our own paths. Skip the per-plugin-disable check unless we actually ship through the marketplace (we might ship as a local `claude plugin install` instead).

## 11. Worker daemon: Express + lazy spawn + health/readiness gates

**what it is.** Long-lived HTTP server with two health-style endpoints — `/api/health` (process is up) and `/api/readiness` (DB + search are initialized) — plus an admin `POST /api/admin/shutdown` for graceful stop. Hooks lazy-spawn the worker if it's not running; spawn waits for `/api/health` to respond before declaring success. There's a 120s middleware-level wait gate that holds API requests until DB init completes (`worker-service.ts:228-259`).

**where in the code.**
- entry/main: `src/services/worker-service.ts:736-955` (top-level main; cases `start`, `stop`, `restart`, `status`, `--daemon`).
- Express server wrapper: `src/services/server/Server.ts` (a thin wrapper other code calls `registerRoutes` on — useful boilerplate to copy).
- route registration in worker startup: `worker-service.ts:261-269`.
- start logic + lazy spawn: `src/services/worker-spawner.ts:70-153`.
- Health/readiness polling: `src/services/infrastructure/HealthMonitor.ts:54-92` (`pollEndpointUntilOk` is `:54-75`; `waitForHealth` / `waitForReadiness` / `waitForPortFree` extend through `:92`).
- Lazy spawn from hooks: `src/shared/worker-utils.ts:223-266`.
- Init-gate middleware: `src/services/worker-service.ts:228-259`.
- True daemonization (Linux): `src/services/infrastructure/ProcessManager.ts:450-462` checks for `/usr/bin/setsid` and prefers it for proper session detachment so the worker survives terminal close.

**why it works.** The split between "alive" and "ready" is load-bearing — Bun starts in <1s but DB+search init can take many seconds, so hooks need to know the difference between "still warming up" (continue, but expect 503s for a moment) and "actually dead" (don't bother). The `WorkerStartResult` enum (`worker-spawner.ts:68`) — `'ready' | 'warming' | 'dead'` — is propagated all the way back to the caller.

**relevance to claude-meta.** **Adopt the architecture, simplify the contents.** We need: (1) a long-lived local server, (2) `/health` + `/ready`, (3) lazy spawn from hooks (or just user-launched `bun run dev` for v1). Skip Chroma init, MCP self-check, supervisor, Cursor/Gemini integration paths, and the V12.4.3 cleanup. The `pollEndpointUntilOk` helper (`HealthMonitor.ts:54-75`) is 20 lines and reusable verbatim. The `Server.ts` wrapper is a clean starting point — copy or rewrite at our scale. For the live UI channel, see §23 (SSE).

## 12. Per-user port allocation `37700 + (uid % 100)`

**what it is.** Default worker port is computed from the OS uid so two different users on one box don't collide. Overridable via `CLAUDE_MEM_WORKER_PORT`.

**where in the code.** `src/shared/SettingsDefaultsManager.ts:73`:

```ts
CLAUDE_MEM_WORKER_PORT: String(37700 + ((process.getuid?.() ?? 77) % 100)),
```

(The `?? 77` fallback is for Windows, where `getuid` is undefined.) Read by `getWorkerPort` at `src/shared/worker-utils.ts:41-50` (cached after first read).

**why it works.** Removes a class of "two users on a shared dev box step on each other's ports" bugs without needing real port-discovery (which would require a registration file or service-discovery layer). Range `37700-37799` is safely in the dynamic/private range.

**relevance to claude-meta.** **Adopt — pick a different base port.** Use e.g. `37800 + (uid % 100)` to avoid colliding with claude-mem when both are installed. Same pattern; same fallback for Windows.

## 13. PID file with start-token ownership verification

**what it is.** `~/.claude-mem/worker.pid` holds `{pid, port, startedAt, startToken}` json. On startup the worker checks for an existing pid file, reads it, and uses the *start token* (a procfs read or platform-equivalent that captures process start-time/identity) to confirm the recorded pid is *the* worker — not a recycled pid from some unrelated process.

**where in the code.**
- write/read: `src/services/infrastructure/ProcessManager.ts` — `writePidFile` `:132-137`, `readPidFile` `:139-152`, `removePidFile` `:154-166`.
- start-token implementation: `src/supervisor/process-registry.ts` (where `captureProcessStartToken` and `verifyPidFileOwnership` actually live — the OS-level capture logic). Re-exported from `ProcessManager.ts:125-130`.
- liveness checks: `isProcessAlive` `ProcessManager.ts:472-490`; `isPidFileRecent` `:492-504`.
- duplicate-spawn guard at startup: `src/services/worker-service.ts:913-928`.

**why it works.** Pids get recycled. A bare "is the pid alive?" check (`isProcessAlive` `ProcessManager.ts:472-490`) returns true for any process with that pid, which on a long-running box is increasingly unreliable. Pairing pid with start-token makes ownership identifiable.

**relevance to claude-meta.** **Adapt, lighter.** We need a pid file to make `claude-meta status` and graceful restart work, but we can skip the start-token complexity for v1: pid + port + a recency check (`isPidFileRecent`, `ProcessManager.ts:492-504`) covers most of the value. Revisit if we hit pid-recycle bugs in practice.

## 14. Worker-fallback wrapper for hooks

**what it is.** A `executeWithWorkerFallback<T>` helper that wraps every hook→worker HTTP call. If the worker is unreachable, it returns a `WorkerFallback` sentinel object (branded with a Symbol) instead of throwing. Hooks check `isWorkerFallback(result)` and silently exit 0. Repeated unreachables increment a persisted counter; after N consecutive failures, the hook escalates to exit 2.

**where in the code.** `src/shared/worker-utils.ts:361-417` (the wrapper, `WORKER_FALLBACK_BRAND` declared at `:361`), `:276-353` (the failure counter and atomic writes), `:268-274` (`ensureWorkerAliveOnce` — per-process memoization of liveness, important for hooks that make multiple worker calls in sequence). Hook usage: `src/cli/handlers/observation.ts:31-48`, `src/cli/handlers/session-init.ts:54-67`.

```ts
// worker-utils.ts:379-389 — the wrapper
export async function executeWithWorkerFallback<T>(url, method, body, options = {}) {
  const alive = await ensureWorkerAliveOnce();
  if (!alive) {
    recordWorkerUnreachable();
    return { continue: true, reason: 'worker_unreachable', [WORKER_FALLBACK_BRAND]: true };
  }
  // ... fetch + parse
  resetWorkerFailureCounter();
  return parsed as T;
}
```

**why it works.** Combines three concerns into one call: liveness check (cached), graceful degradation (no exception), and observability (the counter so users learn about a chronically-broken worker without every individual hook screaming). The Symbol-branded fallback object survives JSON deserialization (well, no — the Symbol is local; this only works for in-process passing, which is the actual usage).

**relevance to claude-meta.** **Adopt the shape; rebuild the internals smaller.** A passive observer's hooks should also degrade gracefully. The fail-loud-after-N pattern is gold (atomic state file at `src/shared/worker-utils.ts:308-323`). Drop the multi-method generic if we can — likely we have only POST.

## 15. Hook stdin: incremental JSON parse with safety timeout

**what it is.** The hook receives a JSON object on stdin from Claude Code. Rather than buffering until EOF (which can be slow), the reader tries to parse incrementally on each `data` chunk; if parsing succeeds, it resolves immediately. A 30s safety timeout and a 50ms parse-debounce protect against pathological cases.

**where in the code.** `src/cli/stdin-reader.ts:40-146`.

```ts
// stdin-reader.ts:99-114 — onData
const onData = (chunk) => {
  input += chunk;
  if (parseDelayId) { clearTimeout(parseDelayId); parseDelayId = null; }
  if (tryResolveWithJson()) return;            // optimistic: maybe it's complete now
  parseDelayId = setTimeout(tryResolveWithJson, PARSE_DELAY_MS);
};
```

**why it works.** Claude Code's stdin sometimes stays open even after the JSON is delivered. Without incremental parsing the hook would block on EOF, hitting the hook-level timeout. The 50ms debounce avoids parsing after every byte.

**relevance to claude-meta.** **Adopt as-is.** Solves a real problem; 100 lines of well-tested code. Drop in whole.

## 16. Platform adapter layer for hook input normalization

**what it is.** Each platform that sends hook events (Claude Code, Cursor, Gemini-CLI, Windsurf, raw) has an adapter that maps its input shape to a `NormalizedHookInput`. Handlers operate only on the normalized shape.

**where in the code.** `src/cli/adapters/index.ts:1-20`, individual adapters in same folder. Claude Code adapter: `src/cli/adapters/claude-code.ts:1-42`.

```ts
// claude-code.ts:9-26
export const claudeCodeAdapter: PlatformAdapter = {
  normalizeInput(raw) {
    const r = (raw ?? {}) as any;
    const cwd = r.cwd ?? process.cwd();
    if (!isValidCwd(cwd)) throw new AdapterRejectedInput('invalid_cwd');
    return {
      sessionId: r.session_id ?? r.id ?? r.sessionId,
      cwd, prompt: r.prompt,
      toolName: r.tool_name, toolInput: r.tool_input, toolResponse: r.tool_response,
      transcriptPath: r.transcript_path,
      agentId: pickAgentField(r.agent_id),
      agentType: pickAgentField(r.agent_type),
    };
  },
  formatOutput(result) { /* maps HookResult to JSON */ }
};
```

**why it works.** Same handler code (`session-init`, `observation`, ...) works across five platforms because field-name mapping is at the edge. Also: validation lives in the adapter (`isValidCwd`, `pickAgentField`'s 128-char cap on agent fields) — if it doesn't pass, you throw `AdapterRejectedInput` and the hook silently bails.

**relevance to claude-meta.** **Skip the multi-platform abstraction; keep the validation pattern.** We only target Claude Code. But: keep the "validate at the edge, throw a tagged error, hook handler maps it to silent exit 0" idiom. It's clean.

## 17. SettingsDefaultsManager — env-overridable settings.json

**what it is.** A single static class holding every config key as a string default. `loadFromFile(path)`: if file doesn't exist, write defaults; if it exists, merge over defaults; finally, env vars override everything. Auto-migrates old nested `{env: {...}}` schema to flat.

**where in the code.** `src/shared/SettingsDefaultsManager.ts:69-207`. Defaults dict at `:70-131`; load+merge at `:161-206`; env-override at `:151-159`.

**why it works.** Three sources of truth (defaults, file, env) merged in deterministic order. Auto-create-on-first-read means no install-time scaffolding. Auto-migrate handles schema evolution without breaking existing installs.

**caveat.** Everything is `string`. Numbers/booleans are stringly typed (`'true'` / `'false'`, parseInt at the call site). Acceptable for a config file but worth being aware of.

**relevance to claude-meta.** **Adapt with a smaller surface.** Same pattern, fewer keys. Use `zod` to validate and *parse* (give us proper booleans/numbers) rather than the stringly-typed approach. The "create file with defaults if missing" behavior is the right UX.

## 18. Atomic state writes (tmp + rename)

**what it is.** State files that must not be corrupted on crash are written to a `.tmp` file first, then `renameSync`'d into place.

**where in the code.** `src/shared/worker-utils.ts:308-323`:

```ts
function writeHookFailureStateAtomic(state) {
  const stateDir = getStateDir();
  const dest = getHookFailuresPath();
  const tmp = `${dest}.tmp`;
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  writeFileSync(tmp, JSON.stringify(state), 'utf-8');
  renameSync(tmp, dest);
}
```

**why it works.** `rename` is atomic on POSIX (within the same filesystem), so a reader either sees the old file or the new one — never a half-written one.

**relevance to claude-meta.** **Adopt.** Use this for *all* state files (watch-state especially — see §2). Trivial to copy.

## 19. Logger as append-only daily file

**what it is.** A singleton `Logger` writes structured (JSON-style key/value) lines to a daily-rotating file at `~/.claude-mem/logs/claude-mem-YYYY-MM-DD.log`, plus stderr in dev. Levels DEBUG/INFO/WARN/ERROR. Components are a fixed enum of strings (`'HOOK'`, `'WORKER'`, `'TRANSCRIPT'`, ...).

**where in the code.** `src/utils/logger.ts` (340 lines total; class spans `:60-338`). Lazy file init: `:71-86`. Append: `:267-271`.

**why it works.** Hook processes are short-lived and there's no console for them, so a file log is the only way to see what happened. Daily rotation keeps each file manageable. Lazy init avoids a circular dep with the settings module.

**relevance to claude-meta.** **Adopt, simpler.** A single `~/.claude-meta/logs/<date>.log` is fine. Skip the component enum until we have ten of them.

## 20. Plugin/marketplace install model

**what it is.** Two parallel install locations:
- `~/.claude/plugins/marketplaces/<owner>/` — the rsync'd source tree.
- `~/.claude/plugins/cache/<owner>/<plugin>/<version>/` — versioned cache dirs.

The hook commands try `${CLAUDE_PLUGIN_ROOT}` first, then fall back to the most recent versioned cache dir, then to the marketplace dir. Plugin manifest at `plugin/.claude-plugin/plugin.json`; marketplace manifest at `.claude-plugin/marketplace.json`.

**where in the code.**
- marketplace.json: `vendor/claude-mem/.claude-plugin/marketplace.json`.
- plugin.json: `vendor/claude-mem/plugin/.claude-plugin/plugin.json`.
- hook command shell snippet doing the fallback dance: see hooks.json above (the `_R="${CLAUDE_PLUGIN_ROOT}"; [ -z "$_R" ] && _R=$(ls -dt ".../cache/.../[0-9]*/")` chain).
- sync logic: `scripts/sync-marketplace.cjs:1-213`.

**why it works.** Claude Code resolves `${CLAUDE_PLUGIN_ROOT}` at hook invocation time, but during dev rsync it can be stale; the fallback to the freshest versioned cache dir keeps hooks working across upgrades.

**relevance to claude-meta.** **Skip the marketplace; pick a simpler install path.** For a tool that runs locally and isn't redistributed by us, plain `claude plugin install ./` from the repo (or a local marketplace pointing at the repo) is the path. Marketplace publishing is for plugins that go public. Even for local installs `${CLAUDE_PLUGIN_ROOT}` isn't perfectly reliable — `bun-runner.js:13-21` exists specifically because Claude Code has a bug where `${CLAUDE_PLUGIN_ROOT}/scripts/foo` can become `/scripts/foo`. So if we go down the plugin route, port the same `fixBrokenScriptPath` defensive check.

## 21. `additionalContext` injection via UserPromptSubmit hook

**what it is.** A UserPromptSubmit hook can return `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '...' } }` to prepend text to the user's prompt before it reaches Claude. claude-mem uses this to inject semantically-retrieved past observations.

**where in the code.** Handler returns the internal `HookResult` at `src/cli/handlers/session-init.ts:110-119`; the Claude Code adapter's `formatOutput` strips it down to the actual stdout shape at `src/cli/adapters/claude-code.ts:27-41`; `hookCommand` then `console.log(JSON.stringify(output))` at `src/cli/hook-command.ts:58`.

The handler returns this internal `HookResult` shape:

```ts
// session-init.ts:110-119 — internal HookResult (NOT the stdout JSON)
if (additionalContext) {
  return {
    continue: true,             // internal flag, NOT emitted on stdout
    suppressOutput: true,       // internal flag, NOT emitted on stdout
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext         // ← this is what gets prepended to the prompt
    }
  };
}
```

The adapter's `formatOutput` then discards `continue` and `suppressOutput` and emits **only**:

```json
{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "..." } }
```

**why it works.** This is the official supported path for hooks to alter the conversation. Returning the JSON shape Claude Code expects on stdout is all it takes — the internal `HookResult` flags are sugar for the in-process pipeline and never cross the process boundary.

**relevance to claude-meta.** **Adopt — this is the core mechanism.** Our entire premise (refining instructions before they hit Claude) hinges on this hook. The minimal correct stdout JSON is `{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<text>" } }`. Worth verifying against the latest Claude Code hook docs since this is the load-bearing API.

## 22. GracefulShutdown sequencing

**what it is.** A coordinator that runs the daemon's stop sequence in a deterministic order on `SIGTERM` / `SIGINT` / `/api/admin/shutdown`: close the HTTP server (so no new requests land), drain the session manager (let in-flight work finish), close downstream clients and the DB, stop the supervisor. Each stage has its own timeout so a stuck handler can't hold the process forever.

**where in the code.** `src/services/infrastructure/GracefulShutdown.ts` (whole file). Wired into the worker entry around `src/services/worker-service.ts:736-955`.

**why it works.** Daemons that crash-stop leak in-flight writes and hang external requests. A staged shutdown lets each subsystem flush — important for the watch-state file (§2), the failure counter (§14), and any open log file (§19). Per-stage timeouts mean one slow component can't block the others.

**relevance to claude-meta.** **Adapt.** claude-meta is also a long-lived local daemon. We need at least: close the websocket server, flush the watch-state file, close the active jsonl tailer's file descriptors, log a final "stopped at <ts>" line. Don't over-engineer — three or four stages with a 2s budget each is plenty for v1.

## 23. Server-Sent Events for the live viewer

**what it is.** claude-mem broadcasts viewer-relevant updates over SSE (Server-Sent Events) to whatever browser tabs are subscribed. One-way (server → client), uses the standard `EventSource` API on the client side, no websocket framing complexity.

**where in the code.** Class at `src/services/worker/SSEBroadcaster.ts`. Instantiated by the worker at `worker-service.ts:150`. Broadcasts fire at `worker-service.ts:724` (`this.sseBroadcaster.broadcast(...)`).

**why it works.** SSE is dead-simple compared to websockets: a long-lived `text/event-stream` HTTP response, one event per `data: ...\n\n`, automatic browser-side reconnection. Perfect for "server pushes events, client renders them" — which is exactly the live-tail UI shape. Backpressure isn't a concern at our scale (one user, a few tabs).

**relevance to claude-meta.** **Adopt as-is**, with a tiny rewrite for Bun. Our ui has the same shape: server tails the jsonl, sends each parsed event to subscribed tabs, browser renders. SSE wins over websocket for v1 (no library, no protocol upgrade, fewer corner cases). Note: `Bun.serve` supports SSE natively via `ReadableStream` responses with `text/event-stream` — `SSEBroadcaster` is small enough to lift directly or rewrite in 30 lines.

---

## skip list

Things in claude-mem we should **not** copy into claude-meta:

- **Chroma vector DB + embeddings** (`src/services/sync/ChromaSync.ts`, ChromaMcpManager, `runOneTimeChromaMigration`) — claude-mem does semantic retrieval; we don't need retrieval at all, just live tailing.
- **Multi-LLM provider abstractions** (`ClaudeProvider`, `GeminiProvider`, `OpenRouterProvider` in `src/services/worker/`) — we may call an LLM, but a single-provider direct API call is fine; no fallback chain.
- **SQLite + DatabaseManager + SessionManager + pending_messages queue** (`src/services/worker/DatabaseManager.ts`, `SessionManager.ts`) — claude-mem persists everything for cross-session retrieval. claude-meta is per-session and ephemeral; in-memory state is enough.
- **Agent SDK orchestration / generator restart logic** (`worker-service.ts:506-687`) — that's compaction-specific.
- **Compaction summary pipeline + `handleSessionEnd → queueSummary`** (`processor.ts:311-341`) — this is the actual compaction step; not our use case.
- **Tree-sitter grammars and the smart-file-read service** (`src/services/smart-file-read/`, all `tree-sitter-*` deps in `plugin/package.json`) — code-aware summarization; out of scope.
- **AGENTS.md / CLAUDE.md regeneration** (`writeAgentsMd`, `claude-md-utils.ts`, the `updateContext` flow in `processor.ts:343-388`) — we inject into the live prompt, not into a file Claude reads at session start.
- **Marketplace publishing scripts** (`scripts/sync-marketplace.cjs`, `scripts/publish.js`, the np release config in `package.json`) — only relevant if we publish through `~/.claude/plugins/marketplaces/`. Local install is sufficient.
- **Multi-platform adapters** (Cursor, Gemini-CLI, Windsurf, OpenCode integrations under `src/integrations/` and `src/cli/adapters/`) — Claude Code only.
- **Worktree adoption** (`src/services/infrastructure/WorktreeAdoption.ts`) — claude-mem-specific bookkeeping for git worktrees feeding into the same DB.
- **Supervisor / process registry** (`src/supervisor/`) — overkill for a single-process daemon.
- **One-time migrations / version-check hook** (`runOneTimeChromaMigration`, `runOneTimeCwdRemap`, `runOneTimeV12_4_3Cleanup`, `plugin/scripts/version-check.js`) — these are scar tissue from claude-mem's own version history.
- **Anti-pattern test harness, ts-prune scripts, translate-readme** (`scripts/anti-pattern-test/`, `scripts/translate-readme/`) — distribution-side concerns.
- **Multi-account profile support via `CLAUDE_MEM_DATA_DIR`** — could be nice eventually but not for v1.
- **Bug-report CLI** (`scripts/bug-report/`) — can revisit if/when claude-meta has users.
- **The `<private>...</private>` tag-stripping pipeline** (`src/utils/tag-stripping.ts`) — that's a privacy feature for a system that *stores* observations. We don't store; we forward live.
