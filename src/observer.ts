// one long-lived sdk subprocess:
//   - summarizer: sonnet-4-6, returns a per-session one-sentence summary
// keeps prior-batch context so the summary reflects the session's arc.
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
  // full event list — the observer ignores it; kept on the feed for
  // downstream consumers that need the whole transcript. populated by buildTurnFeed.
  events?: MetaEvent[];
};

export type ObserverSummary = {
  sessionKey: string;
  turnId: string;
  summary?: string;
};

export type ObserverOptions = {
  /** model for the summarizer subprocess (sonnet by default). */
  summaryModel?: string;
  batchMs?: number;
  onSummary?: (s: ObserverSummary) => void;
  /** english name of the language the summary should be written in (e.g. "Hebrew").
   *  read fresh each batch so a runtime language change takes effect without a respawn. */
  getLanguage?: () => string;
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
// rename in resume queue).
const DECISIONS_DIR = join(homedir(), ".chunk-to-chat", "observer");

const SUMMARY_INTRO = `You are the observer for cut-the-cake, a tool that watches Claude Code / Codex sessions and shows a glanceable one-line label of each on a dashboard.

Your only job: when shown a batch of sessions (each with its recent activity), write ONE short sentence per session that says what the session is ABOUT — its subject or goal — NOT a play-by-play of the latest step. Think "what is this session for?", the label a developer would put on the tab.

Guidance:
- Describe the topic or purpose: the feature, area, or problem the session is working on (e.g. "reworking the tab-navigation UI in the medly app", "debugging the auth token-refresh flow"). NOT the moment-to-moment action ("running a test", "editing a file", "fixing a button").
- It should stay recognizable as the session evolves — name the subject, not the current action.
- Keep it to roughly a dozen words — a single short phrase, no trailing period needed.
- Write it in the user's chosen language — each batch's trailing instruction states which language.
- You see prior batches in your context; use that memory to keep the label consistent and accurate as the session grows.

Reply with ONLY a JSON object. No prose, no markdown fences. Schema:
{"summaries": [{"turnId": "<from input>", "summary": "..."}, ...]}

The summaries array is in the same order as the input batch (one entry per session).`;

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
    events: turn.events,
  };
}

function formatBatch(batch: TurnFeed[], trailing: string): string {
  const lines: string[] = [`${batch.length} session(s) to summarize:`];
  for (const t of batch) {
    const sName = t.sessionInfo.slug.replace(/^-+/, "").split("-").pop() ?? "?";
    lines.push("");
    lines.push(`---`);
    lines.push(`turnId: ${t.turnId}`);
    lines.push(`session: ${sName} (${t.sessionInfo.source})`);
    lines.push(
      `latest turn metrics: ${t.outputTokens} tok · ${t.toolUseCount} tools · +${t.linesAdded}/-${t.linesRemoved} lines`
    );
    if (t.userPrompt) lines.push(`latest user request: ${t.userPrompt}`);
    if (t.assistantExcerpt) lines.push(`recent activity:\n${t.assistantExcerpt}`);
  }
  lines.push("");
  lines.push(trailing);
  return lines.join("\n");
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function parseSummaryResponse(text: string): Array<Omit<ObserverSummary, "sessionKey">> | null {
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
    raw = Array.isArray(o.summaries) ? o.summaries : [];
  } else {
    return null;
  }
  const out: Array<Omit<ObserverSummary, "sessionKey">> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const turnId = typeof o.turnId === "string" ? o.turnId : null;
    if (!turnId) continue;
    const summary =
      typeof o.summary === "string" && o.summary.trim().length > 0 ? o.summary.trim() : undefined;
    out.push({
      turnId,
      ...(summary ? { summary } : {}),
    });
  }
  return out;
}

type SdkLoopOptions = {
  model: string;
  cwd: string;
  label: string;
  batchMs: number;
  systemIntro: string;
  /** built each tick; trailing line tells the model what shape to reply with
   *  (and, for the observer, which language to write insights in). */
  formatTrailing: () => string;
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
    const body = formatBatch(batch, opts.formatTrailing());
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
  const summaryModel = opts.summaryModel ?? "claude-sonnet-4-6";
  const batchMs = opts.batchMs ?? 30_000;
  const getLanguage = opts.getLanguage ?? (() => "Hebrew");

  const loop = startSdkLoop({
    model: summaryModel,
    cwd: DECISIONS_DIR,
    label: "observer",
    batchMs,
    systemIntro: SUMMARY_INTRO,
    formatTrailing: () =>
      `Reply with a JSON object: {"summaries": [...one per session in input order...]}. Write every summary in ${getLanguage()}. No other text.`,
    sdkSessionId: "chunk-to-chat-observer",
    onResponse(text, batch) {
      const parsed = parseSummaryResponse(text);
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
        const summary: ObserverSummary = { ...d, sessionKey: feed.sessionKey };
        opts.onSummary?.(summary);
        console.log(`[observer] ${feed.sessionKey.slice(-24)} — ${clip(summary.summary ?? "(none)", 80)}`);
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
