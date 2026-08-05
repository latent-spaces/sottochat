import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord, type MetaEvent } from "../src/jsonl";

const fixtureLines = readFileSync(join(import.meta.dir, "fixtures/claude-code.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim());

function parseLine(line: string): MetaEvent[] {
  return parseRecord(JSON.parse(line));
}

describe("parseRecord", () => {
  test("user record with string content → user_message", () => {
    const evs = parseLine(fixtureLines[0]!);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "user_message", uuid: "u-1", text: "fix the login bug" });
    expect(evs[0]!.ts).toBe(Date.parse("2026-07-10T10:00:00.000Z"));
  });

  test("assistant record: text + tool_use with summed usage, model, edit lines", () => {
    const evs = parseLine(fixtureLines[1]!);
    expect(evs).toHaveLength(2);
    const [text, tool] = evs;
    expect(text).toMatchObject({
      kind: "assistant_text",
      text: "Looking at the auth module.",
      tokens: 85,
      // input = fresh 12 + cache_read 4000 + cache_creation 200
      inputTokens: 4212,
      model: "claude-sonnet-5",
    });
    expect(tool).toMatchObject({
      kind: "tool_use",
      tool: "Edit",
      toolUseId: "toolu_01",
      summary: "/Users/dev/proj/src/auth.ts",
      linesAdded: 1,
      linesRemoved: 2,
    });
  });

  test("user record with tool_result blocks → tool_result", () => {
    const evs = parseLine(fixtureLines[2]!);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      kind: "tool_result",
      toolUseId: "toolu_01",
      summary: "edit applied",
      isError: false,
    });
  });

  test("system stop_hook_summary → stop", () => {
    const evs = parseLine(fixtureLines[4]!);
    expect(evs).toEqual([{ kind: "stop", uuid: "s-1", ts: Date.parse("2026-07-10T10:00:13.000Z") }]);
  });

  test("noise record types are skipped", () => {
    // mode, file-history-snapshot, attachment, pr-link
    for (const line of [...fixtureLines.slice(5, 8), fixtureLines[8]!]) {
      expect(parseLine(line)).toEqual([]);
    }
  });

  // cc 2.1.217+ emits turn_duration on every cli turn. stop_hook_summary only
  // exists when the user has Stop hooks configured, so without this a hook-less
  // install never closes a turn.
  test("system turn_duration → stop", () => {
    const evs = parseLine(fixtureLines[9]!);
    expect(evs).toEqual([{ kind: "stop", uuid: "s-2", ts: Date.parse("2026-07-10T10:00:13.500Z") }]);
  });

  describe("session titles", () => {
    test("ai-title → session_title (no uuid/timestamp on the record)", () => {
      const evs = parseLine(fixtureLines[10]!);
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ kind: "session_title", title: "Fix the login token check" });
    });

    test("custom-title → session_title", () => {
      const evs = parseLine(fixtureLines[11]!);
      expect(evs[0]).toMatchObject({ kind: "session_title", title: "login-hardening" });
    });

    test("blank titles are dropped", () => {
      expect(parseRecord({ type: "ai-title", aiTitle: "   ", sessionId: "s" })).toEqual([]);
      expect(parseRecord({ type: "custom-title", sessionId: "s" })).toEqual([]);
    });
  });

  describe("synthetic user records", () => {
    test("slash-command echo, its stdout, and the caveat are not prompts", () => {
      for (const line of fixtureLines.slice(12, 15)) {
        expect(parseLine(line)).toEqual([]);
      }
    });

    test("isMeta records (injected git context) are not prompts", () => {
      expect(parseLine(fixtureLines[15]!)).toEqual([]);
    });

    test("a body that is only a system-reminder is not a prompt", () => {
      expect(parseLine(fixtureLines[16]!)).toEqual([]);
    });

    test("a real prompt survives, with the system-reminder stripped", () => {
      const evs = parseLine(fixtureLines[17]!);
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ kind: "user_message", text: "now ship it" });
    });

    test("tool_result blocks still parse on an isMeta record", () => {
      const evs = parseRecord({
        type: "user",
        uuid: "u-x",
        isMeta: true,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "ok" }],
        },
      });
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ kind: "tool_result", toolUseId: "toolu_9" });
    });

    test("a prompt merely mentioning a tag is kept", () => {
      const evs = parseRecord({
        type: "user",
        uuid: "u-y",
        message: { role: "user", content: "why does <command-name> show up in the jsonl?" },
      });
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ kind: "user_message" });
    });
  });

  test("records without a uuid are skipped", () => {
    expect(parseRecord({ type: "user", message: { role: "user", content: "hi" } })).toEqual([]);
  });

  test("malformed input is safe", () => {
    expect(parseRecord(null)).toEqual([]);
    expect(parseRecord("x")).toEqual([]);
    expect(parseRecord({ type: "assistant", uuid: "a", message: { content: "not-an-array" } })).toEqual([]);
  });
});
