// paste-to-find: match a chunk of pasted agent output against session
// transcripts.
//
// the whole problem is that pasted terminal text != the jsonl text it came
// from. the terminal hard-wraps mid-sentence, the claude-code gutter adds
// indentation and glyphs (⏺, ⎿), and markdown is *rendered*, so `**bold**` and
// `` `code` `` lose their markers on copy. a plain indexOf fails on most real
// pastes, so both sides get normalized first and a shingle-overlap fallback
// catches pastes whose head or tail got clipped.

export type Normalized = {
  norm: string;
  /** norm[i] came from src[map[i]] — lets us slice an excerpt out of the
   * ORIGINAL text after matching on the normalized one. */
  map: number[];
};

export type Hit = {
  score: number;
  kind: "exact" | "partial";
  excerpt: string;
};

// markdown markers the terminal renders away, plus the box/bullet glyphs
// claude-code and codex draw in their gutters. dropped from both sides, so a
// symmetric drop can never cost us a match.
const DROP_CHARS = new Set(
  ("*`" + "⏺⎿·•▪▸│─╭╮╰╯✓✗✔✘→›❯■◆☐☑").split(""),
);

const SHINGLE_WORDS = 5;
const MAX_SHINGLES = 48;
const MIN_PARTIAL_SCORE = 0.2;
const MIN_NEEDLE_CHARS = 3;
export const MAX_NEEDLE_CHARS = 8_000;
const EXCERPT_PAD = 60;
const EXCERPT_MAX = 220;

/** index of the last char of the escape sequence starting at src[i] (which is
 * ESC), so the caller's loop can i++ past it. */
function skipAnsi(src: string, i: number): number {
  const next = src[i + 1];
  if (next === "[") {
    let j = i + 2;
    while (j < src.length) {
      const c = src.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) return j; // final byte
      j++;
    }
    return src.length - 1;
  }
  if (next === "]") {
    let j = i + 2;
    while (j < src.length) {
      if (src[j] === "\x07") return j;
      if (src[j] === "\x1b" && src[j + 1] === "\\") return j + 1;
      j++;
    }
    return src.length - 1;
  }
  return i;
}

// one char scan — never regex pre-passes, those would desync the index map.
export function normalize(src: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpaceAt = -1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "\x1b") {
      i = skipAnsi(src, i);
      continue;
    }
    // \s minus the escape we already handled
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v" || ch === " ") {
      if (pendingSpaceAt < 0) pendingSpaceAt = i;
      continue;
    }
    if (DROP_CHARS.has(ch)) continue;
    if (pendingSpaceAt >= 0) {
      // leading whitespace produces no space (out is still empty)
      if (out.length > 0) {
        out.push(" ");
        map.push(pendingSpaceAt);
      }
      pendingSpaceAt = -1;
    }
    // toLowerCase can widen a char (e.g. "İ") — one map entry per emitted char
    const lower = ch.toLowerCase();
    for (let k = 0; k < lower.length; k++) {
      out.push(lower[k]!);
      map.push(i);
    }
  }

  return { norm: out.join(""), map };
}

/** the normalized needle, or "" when the paste is too short to search on. */
export function normalizeNeedle(text: string): string {
  const clipped = text.length > MAX_NEEDLE_CHARS ? text.slice(0, MAX_NEEDLE_CHARS) : text;
  const { norm } = normalize(clipped);
  return norm.length >= MIN_NEEDLE_CHARS ? norm : "";
}

function buildShingles(needleNorm: string): string[] {
  const words = needleNorm.split(" ").filter(Boolean);
  if (words.length < SHINGLE_WORDS) return [];
  const all: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    all.push(words.slice(i, i + SHINGLE_WORDS).join(" "));
  }
  if (all.length <= MAX_SHINGLES) return all;
  // sample evenly rather than taking a prefix — a clipped head shouldn't
  // decide the whole score.
  const step = all.length / MAX_SHINGLES;
  const sampled: string[] = [];
  for (let i = 0; i < MAX_SHINGLES; i++) sampled.push(all[Math.floor(i * step)]!);
  return sampled;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** slice a readable window out of the ORIGINAL haystack around a normalized
 * match range. */
function excerptFor(src: string, hay: Normalized, normStart: number, normEnd: number): string {
  if (hay.map.length === 0) return "";
  const lastNorm = Math.min(normEnd, hay.map.length) - 1;
  const from = hay.map[Math.min(normStart, hay.map.length - 1)] ?? 0;
  const to = (hay.map[Math.max(lastNorm, 0)] ?? from) + 1;

  let lo = Math.max(0, from - EXCERPT_PAD);
  let hi = Math.min(src.length, to + EXCERPT_PAD);
  let body = collapse(src.slice(lo, hi));
  if (body.length > EXCERPT_MAX) {
    body = body.slice(0, EXCERPT_MAX).trimEnd();
    hi = src.length; // force the trailing ellipsis
  }
  return (lo > 0 ? "…" : "") + body + (hi < src.length ? "…" : "");
}

/** search one session's joined transcript text. `needleNorm` comes from
 * normalizeNeedle so it's normalized once per request, not once per session. */
export function searchHaystack(needleNorm: string, haystack: string): Hit | null {
  if (!needleNorm || !haystack) return null;
  const hay = normalize(haystack);
  if (!hay.norm) return null;

  const at = hay.norm.indexOf(needleNorm);
  if (at >= 0) {
    return {
      score: 1,
      kind: "exact",
      excerpt: excerptFor(haystack, hay, at, at + needleNorm.length),
    };
  }

  const shingles = buildShingles(needleNorm);
  if (shingles.length === 0) return null;

  let found = 0;
  let firstAt = -1;
  let firstLen = 0;
  for (const sh of shingles) {
    const j = hay.norm.indexOf(sh);
    if (j < 0) continue;
    found++;
    if (firstAt < 0 || j < firstAt) {
      firstAt = j;
      firstLen = sh.length;
    }
  }
  if (found === 0) return null;

  const score = found / shingles.length;
  if (score < MIN_PARTIAL_SCORE) return null;

  return {
    score,
    kind: "partial",
    excerpt: excerptFor(haystack, hay, firstAt, firstAt + firstLen),
  };
}
