// parser for claude code session jsonl records.
// keeps user / assistant / system{stop_hook_summary}; skips noise
// (attachment, file-history-snapshot, last-prompt, permission-mode,
// queue-operation, agent-name, custom-title).

export type MetaEvent =
  | { kind: "user_message"; uuid: string; text: string; ts: number }
  | { kind: "assistant_text"; uuid: string; text: string; tokens?: number; ts: number }
  | { kind: "tool_use"; uuid: string; toolUseId: string; tool: string; summary: string; ts: number }
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
    usage?: { output_tokens?: unknown };
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

  const usageTokens = r.message?.usage?.output_tokens;
  const tokens = typeof usageTokens === "number" ? usageTokens : undefined;

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
        ts,
      });
    } else if (b?.type === "tool_use") {
      const tool = typeof b.name === "string" ? b.name : "?";
      const toolUseId = typeof b.id === "string" ? b.id : "";
      events.push({
        kind: "tool_use",
        uuid: `${baseUuid}:b${events.length}`,
        toolUseId,
        tool,
        summary: summarizeToolUseInput(b.input),
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
