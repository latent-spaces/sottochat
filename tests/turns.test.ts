import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord, type MetaEvent } from "../src/jsonl";
import { createTurnsState, ingestEvent, type Turn } from "../src/turns";

function ev(partial: Partial<MetaEvent> & { kind: MetaEvent["kind"] }): MetaEvent {
  return { uuid: Math.random().toString(36).slice(2), ts: 1, text: "", ...partial } as MetaEvent;
}

describe("ingestEvent", () => {
  test("user_message opens a turn; stop closes it", () => {
    const state = createTurnsState();
    const open = ingestEvent(state, ev({ kind: "user_message", uuid: "u1", text: "go" }));
    expect(open.opened?.id).toBe("u1");
    expect(open.closed).toBeUndefined();

    ingestEvent(state, ev({ kind: "assistant_text", text: "done", tokens: 10 }));
    const stop = ingestEvent(state, ev({ kind: "stop" }));
    expect(stop.closed?.id).toBe("u1");
    expect(stop.closed?.closed).toBe(true);
  });

  test("new user_message while a turn is open closes the prior turn", () => {
    const state = createTurnsState();
    ingestEvent(state, ev({ kind: "user_message", uuid: "u1", text: "first" }));
    ingestEvent(state, ev({ kind: "assistant_text", text: "working" }));
    const r = ingestEvent(state, ev({ kind: "user_message", uuid: "u2", text: "second" }));
    expect(r.closed?.id).toBe("u1");
    expect(r.opened?.id).toBe("u2");
    expect(state.turns).toHaveLength(2);
  });

  test("events before any user_message are dropped", () => {
    const state = createTurnsState();
    const r = ingestEvent(state, ev({ kind: "assistant_text", text: "orphan" }));
    expect(r).toEqual({});
    expect(state.turns).toHaveLength(0);
  });

  test("tallies tokens, chars, tool uses, and edit lines", () => {
    const state = createTurnsState();
    ingestEvent(state, ev({ kind: "user_message", uuid: "u1", text: "edit stuff" }));
    ingestEvent(state, ev({ kind: "assistant_text", text: "12345", tokens: 7 }));
    ingestEvent(
      state,
      ev({ kind: "tool_use", toolUseId: "t1", tool: "Edit", summary: "f.ts", linesAdded: 3, linesRemoved: 1 })
    );
    ingestEvent(state, ev({ kind: "tool_use", toolUseId: "t2", tool: "Bash", summary: "ls" }));
    const { closed } = ingestEvent(state, ev({ kind: "stop" }));
    expect(closed).toMatchObject({
      outputTokens: 7,
      outputChars: 5,
      toolUseCount: 2,
      linesAdded: 3,
      linesRemoved: 1,
      userPromptText: "edit stuff",
    });
  });
});

describe("end-to-end: fixture jsonl → parseRecord → turns", () => {
  test("claude-code fixture produces one closed turn with expected shape", () => {
    const lines = readFileSync(join(import.meta.dir, "fixtures/claude-code.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim());
    const state = createTurnsState();
    const closed: Turn[] = [];
    for (const line of lines) {
      for (const e of parseRecord(JSON.parse(line))) {
        const r = ingestEvent(state, e);
        if (r.closed) closed.push(r.closed);
      }
    }
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      userPromptText: "fix the login bug",
      outputTokens: 125, // 85 + 40
      toolUseCount: 1,
      linesAdded: 1,
      linesRemoved: 2,
    });
  });
});
