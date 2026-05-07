// parser for openai codex cli rollout jsonl records.
//
// codex's schema is documented in vendor/abtop/src/collector/codex.rs lines
// 17-22 + 583-590. relevant event shapes:
//   - session_meta:    {payload:{id, cwd, cli_version, timestamp, git:{branch}}}
//   - turn_context:    {payload:{cwd, model, effort, model_context_window}}
//   - event_msg subtypes (payload.type):
//       task_started:     {payload:{model_context_window}}
//       user_message:     {payload:{message:string}}
//       agent_message:    {payload:{message:string, phase}}
//       token_count:      {payload:{info:{total_token_usage, last_token_usage,
//                                          model_context_window}, rate_limits}}
//       task_complete:    turn boundary on exec runs (interactive emits one per turn too)
//       turn_aborted:     turn boundary on interrupt
//       thread_name_updated, *_end: skip
//   - response_item subtypes (payload.type):
//       message:                  skip — codex emits each assistant reply BOTH as
//                                 event_msg/agent_message AND as a role=assistant
//                                 message here, so taking both produces duplicates.
//                                 role=user/developer entries are system context
//                                 we don't want either.
//       function_call:            {name, arguments:string(JSON), call_id}
//       function_call_output:     {call_id, output:string}
//       custom_tool_call:         {name, input:string, call_id} — codex's apply_patch tool uses this shape
//       custom_tool_call_output:  {call_id, output:string} — pair with custom_tool_call
//       reasoning:                skip (encrypted chain-of-thought, not user-facing)
//
// vs. claude's schema, the key shape differences are:
//   - no per-record uuid → tailer offset is the dedup; we synthesize uuids
//     (cx-<seq>) since MetaEvent.uuid is required by ingestEvent.
//   - tokens arrive in a separate token_count event, not on the assistant
//     message itself. we cache the latest last_token_usage and fold it into
//     the next assistant_text we emit so server.ts's existing per-message
//     token plumbing works unchanged.
//   - the model lives in turn_context, not on the message. we cache it and
//     attach it to every assistant_text we emit thereafter.
//   - cwd is in session_meta only. we mutate the parser state's cwdSlug so
//     the tailer can lift the SessionInfo.slug from a date placeholder to
//     the real project name on first parse pass.

import type { MetaEvent } from "./jsonl";

export type CodexParseState = {
  /** monotonic counter used to synthesize unique uuids for emitted events. */
  seq: number;
  /** slug derived from session_meta.payload.cwd — the tailer lifts SessionInfo.slug from a placeholder once this is set. */
  cwdSlug?: string;
  /** session id from session_meta.payload.id. duplicates the filename uuid; kept here in case the filename ever drifts. */
  sessionId?: string;
  /** model from latest turn_context (codex sometimes pivots mid-session via /model). attached to every assistant_text we emit. */
  model?: string;
  /**
   * input + cache_read tokens from the latest token_count.last_token_usage.
   * folded into the NEXT assistant_text we emit, then cleared. codex emits
   * token_count after each agent reply, so attach-to-next is the closest
   * approximation to claude's per-message usage that doesn't require
   * reordering.
   */
  pendingInputTokens?: number;
  pendingOutputTokens?: number;
};

export function createCodexParseState(): CodexParseState {
  return { seq: 0 };
}

type CodexRecord = {
  type?: unknown;
  timestamp?: unknown;
  payload?: unknown;
};

export function parseCodexRecord(raw: unknown, state: CodexParseState): MetaEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as CodexRecord;
  const type = typeof r.type === "string" ? r.type : null;
  if (!type) return [];
  const payload = r.payload && typeof r.payload === "object"
    ? (r.payload as Record<string, unknown>)
    : null;
  if (!payload) return [];
  const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) || Date.now() : Date.now();

  state.seq += 1;
  const uuid = `cx-${state.seq}`;

  if (type === "session_meta") {
    const cwd = payload.cwd;
    if (typeof cwd === "string" && cwd.length > 0) state.cwdSlug = cwdToSlug(cwd);
    if (typeof payload.id === "string") state.sessionId = payload.id;
    return [];
  }

  if (type === "turn_context") {
    if (typeof payload.model === "string") state.model = payload.model;
    return [];
  }

  if (type === "event_msg") {
    const sub = typeof payload.type === "string" ? payload.type : null;
    if (sub === "user_message") {
      const text = typeof payload.message === "string" ? payload.message.trim() : "";
      if (!text) return [];
      return [{ kind: "user_message", uuid, text, ts }];
    }
    if (sub === "agent_message") {
      const text = typeof payload.message === "string" ? payload.message.trim() : "";
      if (!text) return [];
      return [emitAssistantText(uuid, text, ts, state)];
    }
    if (sub === "token_count") {
      cacheTokenCount(payload, state);
      return [];
    }
    if (sub === "task_complete" || sub === "turn_aborted") {
      return [{ kind: "stop", uuid, ts }];
    }
    // task_started, thread_name_updated, *_end: skip — not turn-relevant.
    return [];
  }

  if (type === "response_item") {
    const sub = typeof payload.type === "string" ? payload.type : null;
    // response_item/message: codex emits each assistant reply twice — once as
    // event_msg/agent_message (which we keep) and once here as role=assistant.
    // skipping this branch avoids the duplicate; role=user/developer entries
    // are system context we don't want anyway.
    if (sub === "function_call") {
      const tool = typeof payload.name === "string" ? payload.name : "?";
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const argsRaw = typeof payload.arguments === "string" ? payload.arguments : "";
      return [{
        kind: "tool_use",
        uuid,
        toolUseId: callId,
        tool,
        summary: summarizeCodexArgs(argsRaw),
        ts,
      }];
    }
    if (sub === "function_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const output = typeof payload.output === "string" ? payload.output : "";
      // codex doesn't carry an explicit error flag on function_call_output;
      // the textual output usually starts with "error:" / "Error:" when the
      // tool failed. best-effort — false negatives are tolerable.
      const isError = /(^|\n)\s*error[:\s]/i.test(output);
      return [{
        kind: "tool_result",
        uuid,
        toolUseId: callId,
        summary: clip(output, 100),
        isError,
        ts,
      }];
    }
    if (sub === "custom_tool_call") {
      // codex's apply_patch tool. input is a string (e.g. an `*** Begin Patch`
      // block); summarize with the first non-empty line so the inbox card has
      // something more meaningful than "apply_patch".
      const tool = typeof payload.name === "string" ? payload.name : "?";
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const input = typeof payload.input === "string" ? payload.input : "";
      return [{
        kind: "tool_use",
        uuid,
        toolUseId: callId,
        tool,
        summary: summarizeCustomToolInput(input),
        ts,
      }];
    }
    if (sub === "custom_tool_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const output = typeof payload.output === "string" ? payload.output : "";
      const isError = /(^|\n)\s*error[:\s]/i.test(output);
      return [{
        kind: "tool_result",
        uuid,
        toolUseId: callId,
        summary: clip(output, 100),
        isError,
        ts,
      }];
    }
    // reasoning, etc. — skip (encrypted chain-of-thought, not user-facing).
    return [];
  }

  return [];
}

function emitAssistantText(uuid: string, text: string, ts: number, state: CodexParseState): MetaEvent {
  const tokens = state.pendingOutputTokens;
  const inputTokens = state.pendingInputTokens;
  state.pendingOutputTokens = undefined;
  state.pendingInputTokens = undefined;
  return {
    kind: "assistant_text",
    uuid,
    text,
    ...(tokens !== undefined ? { tokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(state.model !== undefined ? { model: state.model } : {}),
    ts,
  };
}

function cacheTokenCount(payload: Record<string, unknown>, state: CodexParseState): void {
  const info = payload.info && typeof payload.info === "object"
    ? (payload.info as Record<string, unknown>)
    : null;
  if (!info) return;
  const last = info.last_token_usage && typeof info.last_token_usage === "object"
    ? (info.last_token_usage as Record<string, unknown>)
    : null;
  if (!last) return;
  const ip = numOr0(last.input_tokens);
  const op = numOr0(last.output_tokens);
  // codex uses `cached_input_tokens`; a few older rollouts use `cache_read_input_tokens`.
  // total input = fresh + cache so server.ts's contextTokens reflects the true window load.
  const cache = numOr0(last.cached_input_tokens) || numOr0(last.cache_read_input_tokens);
  state.pendingInputTokens = ip + cache;
  state.pendingOutputTokens = op;
}

function numOr0(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

// mirror claude code's project-dir slug convention so projectName() in the UI
// can extract the trailing project name unchanged. only `/`, `.`, and
// whitespace get folded into `-`; existing hyphens (e.g. `claude-meta`) survive.
function cwdToSlug(cwd: string): string {
  return cwd.replace(/[/.\s]+/g, "-");
}

function summarizeCodexArgs(argsRaw: string): string {
  if (!argsRaw) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsRaw);
  } catch {
    return clip(argsRaw, 100);
  }
  if (!parsed || typeof parsed !== "object") return "";
  const i = parsed as Record<string, unknown>;
  if (typeof i.path === "string") return i.path;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.cmd === "string") return clip(i.cmd, 100);
  if (typeof i.command === "string") return clip(i.command, 100);
  if (Array.isArray(i.command)) {
    const parts = (i.command as unknown[]).filter((x): x is string => typeof x === "string");
    return clip(parts.join(" "), 100);
  }
  if (typeof i.query === "string") return clip(i.query, 100);
  if (typeof i.pattern === "string") return i.pattern;
  if (typeof i.url === "string") return i.url;
  // fallback: first stringy value in the args object.
  for (const v of Object.values(i)) {
    if (typeof v === "string") return clip(v, 100);
  }
  return "";
}

// custom_tool_call's `input` is free-form text (e.g. an apply_patch block).
// the first significant line is usually the most recognizable (`*** Update
// File: <path>` for apply_patch). fall back to clipping if no line stands out.
function summarizeCustomToolInput(input: string): string {
  if (!input) return "";
  for (const ln of input.split("\n")) {
    const t = ln.trim();
    if (!t) continue;
    // apply_patch headers — return just the file path so the summary reads cleanly.
    const m = t.match(/^\*+\s+(Update|Add|Delete)\s+File:\s+(.+)$/);
    if (m) return clip(m[2], 100);
    if (t.startsWith("***")) continue; // skip patch frame markers
    return clip(t, 100);
  }
  return clip(input, 100);
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
