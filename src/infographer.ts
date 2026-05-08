// infographer subprocess: closed turn + scripted beats → time-anchored pills.
// these surface alongside the karaoke captions in the tiktok-style player as
// info-graphics: file paths, tool counts, decisions, warnings, etc. one pill
// is on screen for the duration of one or more beats — anchored by beat index
// rather than seconds, so tts variation doesn't desync them.
//
// modeled directly on src/scriptifier.ts (single-subprocess simplification — no
// style/vocab pool, just one sandboxed sonnet loop). same FIFO inflight tracking,
// respawn lifecycle, all tools disabled, sandboxed cwd.
//
// the feed is sequenced AFTER scriptifier emits beats (server.ts wiring) so the
// infographer can reference real beat indices when picking anchor points.

import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnFeed } from "./observer";
import type { MetaEvent } from "./jsonl";
import type { ScriptBeat } from "./scriptifier";

export type PillKind =
  | "metric"    // numbers — token counts, line diffs, tool counts
  | "file"      // a file or path callout
  | "tool"      // a tool the agent reached for
  | "decision"  // an architectural choice the agent made
  | "warning"   // footgun / caution flag
  | "note";     // small contextual aside (default fallback)

export type Pill = {
  text: string;
  kind: PillKind;
  startBeat: number;
  endBeat: number;
  side?: "left" | "right";
};

export type PillPlan = {
  sessionKey: string;
  turnId: string;
  pills: Pill[];
  closedTs: number;
};

export type InfographerOptions = {
  model?: string;
  batchMs?: number;
  onPlan?: (p: PillPlan) => void;
};

const DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
  "AskUserQuestion",
  "TodoWrite",
];

const INFOGRAPHER_DIR = join(homedir(), ".cut-the-cake", "infographer");

const VALID_KINDS = new Set<PillKind>(["metric", "file", "tool", "decision", "warning", "note"]);
const VALID_SIDES = new Set<"left" | "right">(["left", "right"]);

const MAX_PILLS_PER_PLAN = 8;
const MAX_PILL_TEXT_LEN = 60;
const MAX_PLANS_PER_BATCH = 10;
const MAX_EVENTS_IN_PROMPT = 40;
const MAX_PROMPT_BODY_LEN = 12000;
const BLOCK_CLIP = 1500;

const INFOGRAPHER_INTRO = `You are the infographer for cut-the-cake. Given a closed turn from a Claude Code (or codex) session — the same one another worker has just turned into a karaoke script — you produce a small set of "pills": short info-graphic chips that float alongside the captions while the karaoke plays.

Each pill is one short label (2-6 words) that surfaces something concrete about the turn: a file path, a tool name, a count, a decision, a warning. Pills are not full sentences — they read like badges on a sports broadcast: "src/auth.ts", "+34 / -12 lines", "ran rg 5×", "picked sonnet over opus".

You will see the beat list the karaoke is reading. Each beat has an index (0-based). For every pill, pick a startBeat and an endBeat — the pill enters when that beat becomes current and stays until endBeat finishes. Anchor pills to the moment the caption is talking about that thing. A pill can span 1-4 beats; default to 2.

Pill kinds (pick the closest one):
- metric — counts, token totals, line diffs, durations
- file — a specific file or path
- tool — a tool the agent reached for (Bash/Edit/Read/etc) or the action verb
- decision — an architectural choice or branch the agent picked
- warning — a footgun, "this could break X", risky operation
- note — small clarifying context, fallback when nothing else fits

Budget: 3-6 pills per turn. Often closer to 3. Don't make pills out of every beat — only the things a viewer would want to glance at on their own.

Side: optional ("left" or "right"). Use to hint layout — e.g. all metrics on the right, all files on the left. If unsure, omit (the renderer auto-balances).

Voice: lowercase, terse, concrete. Numbers are fine. No greetings, no hedging.

Reply with ONLY a JSON object. No prose, no markdown fences. Schema:
{"plans": [{"turnId": "<from input>", "pills": [{"text": "...", "kind": "metric|file|tool|decision|warning|note", "startBeat": 0, "endBeat": 1, "side": "left|right"|null}, ...]}, ...]}

The plans array is in the same order as the input batch (one entry per turn).`;

const TRAILING = `Reply with the JSON object: {"plans": [...one per turn...]}. No other text.`;

function findClaudeExecutable(): string {
  try {
    const p = execSync("which claude", { encoding: "utf8" }).trim().split("\n")[0]?.trim();
    if (p) return p;
  } catch {
    // fall through
  }
  throw new Error("`claude` not found on PATH — install Claude Code or set its path");
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

// compact transcript view, similar to scriptifier but with a smaller event cap
// (the infographer needs a sense of the turn, not the full karaoke material).
function formatTurnEvents(events: MetaEvent[], turnId?: string): string[] {
  let working = events;
  if (events.length > MAX_EVENTS_IN_PROMPT) {
    const half = Math.floor(MAX_EVENTS_IN_PROMPT / 2);
    const head = events.slice(0, half);
    const tail = events.slice(events.length - half);
    const dropped = events.length - head.length - tail.length;
    console.log(
      `[infographer] turn events sampled (turnId=${turnId ?? "?"}, was ${events.length}, kept ${head.length}+${tail.length}, dropped ${dropped} from middle)`
    );
    working = [...head, ...tail];
  }
  const out: string[] = [];
  let injectedSeparator = false;
  const headLen = events.length > MAX_EVENTS_IN_PROMPT ? Math.floor(MAX_EVENTS_IN_PROMPT / 2) : working.length;
  for (let i = 0; i < working.length; i++) {
    if (events.length > MAX_EVENTS_IN_PROMPT && i === headLen && !injectedSeparator) {
      out.push(`... (${events.length - MAX_EVENTS_IN_PROMPT} events omitted) ...`);
      injectedSeparator = true;
    }
    const ev = working[i]!;
    if (ev.kind === "user_message") {
      out.push(`USER: ${clip(ev.text, BLOCK_CLIP)}`);
    } else if (ev.kind === "assistant_text") {
      out.push(`ASSISTANT: ${clip(ev.text, BLOCK_CLIP)}`);
    } else if (ev.kind === "tool_use") {
      const lines = [];
      if (typeof ev.linesAdded === "number") lines.push(`+${ev.linesAdded}`);
      if (typeof ev.linesRemoved === "number") lines.push(`-${ev.linesRemoved}`);
      const tail = lines.length ? ` (${lines.join("/")} lines)` : "";
      out.push(`TOOL ${ev.tool}: ${clip(ev.summary, BLOCK_CLIP)}${tail}`);
    } else if (ev.kind === "tool_result") {
      const tag = ev.isError ? "TOOL_RESULT (error)" : "TOOL_RESULT";
      out.push(`${tag}: ${clip(ev.summary, BLOCK_CLIP)}`);
    }
  }
  return out;
}

type InfographerJob = {
  feed: TurnFeed;
  beats: ScriptBeat[];
};

function formatBatch(batch: InfographerJob[]): string {
  const lines: string[] = [`New batch of ${batch.length} closed turn(s) with their karaoke beats:`];
  for (const job of batch) {
    const t = job.feed;
    const sName = t.sessionInfo.slug.replace(/^-+/, "").split("-").pop() ?? "?";
    lines.push("");
    lines.push("---");
    lines.push(`turnId: ${t.turnId}`);
    lines.push(`session: ${sName} (${t.sessionInfo.source})`);
    lines.push(
      `metrics: ${t.outputTokens} tok · ${t.toolUseCount} tools · +${t.linesAdded}/-${t.linesRemoved} lines`
    );
    lines.push("---");
    lines.push("Karaoke beats (anchor pills to these by index):");
    for (let i = 0; i < job.beats.length; i++) {
      const b = job.beats[i]!;
      const markerTag = b.marker ? ` [${b.marker}]` : "";
      lines.push(`  ${i}: ${clip(b.text, 200)}${markerTag}`);
    }
    lines.push("---");
    lines.push("Source events for context:");
    if (t.events && t.events.length) {
      for (const block of formatTurnEvents(t.events, t.turnId)) lines.push(block);
    } else {
      if (t.userPrompt) lines.push(`USER: ${t.userPrompt}`);
      if (t.assistantExcerpt) lines.push(`ASSISTANT: ${t.assistantExcerpt}`);
    }
  }
  lines.push("");
  lines.push(TRAILING);
  const body = lines.join("\n");
  if (body.length > MAX_PROMPT_BODY_LEN) {
    const half = Math.floor(MAX_PROMPT_BODY_LEN / 2) - 32;
    const head = body.slice(0, half);
    const tail = body.slice(body.length - half);
    const dropped = body.length - head.length - tail.length;
    console.log(
      `[infographer] prompt body truncated (was ${body.length} chars, now ~${MAX_PROMPT_BODY_LEN}, dropped ${dropped} from middle)`
    );
    return `${head}\n... (${dropped} chars omitted) ...\n${tail}`;
  }
  return body;
}

type ParsedPlan = { turnId: string; pills: Pill[] };

function parsePillsResponse(text: string, beatCounts: Map<string, number>): ParsedPlan[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return null;
  }
  let raw: unknown[];
  if (Array.isArray(parsed)) {
    raw = parsed;
  } else if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    raw = Array.isArray(o.plans) ? o.plans : [];
  } else {
    return null;
  }
  const out: ParsedPlan[] = [];
  const seenTurnIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const turnId = typeof o.turnId === "string" ? o.turnId : null;
    if (!turnId) continue;
    if (seenTurnIds.has(turnId)) {
      console.log(`[infographer] dropped duplicate plan for turnId=${turnId} (first-wins dedupe)`);
      continue;
    }
    if (!Array.isArray(o.pills)) continue;
    const beatCount = beatCounts.get(turnId) ?? 0;
    if (beatCount <= 0) continue;
    const rawPills = o.pills;
    let pillsToProcess = rawPills;
    if (rawPills.length > MAX_PILLS_PER_PLAN) {
      console.log(
        `[infographer] plan truncated to ${MAX_PILLS_PER_PLAN} pills (turnId=${turnId}, was ${rawPills.length})`
      );
      pillsToProcess = rawPills.slice(0, MAX_PILLS_PER_PLAN);
    }
    const pills: Pill[] = [];
    for (const p of pillsToProcess) {
      if (!p || typeof p !== "object") continue;
      const po = p as Record<string, unknown>;
      let text = typeof po.text === "string" ? po.text.trim() : "";
      if (!text) continue;
      if (text.length > MAX_PILL_TEXT_LEN) {
        text = `${text.slice(0, MAX_PILL_TEXT_LEN)}…`;
      }
      const rawKind = typeof po.kind === "string" ? po.kind.toLowerCase() : "";
      const kind: PillKind = VALID_KINDS.has(rawKind as PillKind) ? (rawKind as PillKind) : "note";
      let startBeat = typeof po.startBeat === "number" ? Math.floor(po.startBeat) : 0;
      let endBeat = typeof po.endBeat === "number" ? Math.floor(po.endBeat) : startBeat + 1;
      // clamp to valid beat range
      startBeat = Math.max(0, Math.min(beatCount - 1, startBeat));
      endBeat = Math.max(startBeat, Math.min(beatCount - 1, endBeat));
      const pill: Pill = { text, kind, startBeat, endBeat };
      const rawSide = typeof po.side === "string" ? po.side.toLowerCase() : "";
      if (VALID_SIDES.has(rawSide as "left" | "right")) {
        pill.side = rawSide as "left" | "right";
      }
      pills.push(pill);
    }
    if (pills.length) {
      out.push({ turnId, pills });
      seenTurnIds.add(turnId);
      if (out.length >= MAX_PLANS_PER_BATCH) {
        if (raw.length > MAX_PLANS_PER_BATCH) {
          console.log(
            `[infographer] batch truncated to ${MAX_PLANS_PER_BATCH} plans (was ${raw.length})`
          );
        }
        break;
      }
    }
  }
  return out;
}

export function startInfographer(opts: InfographerOptions): {
  feed: (t: TurnFeed, beats: ScriptBeat[]) => void;
  stop: () => Promise<void>;
} {
  const model = opts.model ?? "claude-sonnet-4-6";
  const batchMs = opts.batchMs ?? 2_000;
  const respawnMs = 5_000;
  const maxConsecutiveFailures = 5;

  if (!existsSync(INFOGRAPHER_DIR)) mkdirSync(INFOGRAPHER_DIR, { recursive: true });
  const claudePath = findClaudeExecutable();

  const queue: InfographerJob[] = [];
  const inflightBatches: InfographerJob[][] = [];
  const pendingMsgs: SDKUserMessage[] = [];
  let stopped = false;
  let firstPrompt = true;
  let resolvePending: ((msg: SDKUserMessage | null) => void) | null = null;
  let currentAbort: AbortController | null = null;
  // resolves when the lifecycle while-loop has exited. server awaits this on
  // shutdown (with a small race-against-timeout so a wedged sdk subprocess
  // can't block the whole process forever).
  let lifecycleDone: () => void = () => {};
  const lifecyclePromise = new Promise<void>((resolve) => {
    lifecycleDone = resolve;
  });

  function pushPrompt(content: string) {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      session_id: "cut-the-cake-infographer",
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

  const tick = setInterval(() => {
    if (stopped) return;
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    inflightBatches.push(batch);
    const body = formatBatch(batch);
    const content = firstPrompt ? `${INFOGRAPHER_INTRO}\n\n---\n\n${body}` : body;
    firstPrompt = false;
    pushPrompt(content);
    console.log(`[infographer] sent batch of ${batch.length} turn(s) to ${model}`);
  }, batchMs);

  async function runSdkLoopOnce(): Promise<void> {
    // requeue any inflight batches (work that was sent but not yet acknowledged
    // when the loop crashed) at the FRONT of queue so respawn retries them
    // instead of silently dropping them.
    if (inflightBatches.length > 0) {
      const requeue = inflightBatches.splice(0, inflightBatches.length).flat();
      if (requeue.length > 0) {
        queue.unshift(...requeue);
        console.log(`[infographer] requeued ${requeue.length} inflight job(s) for retry after respawn`);
      }
    }
    pendingMsgs.length = 0;
    firstPrompt = true;
    const abort = new AbortController();
    currentAbort = abort;
    const gen = makeMessageGenerator();
    try {
      const result = query({
        prompt: gen,
        options: {
          model,
          cwd: INFOGRAPHER_DIR,
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
        if (!text.trim()) continue;
        const batch = inflightBatches.shift();
        if (!batch) {
          console.log(`[infographer] response with no inflight batch — dropping`);
          continue;
        }
        const beatCounts = new Map<string, number>();
        for (const job of batch) beatCounts.set(job.feed.turnId, job.beats.length);
        const parsed = parsePillsResponse(text, beatCounts);
        if (!parsed) {
          console.log(`[infographer] could not parse: ${clip(text, 200)}`);
          continue;
        }
        const byTurn = new Map<string, InfographerJob>();
        for (const job of batch) byTurn.set(job.feed.turnId, job);
        for (const p of parsed) {
          const job = byTurn.get(p.turnId);
          if (!job) {
            console.log(`[infographer] unknown turnId in response: ${p.turnId}`);
            continue;
          }
          const plan: PillPlan = {
            sessionKey: job.feed.sessionKey,
            turnId: p.turnId,
            pills: p.pills,
            closedTs: job.feed.closedTs,
          };
          opts.onPlan?.(plan);
          const kindCounts = p.pills.reduce<Record<string, number>>((acc, x) => {
            acc[x.kind] = (acc[x.kind] ?? 0) + 1;
            return acc;
          }, {});
          const kindStr = Object.entries(kindCounts)
            .map(([k, n]) => `${k}=${n}`)
            .join(" ");
          console.log(
            `[infographer] ${p.turnId.slice(0, 8)} · ${p.pills.length} pills · ${kindStr}`
          );
        }
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
    try {
      while (!stopped) {
        attempts++;
        if (attempts > 1) {
          console.log(`[infographer] respawning sdk subprocess (attempt ${attempts})`);
        }
        try {
          await runSdkLoopOnce();
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[infographer] sdk error (consecutive failures ${consecutiveFailures}/${maxConsecutiveFailures}): ${msg}`
          );
          if (consecutiveFailures >= maxConsecutiveFailures) {
            console.error(`[infographer] giving up after ${consecutiveFailures} consecutive failures`);
            return;
          }
        }
        if (stopped) break;
        await new Promise((r) => setTimeout(r, respawnMs));
      }
    } finally {
      lifecycleDone();
    }
  }

  void lifecycle();

  return {
    feed(t, beats) {
      if (stopped) return;
      if (!Array.isArray(beats) || beats.length === 0) return;
      queue.push({ feed: t, beats });
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      // drain anything still queued so a late tick can't fire after stop().
      queue.length = 0;
      if (resolvePending) {
        const r = resolvePending;
        resolvePending = null;
        r(null);
      }
      currentAbort?.abort();
      // race against a 400ms ceiling so a wedged sdk subprocess can't block
      // server shutdown indefinitely. mirrors the existing `setTimeout(exit, 500)`
      // shape in src/server.ts — together they cap shutdown at ~900ms worst-case.
      await Promise.race([
        lifecyclePromise,
        new Promise<void>((r) => setTimeout(r, 400)),
      ]);
    },
  };
}
