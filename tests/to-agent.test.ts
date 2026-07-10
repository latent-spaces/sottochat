import { describe, expect, test } from "bun:test";
// the extractor ships to the browser as a plain script; it dual-exports for tests.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractToAgent } = require("../public/assets/to-agent.js");

describe("extractToAgent", () => {
  test("pulls the fenced to-agent block out of the body", () => {
    const text = 'ההסבר כאן.\n\n```to-agent\nPlease re-run the failing test and paste the output.\n```\n\nעוד הערה.';
    const { body, reply } = extractToAgent(text);
    expect(reply).toBe("Please re-run the failing test and paste the output.");
    expect(body).toContain("ההסבר כאן.");
    expect(body).toContain("עוד הערה.");
    expect(body).not.toContain("```");
  });

  test("no block → reply null, body untouched", () => {
    expect(extractToAgent("just an answer")).toEqual({ body: "just an answer", reply: null });
    expect(extractToAgent("")).toEqual({ body: "", reply: null });
    expect(extractToAgent(null)).toEqual({ body: "", reply: null });
  });

  test("inline mention of to-agent does not false-match", () => {
    const text = "use a `to-agent` block like ```to-agent when needed";
    expect(extractToAgent(text).reply).toBeNull();
  });

  test("indented fence still matches", () => {
    const text = "intro\n  ```to-agent\n  do the thing\n  ```";
    expect(extractToAgent(text).reply).toBe("  do the thing");
  });

  test("trailing whitespace inside the block is trimmed from the reply", () => {
    const text = "```to-agent\nreply text\n\n   \n```";
    expect(extractToAgent(text).reply).toBe("reply text");
  });

  test("only the first block is extracted", () => {
    const text = "```to-agent\nfirst\n```\nmiddle\n```to-agent\nsecond\n```";
    const { body, reply } = extractToAgent(text);
    expect(reply).toBe("first");
    expect(body).toContain("second");
  });
});
