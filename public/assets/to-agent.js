// pull the first ```to-agent … ``` fenced block out of the assistant text.
// returns { body: text without the block, reply: the drafted message | null }.
// the fence must sit at the start of a line (optionally indented) so an
// inline mention of `to-agent` inside the explanation never false-matches.
function extractToAgent(text) {
  const re = /(?:^|\n)[ \t]*```to-agent[^\n]*\n([\s\S]*?)\n[ \t]*```/;
  const m = re.exec(text || "");
  if (!m) return { body: text || "", reply: null };
  const reply = m[1].replace(/\s+$/, "");
  const body = ((text.slice(0, m.index) + text.slice(m.index + m[0].length)) || "").trim();
  return { body, reply };
}

// browser: global for app.js. bun test: CommonJS export.
if (typeof window !== "undefined") window.extractToAgent = extractToAgent;
if (typeof module !== "undefined" && module.exports) module.exports = { extractToAgent };
