// scriptifier subprocess: closed turn → karaoke-style script (beats + markers).
// modeled directly on src/observer.ts — same long-lived sdk subprocess pattern,
// FIFO inflight tracking, respawn lifecycle, all tools disabled, sandboxed cwd.
//
// the only real differences vs observer:
//   - shorter batch interval (~2s ceiling vs 30s) — we want the video pane
//     to populate fast, not on a half-minute heartbeat.
//   - prompt body uses the FULL event list (assistant text + tool calls +
//     tool results), not just the user-prompt + assistant excerpt; the
//     scripter needs the full transcript to know what actually happened.
//   - cwd lives under the new ~/.cut-the-cake/ tree.

import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnFeed } from "./observer";
import type { MetaEvent } from "./jsonl";

export type ScriptMarker = "INSIGHT" | "BE_CAREFUL" | "STEP" | "NOTE";

export type ScriptBeat = {
  text: string;
  marker?: ScriptMarker;
  emphasis?: string[];
};

export type ScriptResult = {
  sessionKey: string;
  turnId: string;
  beats: ScriptBeat[];
  closedTs: number;
};

export type ScriptifierOptions = {
  model?: string;
  batchMs?: number;
  onScript?: (s: ScriptResult) => void;
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

const SCRIPTIFIER_DIR = join(homedir(), ".cut-the-cake", "scriptifier");

const SCRIPTIFIER_INTRO = `You are the scriptifier for cut-the-cake. When given a closed turn from a Claude Code (or codex) session, you produce a short karaoke-style script that captures what happened, in a way that's faster to listen to than reading the raw output.

Each turn becomes 6-15 short beats. Each beat is one phrase or sentence (3-12 words). The full script reads aloud in 25-60 seconds. Voice: lowercase prose, terminal flavor, dry-with-a-wink — you're a friendly explainer, not a press release. Don't repeat the user's question verbatim; just pivot to what the agent did.

Markers (use sparingly — at most 3 markers per script, often 0-1):
- INSIGHT — surprising or load-bearing finding the user should pause on
- BE_CAREFUL — footgun, risky operation, or "this could break X"
- STEP — explicit numbered procedure (1 of N, etc.)
- NOTE — small aside or clarification

Emphasis: 0-2 words per beat that should pop visually (file names, key verbs, numbers, surprising terms). Don't over-emphasize.

Reply with ONLY the JSON object: {"scripts":[{"turnId","beats":[{"text","marker","emphasis"}]}]}. No prose, no markdown fences.`;

const TRAILING = `Reply with a JSON object: {"scripts": [...one per turn...]}. No other text.`;

// per-block clip ceiling — keeps a single chatty assistant block or huge tool
// result from blowing up the prompt. 2k chars is roughly 500 tokens; with 6-12
// blocks per turn we stay well under any sane context window.
const BLOCK_CLIP = 2000;

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

// turn the event list into a compact transcript. order is preserved so the
// model sees the natural assistant ↔ tool ↔ tool_result interleave.
function formatTurnEvents(events: MetaEvent[]): string[] {
  const out: string[] = [];
  for (const ev of events) {
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
    // stop events have no payload worth scripting — drop.
  }
  return out;
}

function formatBatch(batch: TurnFeed[], trailing: string): string {
  const lines: string[] = [`New batch of ${batch.length} closed turn(s):`];
  for (const t of batch) {
    const sName = t.sessionInfo.slug.replace(/^-+/, "").split("-").pop() ?? "?";
    lines.push("");
    lines.push("---");
    lines.push(`turnId: ${t.turnId}`);
    lines.push(`session: ${sName} (${t.sessionInfo.source})`);
    lines.push(
      `metrics: ${t.outputTokens} tok · ${t.toolUseCount} tools · +${t.linesAdded}/-${t.linesRemoved} lines`
    );
    lines.push("---");
    if (t.events && t.events.length) {
      for (const block of formatTurnEvents(t.events)) lines.push(block);
    } else {
      // observer-style fallback if events somehow weren't attached.
      if (t.userPrompt) lines.push(`USER: ${t.userPrompt}`);
      if (t.assistantExcerpt) lines.push(`ASSISTANT: ${t.assistantExcerpt}`);
    }
  }
  lines.push("");
  lines.push(trailing);
  return lines.join("\n");
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

const VALID_MARKERS = new Set<ScriptMarker>(["INSIGHT", "BE_CAREFUL", "STEP", "NOTE"]);

type ParsedScript = { turnId: string; beats: ScriptBeat[] };

function parseScriptsResponse(text: string): ParsedScript[] | null {
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
    raw = Array.isArray(o.scripts) ? o.scripts : [];
  } else {
    return null;
  }
  const out: ParsedScript[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const turnId = typeof o.turnId === "string" ? o.turnId : null;
    if (!turnId) continue;
    if (!Array.isArray(o.beats)) continue;
    const beats: ScriptBeat[] = [];
    for (const b of o.beats) {
      if (!b || typeof b !== "object") continue;
      const bo = b as Record<string, unknown>;
      const beatText = typeof bo.text === "string" ? bo.text.trim() : "";
      if (!beatText) continue;
      const beat: ScriptBeat = { text: beatText };
      if (typeof bo.marker === "string" && VALID_MARKERS.has(bo.marker as ScriptMarker)) {
        beat.marker = bo.marker as ScriptMarker;
      }
      if (Array.isArray(bo.emphasis)) {
        const em = bo.emphasis.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (em.length) beat.emphasis = em;
      }
      beats.push(beat);
    }
    if (beats.length) out.push({ turnId, beats });
  }
  return out;
}

type SdkLoopOptions = {
  model: string;
  cwd: string;
  label: string;
  batchMs: number;
  systemIntro: string;
  formatTrailing: string;
  sdkSessionId: string;
  onResponse: (text: string, batch: TurnFeed[]) => void;
};

type SdkLoopHandle = {
  feed: (t: TurnFeed) => void;
  stop: () => void;
};

// copy of observer's startSdkLoop. kept inline rather than extracted to a
// shared module for simplicity — the helper is small enough that two callsites
// don't justify a third file. if a third subprocess shows up, lift it.
function startSdkLoop(opts: SdkLoopOptions): SdkLoopHandle {
  const respawnMs = 5_000;
  const maxConsecutiveFailures = 5;

  if (!existsSync(opts.cwd)) mkdirSync(opts.cwd, { recursive: true });
  const claudePath = findClaudeExecutable();

  const queue: TurnFeed[] = [];
  const inflightBatches: TurnFeed[][] = [];
  const pendingMsgs: SDKUserMessage[] = [];
  let stopped = false;
  let firstPrompt = true;
  let resolvePending: ((msg: SDKUserMessage | null) => void) | null = null;
  let currentAbort: AbortController | null = null;

  function pushPrompt(content: string) {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      session_id: opts.sdkSessionId,
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
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    inflightBatches.push(batch);
    const body = formatBatch(batch, opts.formatTrailing);
    const content = firstPrompt ? `${opts.systemIntro}\n\n---\n\n${body}` : body;
    firstPrompt = false;
    pushPrompt(content);
    console.log(`[${opts.label}] sent batch of ${batch.length} turn(s) to ${opts.model}`);
  }, opts.batchMs);

  async function runSdkLoopOnce(): Promise<void> {
    pendingMsgs.length = 0;
    inflightBatches.length = 0;
    firstPrompt = true;
    const abort = new AbortController();
    currentAbort = abort;
    const gen = makeMessageGenerator();
    try {
      const result = query({
        prompt: gen,
        options: {
          model: opts.model,
          cwd: opts.cwd,
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
          console.log(`[${opts.label}] response with no inflight batch — dropping`);
          continue;
        }
        opts.onResponse(text, batch);
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
        console.log(`[${opts.label}] respawning sdk subprocess (attempt ${attempts})`);
      }
      try {
        await runSdkLoopOnce();
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[${opts.label}] sdk error (consecutive failures ${consecutiveFailures}/${maxConsecutiveFailures}): ${msg}`
        );
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(`[${opts.label}] giving up after ${consecutiveFailures} consecutive failures`);
          return;
        }
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, respawnMs));
    }
  }

  void lifecycle();

  return {
    feed(t) {
      queue.push(t);
    },
    stop() {
      stopped = true;
      clearInterval(tick);
      if (resolvePending) {
        const r = resolvePending;
        resolvePending = null;
        r(null);
      }
      currentAbort?.abort();
    },
  };
}

export function startScriptifier(opts: ScriptifierOptions): {
  feed: (t: TurnFeed) => void;
  stop: () => void;
} {
  const model = opts.model ?? "claude-sonnet-4-6";
  const batchMs = opts.batchMs ?? 2_000;

  const loop = startSdkLoop({
    model,
    cwd: SCRIPTIFIER_DIR,
    label: "scriptifier",
    batchMs,
    systemIntro: SCRIPTIFIER_INTRO,
    formatTrailing: TRAILING,
    sdkSessionId: "cut-the-cake-scriptifier",
    onResponse(text, batch) {
      const parsed = parseScriptsResponse(text);
      if (!parsed) {
        console.log(`[scriptifier] could not parse: ${clip(text, 200)}`);
        return;
      }
      const byTurn = new Map<string, TurnFeed>();
      for (const t of batch) byTurn.set(t.turnId, t);
      for (const s of parsed) {
        const feed = byTurn.get(s.turnId);
        if (!feed) {
          console.log(`[scriptifier] unknown turnId in response: ${s.turnId}`);
          continue;
        }
        const result: ScriptResult = {
          sessionKey: feed.sessionKey,
          turnId: s.turnId,
          beats: s.beats,
          closedTs: feed.closedTs,
        };
        opts.onScript?.(result);
        const markerCount = s.beats.filter((b) => b.marker).length;
        console.log(
          `[scriptifier] ${s.turnId.slice(0, 8)} · ${s.beats.length} beats · ${markerCount} markers`
        );
      }
    },
  });

  return {
    feed(t) {
      loop.feed(t);
    },
    stop() {
      loop.stop();
    },
  };
}
