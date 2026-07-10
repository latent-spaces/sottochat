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
    // mode, file-history-snapshot, attachment, ai-title, system/turn_duration
    for (const line of fixtureLines.slice(5)) {
      expect(parseLine(line)).toEqual([]);
    }
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
