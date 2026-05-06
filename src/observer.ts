// two long-lived sdk subprocesses:
//   - decisions: sonnet-4-6, returns per-turn {open, insight, tags, prefill}
//   - namer:     haiku-4-5,  returns per-session {sessionName}
// each keeps prior-batch context so it can adapt as activity shifts.
//
// pattern: claude-mem ClaudeProvider — query() from @anthropic-ai/claude-agent-sdk,
// async-generator prompt feed, sandboxed cwd, all tools disallowed.

import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionInfo } from "./tailer";
import type { Turn } from "./turns";
import type { MetaEvent } from "./jsonl";

export type TurnFeed = {
  sessionKey: string;
  sessionInfo: SessionInfo;
  turnId: string;
  closedTs: number;
  outputTokens: number;
  outputChars: number;
  toolUseCount: number;
  linesAdded: number;
  linesRemoved: number;
  userPrompt: string;
  assistantExcerpt: string;
};

export type GateDecision = {
  sessionKey: string;
  turnId: string;
  open: boolean;
  insight?: string;
  tags?: string[];
  prefill?: string;
};

export type SessionNameUpdate = {
  sessionKey: string;
  name: string;
};

export type ObserverOptions = {
  /** model for the per-turn decisions subprocess (sonnet by default). */
  decisionsModel?: string;
  /** model for the session-naming subprocess (haiku by default). */
  namerModel?: string;
  batchMs?: number;
  onDecision?: (d: GateDecision) => void;
  onName?: (s: SessionNameUpdate) => void;
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

// observer cwd kept under the legacy ~/.chunk-to-chat/ dir for now (cosmetic
// rename in resume queue). namer is fresh, so it lives under the new ~/.cut-the-cake/.
const DECISIONS_DIR = join(homedir(), ".chunk-to-chat", "observer");
const NAMER_DIR = join(homedir(), ".cut-the-cake", "namer");

const DECISIONS_INTRO = `You are the observer for cut-the-cake, a tool that watches Claude Code sessions and surfaces moments worth user review.

Your only job: when shown a batch of recently-closed turns, decide for each whether to open a thread (alert the user) and, if so, produce a single-sentence insight.

Initial heuristics — open a thread when ANY of these is true (these are starting defaults; you will adapt as you see more activity):
- output > 1500 tokens
- >5 tool calls in one turn
- >100 lines added or removed in one turn
- signs of trouble (third edit on the same file, errored tool result on a code-touching tool, repeated failed tests, etc.)

The insight is one short sentence (max 14 words) describing what's worth attention. Examples:
- "Third edit pass on src/auth.ts — may be stuck on the same problem."
- "Heavy refactor across 8 files; review for unrelated changes."
- "Errored Edit followed by another Edit attempt; original approach may be wrong."
Avoid bland summaries ("Made some changes to the code"). Be concrete.

For every turn you flag open=true, also draft a "prefill": a one-sentence message the user can edit and send to the original agent to break that turn's output into a back-and-forth. Constraints:
- ≤14 words
- terse, second-person to the agent (not to the user)
- identify the multi-piece structure in the agent's output (commits, files, list items, decisions, edit attempts, etc.)
- pattern: name what to walk through + "one at a time" + ask for the user's response after each
- use phrases like "wait for my reply", "pause for my take", "ask me on each before moving on" — NOT "go or stop"
- no greeting, no fluff
For open=false turns, prefill must be null.

You see prior batches in your context; use that memory to compare to earlier activity in the same session.

Reply with ONLY a JSON object. No prose, no markdown fences. Schema:
{"decisions": [{"turnId": "<from input>", "open": true|false, "insight": "..." | null, "tags": ["short-tag", ...], "prefill": "..." | null}, ...]}

The decisions array is in the same order as the input batch (one entry per turn).

Tags are short kebab-case labels you invent; we will use them later to learn your patterns. Examples: "loop-suspected", "scope-creep", "test-failures", "style-rewrite".`;

const NAMER_INTRO = `You are the session namer for cut-the-cake, a tool that watches Claude Code sessions.

Your only job: for each distinct session that appears in a batch of recently-closed turns, produce a short rolling display name.

sessionName constraints:
- 2-3 words, lowercase, no punctuation (e.g. "auth migration", "renderer redesign", "polish queue", "scrape parser")
- describe what the agent is working on RIGHT NOW, not the project's directory name
- update as the focus shifts — if the agent pivots from auth to logging mid-session, name with the current focus
- ≤20 characters total

You see prior batches in your context; use that memory to keep names stable when the focus is unchanged, and to update when the focus has clearly shifted. If you've only seen one turn for a session this run, omit it from the response.

Reply with ONLY a JSON object. No prose, no markdown fences. Schema:
{"names": [{"sessionKey": "<from input>", "sessionName": "..."}, ...]}

The names array contains one entry per distinct session in the input that you can confidently name.`;

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

export function buildTurnFeed(
  sessionKey: string,
  sessionInfo: SessionInfo,
  turn: Turn
): TurnFeed {
  const userPrompt = turn.userPromptText ?? "";
  const assistantParts: string[] = [];
  for (const ev of turn.events) {
    if (ev.kind === "assistant_text") assistantParts.push(ev.text);
  }
  const assistantText = assistantParts.join("\n\n");
  return {
    sessionKey,
    sessionInfo,
    turnId: turn.id,
    closedTs: turn.endTs,
    outputTokens: turn.outputTokens,
    outputChars: turn.outputChars,
    toolUseCount: turn.toolUseCount,
    linesAdded: turn.linesAdded,
    linesRemoved: turn.linesRemoved,
    userPrompt: clip(userPrompt, 800),
    assistantExcerpt: clip(assistantText, 600),
  };
}

function formatBatch(batch: TurnFeed[], trailing: string): string {
  const lines: string[] = [`New batch of ${batch.length} closed turn(s):`];
  for (const t of batch) {
    const sName = t.sessionInfo.slug.replace(/^-+/, "").split("-").pop() ?? "?";
    lines.push("");
    lines.push(`---`);
    lines.push(`turnId: ${t.turnId}`);
    lines.push(`sessionKey: ${t.sessionKey}`);
    lines.push(`session: ${sName} (${t.sessionInfo.source})`);
    lines.push(
      `metrics: ${t.outputTokens} tok · ${t.outputChars} chars · ${t.toolUseCount} tools · +${t.linesAdded}/-${t.linesRemoved} lines`
    );
    if (t.userPrompt) lines.push(`user: ${t.userPrompt}`);
    if (t.assistantExcerpt) lines.push(`assistant: ${t.assistantExcerpt}`);
  }
  lines.push("");
  lines.push(trailing);
  return lines.join("\n");
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function parseDecisionsResponse(text: string): Array<Omit<GateDecision, "sessionKey">> | null {
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
    raw = Array.isArray(o.decisions) ? o.decisions : [];
  } else {
    return null;
  }
  const out: Array<Omit<GateDecision, "sessionKey">> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const turnId = typeof o.turnId === "string" ? o.turnId : null;
    if (!turnId) continue;
    const open = o.open === true;
    const insight =
      typeof o.insight === "string" && o.insight.trim().length > 0 ? o.insight.trim() : undefined;
    const tags = Array.isArray(o.tags)
      ? (o.tags.filter((t) => typeof t === "string") as string[])
      : undefined;
    const prefill =
      typeof o.prefill === "string" && o.prefill.trim().length > 0 ? o.prefill.trim() : undefined;
    out.push({
      turnId,
      open,
      ...(insight ? { insight } : {}),
      ...(tags && tags.length ? { tags } : {}),
      ...(prefill ? { prefill } : {}),
    });
  }
  return out;
}

function parseNamesResponse(text: string): SessionNameUpdate[] | null {
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
    raw = Array.isArray(o.names) ? o.names : [];
  } else {
    return null;
  }
  const out: SessionNameUpdate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const sessionKey = typeof o.sessionKey === "string" ? o.sessionKey : null;
    const name =
      typeof o.sessionName === "string" && o.sessionName.trim().length > 0
        ? o.sessionName.trim().slice(0, 24)
        : null;
    if (!sessionKey || !name) continue;
    out.push({ sessionKey, name });
  }
  return out;
}

type SdkLoopOptions = {
  model: string;
  cwd: string;
  label: string;
  batchMs: number;
  systemIntro: string;
  /** built once per tick; trailing line tells the model what shape to reply with. */
  formatTrailing: string;
  /** sessionId tag passed on synthetic SDKUserMessages (cosmetic — for the sdk's own session bookkeeping). */
  sdkSessionId: string;
  /** called with raw assistant text + the batch that produced it. */
  onResponse: (text: string, batch: TurnFeed[]) => void;
};

type SdkLoopHandle = {
  feed: (t: TurnFeed) => void;
  stop: () => void;
};

function startSdkLoop(opts: SdkLoopOptions): SdkLoopHandle {
  const respawnMs = 5_000;
  const maxConsecutiveFailures = 5;

  if (!existsSync(opts.cwd)) mkdirSync(opts.cwd, { recursive: true });
  const claudePath = findClaudeExecutable();

  const queue: TurnFeed[] = [];
  // FIFO of batches sent and awaiting their assistant response. one prompt
  // = one assistant message, in order, so we can shift the head on each
  // received message to recover which batch it answers.
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

  // tick: every batchMs, drain queue and push as a prompt.
  // when nothing closed in this window, queue is empty → no model call.
  // the batch interval is a ceiling on send rate, not a heartbeat.
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
    // fresh state per spawn — drop in-flight batches/prompts from the
    // prior subprocess; the new sdk has no memory of them anyway.
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
          // safety: model spoke without a pending batch (shouldn't happen).
          console.log(`[${opts.label}] response with no inflight batch — dropping`);
          continue;
        }
        opts.onResponse(text, batch);
      }
    } finally {
      // unblock the generator if it's awaiting (so it can exit cleanly)
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
        // sdk loop exited cleanly (e.g. abort during shutdown) — counts as not a failure
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

export function startObserver(opts: ObserverOptions): {
  feed: (t: TurnFeed) => void;
  stop: () => void;
} {
  const decisionsModel = opts.decisionsModel ?? "claude-sonnet-4-6";
  const namerModel = opts.namerModel ?? "claude-haiku-4-5";
  const batchMs = opts.batchMs ?? 30_000;

  const decisions = startSdkLoop({
    model: decisionsModel,
    cwd: DECISIONS_DIR,
    label: "observer",
    batchMs,
    systemIntro: DECISIONS_INTRO,
    formatTrailing: `Reply with a JSON object: {"decisions": [...one per turn in input order...]}. No other text.`,
    sdkSessionId: "chunk-to-chat-observer",
    onResponse(text, batch) {
      const parsed = parseDecisionsResponse(text);
      if (!parsed) {
        console.log(`[observer] could not parse: ${clip(text, 200)}`);
        return;
      }
      const byTurn = new Map<string, TurnFeed>();
      for (const t of batch) byTurn.set(t.turnId, t);
      for (const d of parsed) {
        const feed = byTurn.get(d.turnId);
        if (!feed) {
          console.log(`[observer] unknown turnId in response: ${d.turnId}`);
          continue;
        }
        const decision: GateDecision = { ...d, sessionKey: feed.sessionKey };
        opts.onDecision?.(decision);
        const tag = decision.open ? "OPEN" : "skip";
        const ins = decision.insight ? ` — ${decision.insight}` : "";
        const tags = decision.tags?.length ? ` [${decision.tags.join(",")}]` : "";
        console.log(`[observer] ${tag} ${decision.turnId.slice(0, 8)}${ins}${tags}`);
      }
    },
  });

  const namer = startSdkLoop({
    model: namerModel,
    cwd: NAMER_DIR,
    label: "namer",
    batchMs,
    systemIntro: NAMER_INTRO,
    formatTrailing: `Reply with a JSON object: {"names": [...one per distinct session you can confidently name...]}. No other text.`,
    sdkSessionId: "cut-the-cake-namer",
    onResponse(text, batch) {
      const parsed = parseNamesResponse(text);
      if (!parsed) {
        console.log(`[namer] could not parse: ${clip(text, 200)}`);
        return;
      }
      const validKeys = new Set(batch.map((t) => t.sessionKey));
      for (const n of parsed) {
        if (!validKeys.has(n.sessionKey)) {
          console.log(`[namer] unknown sessionKey in response: ${n.sessionKey.slice(0, 24)}`);
          continue;
        }
        opts.onName?.(n);
        console.log(`[namer] name ${n.sessionKey.slice(0, 24)} — [${n.name}]`);
      }
    },
  });

  return {
    feed(t) {
      decisions.feed(t);
      namer.feed(t);
    },
    stop() {
      decisions.stop();
      namer.stop();
    },
  };
}

// suppress unused-imports lint noise
void (null as unknown as MetaEvent);
