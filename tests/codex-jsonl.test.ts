import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCodexParseState, parseCodexRecord } from "../src/codex-jsonl";
import type { MetaEvent } from "../src/jsonl";

const fixtureLines = readFileSync(join(import.meta.dir, "fixtures/codex.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim());

function parseAll(lines: string[]) {
  const state = createCodexParseState();
  const events: MetaEvent[] = [];
  for (const line of lines) events.push(...parseCodexRecord(JSON.parse(line), state));
  return { state, events };
}

describe("parseCodexRecord", () => {
  test("full rollout fixture → expected event stream", () => {
    const { state, events } = parseAll(fixtureLines);
    expect(events.map((e) => e.kind)).toEqual([
      "user_message",
      "tool_use",
      "tool_result",
      "tool_use",
      "tool_result",
      "assistant_text",
      "stop",
    ]);
    // session_meta side-effects
    expect(state.sessionId).toBe("019f2d58-4ccc-7343-b416-cbbc836ed500");
    expect(state.cwdSlug).toBe("-Users-dev-my-proj");
  });

  test("token_count folds into the NEXT assistant_text (fresh + cached input)", () => {
    const { events } = parseAll(fixtureLines);
    const assistant = events.find((e) => e.kind === "assistant_text")!;
    expect(assistant).toMatchObject({
      text: "Added a /healthz endpoint.",
      tokens: 220,
      inputTokens: 51500, // 1500 fresh + 50000 cached
      model: "gpt-5.4-codex", // from turn_context
    });
  });

  test("response_item/message duplicate of agent_message is skipped", () => {
    const { events } = parseAll(fixtureLines);
    const texts = events.filter((e) => e.kind === "assistant_text");
    expect(texts).toHaveLength(1);
  });

  test("function_call: array command summarized as joined string", () => {
    const { events } = parseAll(fixtureLines);
    const tool = events.find((e) => e.kind === "tool_use")!;
    expect(tool).toMatchObject({ tool: "shell", toolUseId: "call_1", summary: "bash -lc ls src" });
  });

  test("custom_tool_call apply_patch: summary is the patched file path", () => {
    const { events } = parseAll(fixtureLines);
    const patch = events.filter((e) => e.kind === "tool_use")[1]!;
    expect(patch).toMatchObject({ tool: "apply_patch", summary: "src/routes.ts" });
  });

  test("function_call_output starting with error: is flagged isError", () => {
    const state = createCodexParseState();
    const evs = parseCodexRecord(
      {
        timestamp: "2026-07-10T09:01:00.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "c9", output: "error: command failed" },
      },
      state
    );
    expect(evs[0]).toMatchObject({ kind: "tool_result", isError: true });
  });

  test("turn_aborted → stop", () => {
    const state = createCodexParseState();
    const evs = parseCodexRecord(
      { timestamp: "2026-07-10T09:01:00.000Z", type: "event_msg", payload: { type: "turn_aborted" } },
      state
    );
    expect(evs[0]).toMatchObject({ kind: "stop" });
  });

  test("synthesized uuids are unique and monotonic", () => {
    const { events } = parseAll(fixtureLines);
    const uuids = events.map((e) => e.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
    for (const u of uuids) expect(u).toMatch(/^cx-\d+$/);
  });

  test("malformed input is safe", () => {
    const state = createCodexParseState();
    expect(parseCodexRecord(null, state)).toEqual([]);
    expect(parseCodexRecord({ type: "event_msg" }, state)).toEqual([]);
    expect(parseCodexRecord({ type: "event_msg", payload: { type: "user_message", message: 42 } }, state)).toEqual([]);
  });
});
