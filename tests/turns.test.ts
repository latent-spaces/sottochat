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

  // the regression that shipped in 0.1.9: turn closing hung off
  // stop_hook_summary, which cc only writes when the user has Stop hooks
  // configured. a hook-less install therefore never closed a turn — no
  // observer summary, no chat seed, no thread. drive the seam end to end.
  test("a session with no Stop hooks closes its turn on turn_duration", () => {
    const records = [
      { type: "user", uuid: "u1", timestamp: "2026-08-05T10:00:00.000Z", message: { role: "user", content: "ship it" } },
      {
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-08-05T10:00:04.000Z",
        message: { role: "assistant", model: "claude-opus-5", content: [{ type: "text", text: "shipped" }], usage: { input_tokens: 5, output_tokens: 20 } },
      },
      // note: no stop_hook_summary anywhere in this transcript.
      { type: "system", subtype: "turn_duration", uuid: "s1", timestamp: "2026-08-05T10:00:05.000Z", durationMs: 5000 },
    ];

    const state = createTurnsState();
    const closedTurns: Turn[] = [];
    for (const rec of records) {
      for (const e of parseRecord(rec)) {
        const r = ingestEvent(state, e);
        if (r.closed) closedTurns.push(r.closed);
      }
    }

    expect(closedTurns).toHaveLength(1);
    expect(closedTurns[0]!.id).toBe("u1");
    expect(closedTurns[0]!.userPromptText).toBe("ship it");
    expect(closedTurns[0]!.outputTokens).toBe(20);
  });

  test("stop_hook_summary followed by turn_duration closes the turn exactly once", () => {
    const state = createTurnsState();
    ingestEvent(state, ev({ kind: "user_message", uuid: "u1", text: "go" }));
    const first = ingestEvent(state, ev({ kind: "stop", uuid: "hook" }));
    const second = ingestEvent(state, ev({ kind: "stop", uuid: "dur" }));
    expect(first.closed?.id).toBe("u1");
    expect(second.closed).toBeUndefined();
  });

  test("slash-command noise between turns does not split a turn", () => {
    const records = [
      { type: "user", uuid: "u1", timestamp: "2026-08-05T10:00:00.000Z", message: { role: "user", content: "do the thing" } },
      // user runs /model mid-turn: three records that are not prompts.
      { type: "user", uuid: "u2", timestamp: "2026-08-05T10:00:01.000Z", message: { role: "user", content: "<command-name>/model</command-name>" } },
      { type: "user", uuid: "u3", timestamp: "2026-08-05T10:00:02.000Z", message: { role: "user", content: "<local-command-stdout>Set model to Opus 5</local-command-stdout>" } },
      { type: "user", uuid: "u4", timestamp: "2026-08-05T10:00:03.000Z", isMeta: true, message: { role: "user", content: [{ type: "text", text: "- Branch: main" }] } },
      { type: "system", subtype: "turn_duration", uuid: "s1", timestamp: "2026-08-05T10:00:09.000Z" },
    ];
    const state = createTurnsState();
    const closedTurns: Turn[] = [];
    for (const rec of records) {
      for (const e of parseRecord(rec)) {
        const r = ingestEvent(state, e);
        if (r.closed) closedTurns.push(r.closed);
      }
    }
    expect(state.turns).toHaveLength(1);
    expect(closedTurns).toHaveLength(1);
    expect(closedTurns[0]!.userPromptText).toBe("do the thing");
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
