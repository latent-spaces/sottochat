import { describe, expect, test } from "bun:test";
import { parseSummaryResponse } from "../src/observer";

describe("parseSummaryResponse", () => {
  test("plain JSON object with summaries array", () => {
    const out = parseSummaryResponse('{"summaries":[{"turnId":"t1","summary":"auth refactor"}]}');
    expect(out).toEqual([{ turnId: "t1", summary: "auth refactor" }]);
  });

  test("markdown-fenced JSON is unwrapped", () => {
    const out = parseSummaryResponse('```json\n{"summaries":[{"turnId":"t1","summary":"x"}]}\n```');
    expect(out).toEqual([{ turnId: "t1", summary: "x" }]);
  });

  test("bare array form is accepted", () => {
    const out = parseSummaryResponse('[{"turnId":"a","summary":"s"}]');
    expect(out).toEqual([{ turnId: "a", summary: "s" }]);
  });

  test("empty or whitespace summary is dropped, turnId kept", () => {
    const out = parseSummaryResponse('{"summaries":[{"turnId":"t1","summary":"  "}]}');
    expect(out).toEqual([{ turnId: "t1" }]);
  });

  test("items without turnId are skipped", () => {
    const out = parseSummaryResponse('{"summaries":[{"summary":"orphan"},{"turnId":"t2","summary":"ok"}]}');
    expect(out).toEqual([{ turnId: "t2", summary: "ok" }]);
  });

  test("non-JSON prose returns null", () => {
    expect(parseSummaryResponse("Sure! Here are the summaries:")).toBeNull();
  });
});
