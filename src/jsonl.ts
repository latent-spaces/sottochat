// parser for claude code session jsonl records.
// keeps user / assistant / system{stop_hook_summary}; skips noise
// (attachment, file-history-snapshot, last-prompt, permission-mode,
// queue-operation, agent-name, custom-title).

export type MetaEvent =
  | { kind: "user_message"; uuid: string; text: string; ts: number }
  | {
      kind: "assistant_text";
      uuid: string;
      text: string;
      tokens?: number;
      inputTokens?: number;
      model?: string;
      ts: number;
    }
  | {
      kind: "tool_use";
      uuid: string;
      toolUseId: string;
      tool: string;
      summary: string;
      ts: number;
      linesAdded?: number;
      linesRemoved?: number;
    }
  | { kind: "tool_result"; uuid: string; toolUseId: string; summary: string; isError: boolean; ts: number }
  | { kind: "stop"; uuid: string; ts: number };

type Block = {
  type?: string;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
  is_error?: unknown;
};

type RawRecord = {
  type?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  subtype?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
    model?: unknown;
    usage?: {
      output_tokens?: unknown;
      input_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
    };
  };
};

export function parseRecord(raw: unknown): MetaEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as RawRecord;
  if (typeof r.uuid !== "string") return [];

  const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) || Date.now() : Date.now();
  const baseUuid = r.uuid;

  if (r.type === "user") return parseUser(r, baseUuid, ts);
  if (r.type === "assistant") return parseAssistant(r, baseUuid, ts);
  if (r.type === "system" && r.subtype === "stop_hook_summary") {
    return [{ kind: "stop", uuid: baseUuid, ts }];
  }
  return [];
}

function parseUser(r: RawRecord, baseUuid: string, ts: number): MetaEvent[] {
  const content = r.message?.content;

  if (typeof content === "string") {
    const text = content.trim();
    if (!text) return [];
    return [{ kind: "user_message", uuid: baseUuid, text, ts }];
  }
  if (!Array.isArray(content)) return [];

  const events: MetaEvent[] = [];
  const textParts: string[] = [];

  for (const b of content as Block[]) {
    if (b?.type === "tool_result") {
      const toolUseId = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
      events.push({
        kind: "tool_result",
        uuid: `${baseUuid}:b${events.length}`,
        toolUseId,
        summary: summarizeToolResult(b.content),
        isError: b.is_error === true,
        ts,
      });
    } else if (b?.type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
    }
  }

  if (textParts.length > 0) {
    const text = textParts.join("\n").trim();
    if (text) {
      events.push({ kind: "user_message", uuid: `${baseUuid}:t${events.length}`, text, ts });
    }
  }
  return events;
}

function parseAssistant(r: RawRecord, baseUuid: string, ts: number): MetaEvent[] {
  const content = r.message?.content;
  if (!Array.isArray(content)) return [];

  const usageOut = r.message?.usage?.output_tokens;
  const tokens = typeof usageOut === "number" ? usageOut : undefined;
  // total input = fresh prompt + cache read + cache create. claude's
  // input_tokens alone is just the non-cached delta which is tiny most
  // turns (cache reads dominate); sum to get a meaningful "input size".
  const numOr0 = (v: unknown) => (typeof v === "number" ? v : 0);
  const u = r.message?.usage;
  const inputSum = u
    ? numOr0(u.input_tokens) + numOr0(u.cache_read_input_tokens) + numOr0(u.cache_creation_input_tokens)
    : 0;
  const inputTokens = inputSum > 0 ? inputSum : undefined;
  const rawModel = r.message?.model;
  const model = typeof rawModel === "string" ? rawModel : undefined;

  const events: MetaEvent[] = [];
  for (const b of content as Block[]) {
    if (b?.type === "text" && typeof b.text === "string") {
      const text = b.text.trim();
      if (!text) continue;
      events.push({
        kind: "assistant_text",
        uuid: `${baseUuid}:b${events.length}`,
        text,
        ...(tokens !== undefined ? { tokens } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(model !== undefined ? { model } : {}),
        ts,
      });
    } else if (b?.type === "tool_use") {
      const tool = typeof b.name === "string" ? b.name : "?";
      const toolUseId = typeof b.id === "string" ? b.id : "";
      const change = computeEditLines(tool, b.input);
      events.push({
        kind: "tool_use",
        uuid: `${baseUuid}:b${events.length}`,
        toolUseId,
        tool,
        summary: summarizeToolUseInput(b.input),
        ...(change.added > 0 ? { linesAdded: change.added } : {}),
        ...(change.removed > 0 ? { linesRemoved: change.removed } : {}),
        ts,
      });
    }
  }
  return events;
}

function summarizeToolUseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.command === "string") return clip(i.command, 100);
  if (typeof i.description === "string") return clip(i.description, 100);
  if (typeof i.pattern === "string") return i.pattern;
  if (typeof i.url === "string") return i.url;
  if (typeof i.path === "string") return i.path;
  if (typeof i.query === "string") return clip(i.query, 100);
  return "";
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === "string") return clip(content, 100);
  if (!Array.isArray(content)) return "";
  for (const b of content as Block[]) {
    if (b?.type === "text" && typeof b.text === "string") return clip(b.text, 100);
  }
  return "";
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// per-call line magnitude for edit-class tools. errored edits are not
// discounted (we don't pair tool_use ↔ tool_result here); rare enough
// that the noise is acceptable for v1.
function computeEditLines(tool: string, input: unknown): { added: number; removed: number } {
  if (!input || typeof input !== "object") return { added: 0, removed: 0 };
  const i = input as Record<string, unknown>;

  if (tool === "Edit") {
    return { added: countLines(i.new_string), removed: countLines(i.old_string) };
  }
  if (tool === "MultiEdit" && Array.isArray(i.edits)) {
    let added = 0;
    let removed = 0;
    for (const e of i.edits) {
      if (!e || typeof e !== "object") continue;
      const ee = e as Record<string, unknown>;
      added += countLines(ee.new_string);
      removed += countLines(ee.old_string);
    }
    return { added, removed };
  }
  if (tool === "Write") {
    return { added: countLines(i.content), removed: 0 };
  }
  if (tool === "NotebookEdit") {
    // we don't have the prior cell content, so count new cell as added.
    return { added: countLines(i.new_source), removed: 0 };
  }
  return { added: 0, removed: 0 };
}

function countLines(s: unknown): number {
  if (typeof s !== "string" || s.length === 0) return 0;
  return s.split("\n").length;
}
