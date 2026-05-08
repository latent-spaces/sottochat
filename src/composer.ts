// composer subprocess: per-session SDK agent that turns each closed turn into
// a short hyperframes composition (HTML only — no TTS, no render, no mp4).
//
// shape per session:
//   - one long-lived sdk subprocess (sonnet)
//   - cwd = ~/.cut-the-cake/composer/<sessionKey>/  (stable across turns; the
//     agent creates one <turnId>/ subdir per closed turn it works on, so prompt
//     cache stays warm AND each composition lives in its own clean dir)
//   - tools enabled: Bash + Read + Write + Edit + Grep + Glob (the agent runs
//     `npx hyperframes lint --strict` itself, fixes errors, iterates)
//   - tools disabled: WebFetch, WebSearch, Task, NotebookEdit, AskUserQuestion,
//     TodoWrite — none are needed for composition authoring and they would
//     just give the model rope. blast radius is bounded by cwd.
//
// per-turn workflow (the system prompt enforces this):
//   1. server feeds: target turn (latest) + last 2 prior turns of context
//   2. agent reads the hyperframes skill files (absolute paths injected below)
//   3. agent mkdir <turnId>/, writes <turnId>/index.html
//   4. agent runs `npx hyperframes lint --strict` inside <turnId>/
//   5. on lint errors: agent edits index.html and re-lints (max 3 attempts)
//   6. final assistant message MUST end with the sentinel: `READY <turnId>`
//
// the server captures `READY <turnId>` from the assistant text stream and
// broadcasts composer:ready; if the agent never emits READY, it fires
// composer:error after a timeout. the iframe url is /composer/<sessionKey>/
// <turnId>/index.html — served as static files by the server.
//
// no tts, no audio, no rendering. the iframe runs the gsap timeline live;
// users see the composition play in real time inside the dashboard. mp4 export
// stays in src/hyperframes-export.ts for the legacy pane.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnFeed } from "./observer";
import type { MetaEvent } from "./jsonl";

export type ComposerStatus = "running" | "linting" | "ready" | "error";

export type ComposerEvent =
  | { kind: "running"; sessionKey: string; turnId: string; ts: number }
  | { kind: "linting"; sessionKey: string; turnId: string; attempt: number; ts: number }
  | { kind: "ready"; sessionKey: string; turnId: string; relPath: string; ts: number }
  | { kind: "error"; sessionKey: string; turnId: string; message: string; ts: number };

export type ComposerOptions = {
  model?: string;
  /** root dir for per-session subprocess cwds. defaults to ~/.cut-the-cake/composer */
  rootDir?: string;
  /** soft per-turn timeout — if no READY within this window, we abort + emit error */
  perTurnTimeoutMs?: number;
  onEvent?: (e: ComposerEvent) => void;
};

export type ComposerFeed = {
  /** the closed turn we're scripting */
  target: TurnFeed;
  /** prior closed turns from the same session (oldest first), 0..N */
  prior: TurnFeed[];
};

const DISALLOWED_TOOLS = [
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
  "AskUserQuestion",
  "TodoWrite",
];

const COMPOSER_DIR_DEFAULT = join(homedir(), ".cut-the-cake", "composer");

// pure helper exposed so callers (e.g. /debug/inject-composer, the static
// /composer/... route) can resolve a sessionKey to its on-disk dir without
// needing a running composer instance.
//
// shape: <sha1[:16]>__<short-tail> — the hash makes the key collision-resistant
// (sessions in the same long parent dir have UUIDs that fall past any reasonable
// truncate cutoff, hashing avoids that) while the short tail keeps directory
// listings vaguely human-readable. tail is the last 24 chars of the key with
// non-safe chars sanitised; collisions on the tail alone are fine because the
// hash carries the actual identity.
export function composerSafeKey(sessionKey: string): string {
  const hash = createHash("sha1").update(sessionKey).digest("hex").slice(0, 16);
  const tail = sessionKey.slice(-24).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${hash}__${tail}`;
}
export function composerRootDirFor(sessionKey: string, rootDir?: string): string {
  return join(rootDir ?? COMPOSER_DIR_DEFAULT, composerSafeKey(sessionKey));
}

// per-event clip — keep single chatty blocks from blowing up the prompt.
const BLOCK_CLIP = 1500;
// per-turn we sample head/tail; full event firehose is way too big for this
// agent (which is doing real authoring on the side, not just summarising).
const MAX_EVENTS_PER_TURN = 24;
// the agent has 6 minutes by default to produce a composition. lint loops are
// the long pole; with --strict and a tight system prompt, well-behaved runs
// finish in 60-120s.
const DEFAULT_PER_TURN_TIMEOUT_MS = 6 * 60 * 1000;

// where the hyperframes skill lives. the agent reads these directly via Read —
// the cwd doesn't matter, Read accepts absolute paths.
const SKILL_PATHS = {
  hyperframes: join(homedir(), ".claude", "skills", "hyperframes", "SKILL.md"),
  cli: join(homedir(), ".claude", "skills", "hyperframes-cli", "SKILL.md"),
  houseStyle: join(homedir(), ".claude", "skills", "hyperframes", "house-style.md"),
};

function findClaudeExecutable(): string {
  try {
    const p = execSync("which claude", { encoding: "utf8" }).trim().split("\n")[0]?.trim();
    if (p) return p;
  } catch {
    // fallthrough
  }
  throw new Error("`claude` not found on PATH — install Claude Code or set its path");
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// flatten one turn's events into a compact transcript for the agent.
function formatTurnEvents(events: MetaEvent[]): string[] {
  let working = events;
  if (events.length > MAX_EVENTS_PER_TURN) {
    const half = Math.floor(MAX_EVENTS_PER_TURN / 2);
    working = [...events.slice(0, half), ...events.slice(events.length - half)];
  }
  const out: string[] = [];
  for (const ev of working) {
    if (ev.kind === "user_message") {
      out.push(`USER: ${clip(ev.text, BLOCK_CLIP)}`);
    } else if (ev.kind === "assistant_text") {
      out.push(`ASSISTANT: ${clip(ev.text, BLOCK_CLIP)}`);
    } else if (ev.kind === "tool_use") {
      out.push(`TOOL ${ev.tool}: ${clip(ev.summary, BLOCK_CLIP)}`);
    } else if (ev.kind === "tool_result") {
      const tag = ev.isError ? "TOOL_RESULT (error)" : "TOOL_RESULT";
      out.push(`${tag}: ${clip(ev.summary, BLOCK_CLIP)}`);
    }
  }
  if (events.length > MAX_EVENTS_PER_TURN) {
    out.splice(Math.floor(MAX_EVENTS_PER_TURN / 2), 0, `... (${events.length - MAX_EVENTS_PER_TURN} events omitted) ...`);
  }
  return out;
}

function formatTurn(label: string, t: TurnFeed): string {
  const lines: string[] = [];
  lines.push(`### ${label}`);
  lines.push(`turnId: ${t.turnId}`);
  lines.push(
    `metrics: ${t.outputTokens} tok · ${t.toolUseCount} tools · +${t.linesAdded}/-${t.linesRemoved} lines`
  );
  if (t.events && t.events.length) {
    for (const block of formatTurnEvents(t.events)) lines.push(block);
  } else {
    if (t.userPrompt) lines.push(`USER: ${t.userPrompt}`);
    if (t.assistantExcerpt) lines.push(`ASSISTANT: ${t.assistantExcerpt}`);
  }
  return lines.join("\n");
}

function buildPromptBody(feed: ComposerFeed): string {
  const lines: string[] = [];
  lines.push(`You have a new turn to compose a video for.`);
  lines.push("");
  lines.push(`Target turn (the one you are scripting): \`${feed.target.turnId}\``);
  lines.push("");
  if (feed.prior.length > 0) {
    lines.push(`The two prior turns are included for CONTEXT only. Do NOT script them — they are background to help you understand what the user is working on.`);
    lines.push("");
    feed.prior.forEach((t, i) => {
      lines.push(formatTurn(`Prior turn ${i + 1} of ${feed.prior.length} (context only)`, t));
      lines.push("");
    });
  }
  lines.push(formatTurn("Target turn (SCRIPT THIS ONE)", feed.target));
  lines.push("");
  lines.push(`Now follow the protocol from the system prompt: read the hyperframes skill, mkdir \`${feed.target.turnId}/\`, write \`${feed.target.turnId}/index.html\`, lint, fix, READY.`);
  return lines.join("\n");
}

function buildSystemIntro(): string {
  return [
    `You are the COMPOSER for cut-the-cake. Your job: turn each closed turn from a Claude Code (or codex) session into a short HyperFrames composition — a single self-contained \`index.html\` that plays a 10-20 second visual recap of what happened in that turn.`,
    ``,
    `## What is HyperFrames?`,
    `HyperFrames is an HTML-based video framework. A composition is one HTML file with \`data-*\` attributes for timing, a GSAP timeline for animation, and CSS for appearance. The composition plays standalone in any browser — no server runtime needed.`,
    ``,
    `## Required reading before your FIRST composition (skip on subsequent turns)`,
    `- ${SKILL_PATHS.hyperframes}      — composition authoring`,
    `- ${SKILL_PATHS.cli}              — \`hyperframes lint\` and other CLI`,
    `- ${SKILL_PATHS.houseStyle}       — motion defaults, sizing, easing`,
    ``,
    `Read these once at the start. They set the rules for valid HyperFrames HTML. After your first turn, you can rely on what you've internalised — only re-read if a lint error references something you don't recognise.`,
    ``,
    `## Your protocol per turn`,
    ``,
    `1. The user message names a target turn id (e.g. \`abc123-...\`). Each composition lives in its own subdirectory of your cwd: \`<turnId>/index.html\`.`,
    ``,
    `2. Run \`mkdir -p <turnId>\` (Bash). Don't skip — without it the project dir won't exist for lint to scan.`,
    ``,
    `3. Author \`<turnId>/index.html\` (Write). The composition should:`,
    `   - be 10-20 seconds long total`,
    `   - capture the *target turn* — not the prior context turns. The prior turns help you understand WHAT the user is working on; the target tells you WHAT TO SHOW.`,
    `   - have 3-6 short scenes, each landing one beat of what the agent did`,
    `   - use the soft-pink dessert palette: \`#fff5f8\` background, \`#ec4899\` accent, \`#7d5366\` muted text. (cut-the-cake's house identity.)`,
    `   - use system-ui for prose; ui-monospace for file names, function names, and technical tokens`,
    `   - be 1280x720 (the default; don't reach for portrait)`,
    `   - vary 3+ different easings (\`power3.out\`, \`back.out(1.4)\`, \`power2.inOut\` are good choices)`,
    `   - position elements at their hero-frame layout in CSS, then animate FROM offscreen INTO that layout (the "Layout Before Animation" rule)`,
    ``,
    `4. Run \`npx hyperframes lint --strict\` from inside \`<turnId>/\` (Bash, with \`cwd: <turnId>\` — i.e. \`cd <turnId> && npx hyperframes lint --strict\`).`,
    ``,
    `5. On lint errors: edit \`<turnId>/index.html\` to fix every error, then re-lint. Maximum 3 lint attempts. If you can't get clean in 3 attempts, simplify the composition radically (one scene, one headline, two animations) and re-lint.`,
    ``,
    `6. Once lint passes (zero errors — warnings are OK), emit a final message whose LAST line is exactly:`,
    `   \`READY <turnId>\``,
    `   …with the actual turn id substituted. The server parses this sentinel; without it your composition is never published.`,
    ``,
    `## Composition shape — what each turn should LOOK like`,
    ``,
    `Think of a 12-second TikTok recap. Three to five scenes:`,
    `- **Opening title card** (~2s): the headline of what happened. e.g. "added /composer route", "fixed race in tailer", "5 intake modes".`,
    `- **Body scenes** (~3-5s each, 2-3 of them): the load-bearing details. file names, function names, line counts. Use marker callouts (banner-style overlays) sparingly — at most one per composition, for the genuinely surprising thing.`,
    `- **Closing pulse** (~2s): a single closing word, line count, or status. Keep it terse.`,
    ``,
    `Voice (in text content): lowercase, terminal-flavoured, dry-with-a-wink. Same energy as the existing scriptifier prose. Don't repeat the user's prompt verbatim — pivot to what the agent DID.`,
    ``,
    `## Constraints`,
    ``,
    `- Do NOT add audio (no \`<audio>\`, no \`data-audio-src\`). This pipeline is text + motion only.`,
    `- Do NOT add external assets, fonts, or scripts. The composition must be fully self-contained in one HTML file. GSAP via the standard CDN tag (the lint accepts this) is fine; nothing else.`,
    `- Do NOT include \`<script src="..."></script>\` tags pointing at local files. Inline JS only, plus the GSAP CDN.`,
    `- Do NOT touch any directory other than \`<turnId>/\` inside your cwd.`,
    `- Do NOT run \`hyperframes render\` or \`hyperframes preview\` — only \`lint\`. Render is expensive and not needed; preview spawns a server we don't want.`,
    `- Do NOT call any tool other than Bash, Read, Write, Edit, Grep, Glob.`,
    ``,
    `Be concise in your reasoning. The user does not see your assistant text — only the final composition and the READY sentinel matter. Say only what helps you reason; don't narrate.`,
  ].join("\n");
}

function readyTurnFromText(text: string): string | null {
  // Match "READY <turnId>" anywhere in the assistant message — most often it's
  // the last line, but tolerate trailing whitespace / extra prose. turn ids
  // are uuid-like in practice; we accept anything non-whitespace to stay
  // permissive (the server validates the actual turnId against its known set).
  const m = text.match(/\bREADY\s+(\S+)/);
  return m ? m[1]! : null;
}

type SessionLoopHandle = {
  feed: (f: ComposerFeed) => void;
  stop: () => void;
};

function startSessionLoop(
  sessionKey: string,
  rootDir: string,
  model: string,
  perTurnTimeoutMs: number,
  emit: (e: ComposerEvent) => void
): SessionLoopHandle {
  const respawnMs = 5_000;
  const maxConsecutiveFailures = 5;

  // each session gets its own cwd. inside it, the agent creates per-turn
  // subdirs. composerSafeKey() is the canonical one-way transform — same one
  // the URL route uses, so the iframe URL the agent emits resolves back to
  // this exact directory.
  const safeKey = composerSafeKey(sessionKey);
  const cwd = join(rootDir, safeKey);
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });

  const claudePath = findClaudeExecutable();

  const queue: ComposerFeed[] = [];
  let inflight: { feed: ComposerFeed; timer: ReturnType<typeof setTimeout> | null; assistantText: string } | null = null;
  const pendingMsgs: SDKUserMessage[] = [];
  let stopped = false;
  let firstPrompt = true;
  let resolvePending: ((msg: SDKUserMessage | null) => void) | null = null;
  let currentAbort: AbortController | null = null;

  function pushPrompt(content: string) {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      session_id: `cut-the-cake-composer-${safeKey}`,
      parent_tool_use_id: null,
    };
    if (resolvePending) {
      const r = resolvePending;
      resolvePending = null;
      r(msg);
    } else {
      pendingMsgs.push(msg);
    }
  }

  function makeMessageGenerator(): AsyncIterableIterator<SDKUserMessage> {
    return (async function* () {
      while (!stopped) {
        if (pendingMsgs.length > 0) {
          yield pendingMsgs.shift()!;
          continue;
        }
        const msg = await new Promise<SDKUserMessage | null>((resolve) => {
          resolvePending = resolve;
        });
        if (!msg) return;
        yield msg;
      }
    })();
  }

  function startNextIfIdle() {
    if (inflight || queue.length === 0 || stopped) return;
    const feed = queue.shift()!;
    const ts = Date.now();
    emit({ kind: "running", sessionKey, turnId: feed.target.turnId, ts });
    const timer = setTimeout(() => {
      // soft timeout — abort the whole subprocess; lifecycle() will respawn.
      // on abort the inflight settles and we emit error here.
      console.log(`[composer] ${safeKey} ${feed.target.turnId.slice(0, 8)} per-turn timeout (${perTurnTimeoutMs}ms) — aborting`);
      currentAbort?.abort();
    }, perTurnTimeoutMs);
    inflight = { feed, timer, assistantText: "" };
    const body = buildPromptBody(feed);
    const content = firstPrompt ? `${buildSystemIntro()}\n\n---\n\n${body}` : body;
    firstPrompt = false;
    pushPrompt(content);
    console.log(`[composer] ${safeKey} sent turn ${feed.target.turnId.slice(0, 8)} to ${model} (prior=${feed.prior.length})`);
  }

  function settleInflight(reason: "ready" | "error", message?: string) {
    if (!inflight) return;
    const { feed, timer } = inflight;
    if (timer) clearTimeout(timer);
    if (reason === "ready") {
      const relPath = `${feed.target.turnId}/index.html`;
      emit({ kind: "ready", sessionKey, turnId: feed.target.turnId, relPath, ts: Date.now() });
    } else {
      emit({ kind: "error", sessionKey, turnId: feed.target.turnId, message: message ?? "composer failed", ts: Date.now() });
    }
    inflight = null;
    // hand off to next queued turn (if any).
    setImmediate(startNextIfIdle);
  }

  async function runSdkLoopOnce(): Promise<void> {
    pendingMsgs.length = 0;
    firstPrompt = true;
    if (inflight) {
      // a respawn happened mid-flight; the abort below settled the prior one
      // by causing the for-await to throw. nothing to do here — settleInflight
      // was called in the catch.
    }
    const abort = new AbortController();
    currentAbort = abort;
    const gen = makeMessageGenerator();
    try {
      const result = query({
        prompt: gen,
        options: {
          model,
          cwd,
          pathToClaudeCodeExecutable: claudePath,
          disallowedTools: DISALLOWED_TOOLS,
          settingSources: [],
          mcpServers: {},
          strictMcpConfig: true,
          abortController: abort,
        },
      });

      for await (const m of result as AsyncIterable<unknown>) {
        const msg = m as { type?: string; message?: { content?: unknown } };
        if (msg.type !== "assistant") continue;
        const content = msg.message?.content;
        let text = "";
        if (Array.isArray(content)) {
          for (const b of content as Array<{ type?: string; text?: string }>) {
            if (b?.type === "text" && typeof b.text === "string") text += b.text;
          }
        } else if (typeof content === "string") {
          text = content;
        }
        if (!inflight) continue;
        inflight.assistantText += text + "\n";
        // detect lint runs in the agent's running narration. cheap pattern
        // match — the agent sometimes mentions "running lint" or "linting".
        // best-effort attempt indicator; nothing depends on it being precise.
        if (/\b(lint(ing)?|hyperframes lint)\b/i.test(text)) {
          emit({
            kind: "linting",
            sessionKey,
            turnId: inflight.feed.target.turnId,
            attempt: 1,
            ts: Date.now(),
          });
        }
        const turnId = readyTurnFromText(text);
        if (turnId) {
          if (turnId !== inflight.feed.target.turnId) {
            console.log(
              `[composer] ${safeKey} READY mismatch — got ${turnId}, expected ${inflight.feed.target.turnId}; accepting anyway`
            );
          }
          // verify the file exists before declaring ready.
          const expectedPath = join(cwd, inflight.feed.target.turnId, "index.html");
          if (!existsSync(expectedPath)) {
            settleInflight("error", `READY emitted but ${expectedPath} not on disk`);
          } else {
            settleInflight("ready");
          }
        }
      }
      // stream ended — if inflight was never settled, treat as error.
      if (inflight) {
        settleInflight("error", "agent ended turn without emitting READY");
      }
    } finally {
      if (resolvePending) {
        const r = resolvePending;
        resolvePending = null;
        r(null);
      }
      currentAbort = null;
    }
  }

  async function lifecycle(): Promise<void> {
    let consecutiveFailures = 0;
    let attempts = 0;
    while (!stopped) {
      attempts++;
      if (attempts > 1) {
        console.log(`[composer] ${safeKey} respawning sdk subprocess (attempt ${attempts})`);
      }
      try {
        await runSdkLoopOnce();
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[composer] ${safeKey} sdk error (consecutive failures ${consecutiveFailures}/${maxConsecutiveFailures}): ${msg}`
        );
        if (inflight) settleInflight("error", `sdk error: ${msg}`);
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(`[composer] ${safeKey} giving up after ${consecutiveFailures} consecutive failures`);
          return;
        }
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, respawnMs));
    }
  }

  void lifecycle();

  return {
    feed(f) {
      queue.push(f);
      startNextIfIdle();
    },
    stop() {
      stopped = true;
      if (inflight) settleInflight("error", "composer stopped");
      currentAbort?.abort();
      if (resolvePending) {
        const r = resolvePending;
        resolvePending = null;
        r(null);
      }
    },
  };
}

export function startComposer(opts: ComposerOptions): {
  feed: (sessionKey: string, feed: ComposerFeed) => void;
  rootDirFor: (sessionKey: string) => string;
  stop: () => void;
} {
  const model = opts.model ?? "claude-sonnet-4-6";
  const rootDir = opts.rootDir ?? COMPOSER_DIR_DEFAULT;
  const perTurnTimeoutMs = opts.perTurnTimeoutMs ?? DEFAULT_PER_TURN_TIMEOUT_MS;
  if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true });

  const loops = new Map<string, SessionLoopHandle>();

  function loopFor(sessionKey: string): SessionLoopHandle {
    let handle = loops.get(sessionKey);
    if (handle) return handle;
    handle = startSessionLoop(sessionKey, rootDir, model, perTurnTimeoutMs, (e) => {
      opts.onEvent?.(e);
    });
    loops.set(sessionKey, handle);
    console.log(`[composer] spawned subprocess for sessionKey=${sessionKey}`);
    return handle;
  }

  return {
    feed(sessionKey, feed) {
      loopFor(sessionKey).feed(feed);
    },
    rootDirFor(sessionKey) {
      return join(rootDir, composerSafeKey(sessionKey));
    },
    stop() {
      for (const [, h] of loops) h.stop();
      loops.clear();
    },
  };
}
