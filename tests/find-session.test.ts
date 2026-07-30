import { describe, expect, test } from "bun:test";
import { normalize, normalizeNeedle, searchHaystack } from "../src/find-session";

// a slice of the kind of text that lands in a jsonl assistant_text block
const HAY = [
  "I've traced the duplicate events to the tailer.",
  "",
  "The **watcher** fires twice for a single append on macOS, so `parseRecord` runs",
  "on the same byte range and both results get pushed. The fix is to track the",
  "last consumed offset per file and skip anything at or below it.",
  "",
  "Next I'll add a regression test that appends one line and asserts a single event.",
].join("\n");

describe("normalize", () => {
  test("collapses whitespace runs and lowercases", () => {
    const { norm } = normalize("  Hello\n\n   World  ");
    expect(norm).toBe("hello world");
  });

  test("maps every normalized char back to its source index", () => {
    const src = "  Ab\n c";
    const { norm, map } = normalize(src);
    expect(norm).toBe("ab c");
    expect(map.length).toBe(norm.length);
    expect(src[map[0]!]).toBe("A");
    expect(src[map[1]!]).toBe("b");
    expect(src[map[3]!]).toBe("c");
  });

  test("drops markdown markers and gutter glyphs but keeps underscores", () => {
    const { norm } = normalize("⏺ the `parse_record` **helper**");
    expect(norm).toBe("the parse_record helper");
  });

  test("strips ansi csi and osc sequences", () => {
    const { norm } = normalize("\x1b[1mbold\x1b[0m \x1b]0;title\x07plain");
    expect(norm).toBe("bold plain");
  });
});

describe("normalizeNeedle", () => {
  test("rejects a needle under the minimum length", () => {
    expect(normalizeNeedle("ab")).toBe("");
    expect(normalizeNeedle("  \n ")).toBe("");
  });

  test("accepts a short but usable needle", () => {
    expect(normalizeNeedle("tailer")).toBe("tailer");
  });
});

describe("searchHaystack — exact tier", () => {
  test("matches a verbatim slice", () => {
    const hit = searchHaystack(normalizeNeedle("track the last consumed offset per file"), HAY);
    expect(hit?.kind).toBe("exact");
    expect(hit?.score).toBe(1);
    expect(hit?.excerpt).toContain("consumed offset per file");
  });

  test("matches text the terminal re-wrapped mid-sentence", () => {
    // same words, different line breaks + gutter indentation than the jsonl
    const pasted = "  runs\n  on the same byte range and both results\n  get pushed.";
    const hit = searchHaystack(normalizeNeedle(pasted), HAY);
    expect(hit?.kind).toBe("exact");
  });

  test("matches after the terminal rendered away the markdown markers", () => {
    // "**watcher**" and "`parseRecord`" lose their markers when copied out
    const pasted = "The watcher fires twice for a single append on macOS, so parseRecord runs";
    const hit = searchHaystack(normalizeNeedle(pasted), HAY);
    expect(hit?.kind).toBe("exact");
  });

  test("matches a line copied with the claude-code gutter glyph and indent", () => {
    const pasted = "⏺  I've traced the duplicate events to the tailer.";
    const hit = searchHaystack(normalizeNeedle(pasted), HAY);
    expect(hit?.kind).toBe("exact");
  });

  test("excerpt is sliced from the original text, not the normalized one", () => {
    const hit = searchHaystack(normalizeNeedle("fires twice for a single append"), HAY);
    // original casing and markdown survive into the excerpt
    expect(hit?.excerpt).toContain("**watcher**");
  });
});

describe("searchHaystack — partial tier", () => {
  test("scores a needle whose tail was clipped or garbled", () => {
    const pasted =
      "on the same byte range and both results get pushed. The fix is to track the " +
      "zzz qqq wobble frobnicate the quux";
    const hit = searchHaystack(normalizeNeedle(pasted), HAY);
    expect(hit?.kind).toBe("partial");
    expect(hit!.score).toBeGreaterThan(0.2);
    expect(hit!.score).toBeLessThan(1);
  });

  test("unrelated prose scores below the threshold", () => {
    const pasted =
      "the quarterly revenue projection assumes a flat conversion rate across " +
      "every acquisition channel we measured last spring";
    expect(searchHaystack(normalizeNeedle(pasted), HAY)).toBeNull();
  });

  test("a sub-five-word needle gets no partial match", () => {
    // "tailer" alone appears, but "tailer wobble" does not — too short to shingle
    expect(searchHaystack(normalizeNeedle("tailer wobble"), HAY)).toBeNull();
  });
});

describe("searchHaystack — guards", () => {
  test("empty needle or empty haystack yields nothing", () => {
    expect(searchHaystack("", HAY)).toBeNull();
    expect(searchHaystack(normalizeNeedle("the tailer"), "")).toBeNull();
  });

  test("clips an over-long paste instead of rejecting it", () => {
    const needle = normalizeNeedle("track the last consumed offset per file" + "x".repeat(20_000));
    const hit = searchHaystack(needle, HAY);
    // the clipped needle no longer matches whole, but its head still shingles in
    expect(hit?.kind).toBe("partial");
  });
});
