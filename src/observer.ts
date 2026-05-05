// single long-lived sdk observer. one persistent claude code subprocess
// (sonnet by default) reads batches of recently-closed turns + recent
// user interactions, returns gate decisions + 1-sentence insights.
//
// pattern: claude-mem ClaudeProvider — query() from @anthropic-ai/claude-agent-sdk,
// async-generator prompt feed, sandboxed cwd, all tools disallowed.
//
// M1 scope: spawn, batch, log decisions to stdout. no profile persistence,
// no resume across restarts, no feedback channel, no ui swap. just verify
// the call works and the prompt produces useful output.

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

export type ObserverOptions = {
  model?: string;
  batchMs?: number;
  onDecision?: (d: GateDecision) => void;
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

const OBSERVER_DIR = join(homedir(), ".chunk-to-chat", "observer");

const SYSTEM_INTRO = `You are the observer for chunk-to-chat, a tool that watches Claude Code sessions and surfaces moments worth user review.

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

Reply with ONLY a JSON array, one object per turn IN THE SAME ORDER as the batch. No prose, no markdown fences. Schema:
[{"turnId": "<from input>", "open": true|false, "insight": "..." | null, "tags": ["short-tag", ...], "prefill": "..." | null}]

Tags are short kebab-case labels you invent; we will use them later to learn your patterns. Examples: "loop-suspected", "scope-creep", "test-failures", "style-rewrite".`;

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

function formatBatch(batch: TurnFeed[]): string {
  const lines: string[] = [`New batch of ${batch.length} closed turn(s):`];
  for (const t of batch) {
    const sName = t.sessionInfo.slug.replace(/^-+/, "").split("-").pop() ?? "?";
    lines.push("");
    lines.push(`---`);
    lines.push(`turnId: ${t.turnId}`);
    lines.push(`session: ${sName} (${t.sessionInfo.source})`);
    lines.push(
      `metrics: ${t.outputTokens} tok · ${t.outputChars} chars · ${t.toolUseCount} tools · +${t.linesAdded}/-${t.linesRemoved} lines`
    );
    if (t.userPrompt) lines.push(`user: ${t.userPrompt}`);
    if (t.assistantExcerpt) lines.push(`assistant: ${t.assistantExcerpt}`);
  }
  lines.push("");
  lines.push(
    "Reply with a JSON array of decisions, one object per turn, in input order. No other text."
  );
  return lines.join("\n");
}

function tryParseDecisions(text: string): Array<Omit<GateDecision, "sessionKey">> | null {
  // strip optional markdown fences
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: Array<Omit<GateDecision, "sessionKey">> = [];
  for (const item of parsed) {
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

export function startObserver(opts: ObserverOptions): {
  feed: (t: TurnFeed) => void;
  stop: () => void;
} {
  const model = opts.model ?? "claude-sonnet-4-6";
  const batchMs = opts.batchMs ?? 30_000;
  const respawnMs = 5_000;
  const maxConsecutiveFailures = 5;

  if (!existsSync(OBSERVER_DIR)) mkdirSync(OBSERVER_DIR, { recursive: true });
  const claudePath = findClaudeExecutable();

  const queue: TurnFeed[] = [];
  const inflight = new Map<string, TurnFeed>();
  const pendingMsgs: SDKUserMessage[] = [];
  let stopped = false;
  let firstPrompt = true;
  let resolvePending: ((msg: SDKUserMessage | null) => void) | null = null;
  let currentAbort: AbortController | null = null;

  function pushPrompt(content: string) {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      session_id: "chunk-to-chat-observer",
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

  // tick: every batchMs, drain queue and push as a prompt
  const tick = setInterval(() => {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    for (const t of batch) inflight.set(t.turnId, t);
    const body = formatBatch(batch);
    const content = firstPrompt ? `${SYSTEM_INTRO}\n\n---\n\n${body}` : body;
    firstPrompt = false;
    pushPrompt(content);
    console.log(`[observer] sent batch of ${batch.length} turn(s) to ${model}`);
  }, batchMs);

  async function runSdkLoopOnce(): Promise<void> {
    // fresh state per spawn — drop any in-flight prompts/decisions from
    // the prior subprocess; the new sdk has no memory of them anyway.
    pendingMsgs.length = 0;
    inflight.clear();
    firstPrompt = true;
    const abort = new AbortController();
    currentAbort = abort;
    const gen = makeMessageGenerator();
    try {
      const result = query({
        prompt: gen,
        options: {
          model,
          cwd: OBSERVER_DIR,
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
        const decisions = tryParseDecisions(text);
        if (!decisions) {
          console.log(`[observer] could not parse: ${clip(text, 200)}`);
          continue;
        }
        for (const d of decisions) {
          const feed = inflight.get(d.turnId);
          if (!feed) {
            console.log(`[observer] unknown turnId in response: ${d.turnId}`);
            continue;
          }
          inflight.delete(d.turnId);
          const decision: GateDecision = { ...d, sessionKey: feed.sessionKey };
          opts.onDecision?.(decision);
          const tag = decision.open ? "OPEN" : "skip";
          const ins = decision.insight ? ` — ${decision.insight}` : "";
          const tags = decision.tags?.length ? ` [${decision.tags.join(",")}]` : "";
          console.log(`[observer] ${tag} ${decision.turnId.slice(0, 8)}${ins}${tags}`);
        }
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
        console.log(`[observer] respawning sdk subprocess (attempt ${attempts})`);
      }
      try {
        await runSdkLoopOnce();
        // sdk loop exited cleanly (e.g. abort during shutdown) — counts as not a failure
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[observer] sdk error (consecutive failures ${consecutiveFailures}/${maxConsecutiveFailures}): ${msg}`
        );
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(`[observer] giving up after ${consecutiveFailures} consecutive failures`);
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

// suppress unused-imports lint noise
void (null as unknown as MetaEvent);
