# Curated chat preset chips (per language)

**Date:** 2026-07-09
**Branch:** `feat/multilingual-qa-and-session-summaries`
**Status:** approved design, pending implementation plan

## Problem

To ask the Q&A assistant something, the user must type it. Common asks
("summarize", "explain simply", "what happened here", "what should I answer")
are the same every time and should be one tap — a curated list of preset prompts
to pick from, alongside the free-text box.

## Key finding: the mechanism already exists

`renderChatInput` in `public/index.html` already builds a `.chat-quickreplies`
row of `.quick-pill` buttons. A pill carries its text in `data-quick`; clicking
it routes through the shared `sendChatText` → `POST /chat/send` path (send
immediately, no edit step). Today it renders exactly two pills — `ui().next`
("next") and `ui().more` ("explain more") — and only after a conversation has
started (`threadStarted`).

This feature **extends that existing mechanism**; it does not add a new one.

## Scope (decisions locked during brainstorming)

- **Click = send immediately** (the existing pill behavior).
- **Always visible** — a compact chip row above the ask box, from the empty
  state onward (drop the `threadStarted` gate).
- **Static, per language** — no dynamic generation. A curated set lives in code,
  keyed by language, and swaps with the language pill.
- **Frontend-only** — reuses `/chat/send`; no backend changes.
- The curated set **replaces** the current `next` / `explain more` pills.
- The free-text ask box is unchanged (the "type something" path).

## The curated set

Four presets per language, added as a `presets` array on each entry of the
existing `UI_STRINGS` map. Each preset is `{ key, label }`; the `label` is both
the chip text and the message sent.

| key | he | en | ar | es | fr | ru | de | zh |
|---|---|---|---|---|---|---|---|---|
| summarize | תסכם | summarize | لخّص | resume | résume | кратко | zusammenfassen | 总结 |
| explainSimply | הסבר במילים פשוטות | explain simply | اشرح ببساطة | explícalo simple | explique simplement | объясни просто | einfach erklären | 简单解释 |
| whatHappened | מה קרה כאן? | what happened here? | ماذا حدث هنا؟ | ¿qué pasó aquí? | que s'est-il passé ? | что здесь произошло? | was ist passiert? | 这里发生了什么？ |
| whatReply | מה לענות? | what should I answer? | بماذا أرد؟ | ¿qué respondo? | que répondre ? | что ответить? | was soll ich antworten? | 该怎么回复？ |

`whatReply` is phrased as "what should I answer" so the assistant's `systemIntro`
rule fires and it wraps a suggested reply in a fenced `to-agent` block — the chip
is a one-tap path to the app's copy-a-reply feature.

## Design

All changes in `public/index.html`:

1. **Data.** Add `presets: [{key,label}, …]` (4 entries) to each language object
   in `UI_STRINGS` (he, en, ar, es, fr, ru, de, zh). `ui().presets` yields the
   active-language set (fallback to `he`).

2. **Render.** In `renderChatInput`, build the `.chat-quickreplies` row from
   `ui().presets` **unconditionally** (remove the `threadStarted` gate and the
   two hard-coded `next`/`more` pills). Reuse the existing `.quick-pill` markup,
   styles, and the `data-quick` = label convention. Add `dir="auto"` to each
   chip so Hebrew/Arabic render RTL.

3. **Click path.** Unchanged — the existing pill click handler reads `data-quick`
   and calls `sendChatText(label, pill)`, which disables the pills in-flight and
   posts to `/chat/send`.

4. **Language swap.** Already handled — the language `change` listener calls
   `refresh()`, which re-runs `renderChatInput`, so the chips re-render in the
   new language. No extra wiring.

5. **Cleanup.** The `next` / `explain more` keys in `UI_STRINGS` become unused;
   remove them to avoid dead strings (they are referenced nowhere else).

## Non-goals

- No backend changes; no new routes or ws messages.
- No dynamic/generated prompts; the set is static per language.
- No per-session or persisted preset customization.
- No change to the free-text ask box, the send path, or the `to-agent` copy card.

## Testing / verification

- `bun run typecheck` clean.
- Serve on a throwaway port (`META_PORT=3943`+, **never** :3737).
- Via `evaluate_script` (browser is wedged — no screenshots):
  - the chip row renders **4** chips from the empty state (no message needed);
  - chips show the active language's labels and re-render after a language change;
  - a chip click posts to `/chat/send` with the chip's label as `text`;
  - Hebrew/Arabic chips render RTL.

## Gotchas to respect

- `public/index.html` has literal `0x01` bytes — search with `grep -a`/`awk`;
  `Edit` cannot match multi-line `old_string` spanning those lines. Edit the clean
  lines around `UI_STRINGS` / `renderChatInput`.
- Never bind :3737.
- DOM checks via `evaluate_script`, not screenshots.
