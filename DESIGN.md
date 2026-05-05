---
name: chunk-to-chat
description: a quiet console for long autonomous agent runs
colors:
  ink: "#1a1a1f"
  ink-soft: "#6e6e7a"
  pewter: "#9090a0"
  paper: "#fafafb"
  surface: "#ffffff"
  hairline: "#e7e7ec"
  hairline-strong: "#d4d4dd"
  chip-tint: "#f3f3f7"
  signal-indigo: "#6366f1"
  signal-indigo-deep: "#4f52e0"
  signal-indigo-tint: "#eef0fe"
  live-coral: "#ef5e5e"
  live-coral-tint: "#fdecec"
  console-ground: "#15151c"
  console-ink: "#e5e5ee"
  console-prompt: "#a8aafd"
  console-soft: "#65657a"
  diff-green: "#10b981"
  diff-red: "#ef4444"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
  micro:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "9px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  console:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
rounded:
  hairfine: "3px"
  input: "6px"
  card: "8px"
  console: "10px"
  panel: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "56px"
components:
  button-primary:
    backgroundColor: "{colors.signal-indigo}"
    textColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "22px 24px"
    typography: "body"
  button-primary-hover:
    backgroundColor: "{colors.signal-indigo-deep}"
    textColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "22px 24px"
  button-send:
    backgroundColor: "{colors.signal-indigo}"
    textColor: "{colors.surface}"
    rounded: "{rounded.input}"
    width: "40px"
    height: "40px"
  card-session:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  card-session-selected:
    backgroundColor: "{colors.signal-indigo-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px 24px"
  terminal:
    backgroundColor: "{colors.console-ground}"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.console}"
    padding: "18px 22px"
    typography: "console"
  chat-slot:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px 14px"
  chat-textarea:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "8px 10px"
  model-tag:
    backgroundColor: "{colors.chip-tint}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.hairfine}"
    padding: "2px 6px"
    typography: "micro"
---

# Design System: chunk-to-chat

## 1. Overview

**Creative North Star: "The Quiet Console"**

A console that watches several agents at once on a side monitor and almost never asks for attention. When something genuinely matters, it's unmistakable; the rest of the time, it sits like a status light on the desk: present, undemanding, glanceable from across the room.

The system inherits its texture from the terminal next to it. Mono type for anything the agent emits or that operates as a label; system sans only for the prose layer wrapped around it. The page is light, thin-bordered, mostly hairlines and quiet greys; saturation appears in two places only — the indigo signal that names the active agent, and the coral that flags the *latest* turn worth looking at. Dark surfaces appear exactly once, in the terminal block, where the text is literally being echoed from a process.

This explicitly rejects: dashboard density (Datadog / Grafana grids of identical panels), hero-metric SaaS templates, AI-app aesthetics (gradient blobs, glassmorphism, ✨ sparkle), corporate landing-page chrome (cream + black, hero + CTA stacks), and notification-bait (pulses, red dots, attention-stealing motion when nothing has actually changed).

**Key Characteristics:**
- Light surface, hairline borders, almost no shadow
- Saturated color used ≤10% of any view, in two roles only (indigo = signal; coral = latest)
- Type hierarchy carried by mono for instruments, sans for prose
- Density rhythm: tight inside cards, generous between sections
- Flat by default; the only colored shadow in the system is on the primary CTA

## 2. Colors

The palette is a tinted-neutral light page with two semantic accents and a single dark surface for terminal output. **Restrained color strategy**: the accents collectively cover well under 10% of any view; their rarity is what makes them legible.

### Primary
- **Signal Indigo** (`#6366f1`): the one color that names "the agent's voice" across the system. Used for the active turn's output bars, the selected session card, the primary CTA, the textarea focus ring, the `›` send button. If something is indigo, the agent did it.
- **Signal Indigo Deep** (`#4f52e0`): hover/pressed state for indigo surfaces.
- **Signal Indigo Tint** (`#eef0fe`): background tint for the selected session card and observer-insight callout.

### Secondary
- **Live Coral** (`#ef5e5e`): reserved exclusively for the *latest* turn's output bar in the complexity chart. Coral is "this just happened" and nothing else. Never decoration; never a CTA; never a divider.
- **Live Coral Tint** (`#fdecec`): paired tint, currently used by the legacy `.heavy` badge and held in reserve for future "needs immediate attention" surfaces.

### Tertiary
- **Diff Green** (`#10b981`) and **Diff Red** (`#ef4444`): used only on the lines-added / lines-removed bars in the code-changes chart. These are *data colors*, not UI colors. They never appear in chrome, copy, badges, or borders.

### Neutral
- **Ink** (`#1a1a1f`): primary text on the light page.
- **Ink Soft** (`#6e6e7a`): secondary text — source/elapsed lines, "what happened so far" muted prose, back link.
- **Pewter** (`#9090a0`): tertiary text — section labels, kv keys, axis ticks, badge muted, chart axis numbers. Anything labeling rather than reading.
- **Paper** (`#fafafb`): page background. Slightly cooler than the surface so panels lift without needing shadow.
- **Surface** (`#ffffff`): card and panel background.
- **Hairline** (`#e7e7ec`): default 1px border on every card, panel, chart axis.
- **Hairline Strong** (`#d4d4dd`): used on dashed empty-state outlines and the chat textarea border.
- **Chip Tint** (`#f3f3f7`): the model-tag pill background; the only neutral fill that isn't paper or surface.

### Console
- **Console Ground** (`#15151c`): the terminal block's dark surface. Appears exactly once per session detail, framing the latest model output.
- **Console Ink** (`#e5e5ee`): terminal body text.
- **Console Prompt** (`#a8aafd`): the `$ ` prompt character — a desaturated indigo cousin so the terminal feels related to the rest of the system without being noisy.
- **Console Soft** (`#65657a`): muted in-terminal text (e.g. "no output yet").

### Named Rules

**The One Voice Rule.** Indigo is the agent's voice. It appears on the active output bar, the selected session card, the primary CTA, and the send button. Nothing else. Never use indigo as a divider, a hover tint on an unrelated surface, a heading underline, or decoration.

**The Latest-Only Coral Rule.** Coral marks the most recent turn in the complexity chart and nothing else. The moment a newer turn arrives, the coral bar reverts to indigo. Coral does not appear in chrome, alerts, badges, or copy. Its scarcity is what makes it readable from across the desk.

**The Data-Color Quarantine Rule.** Diff Green and Diff Red live inside the code-changes chart only. They are not in the design system; they are in the chart. Do not extend them into status pills, success/error toasts, or any other UI surface.

## 3. Typography

**Display Font:** system sans stack (`-apple-system, BlinkMacSystemFont, Inter, Segoe UI`).
**Body Font:** same system sans.
**Label / Mono Font:** system mono stack (`ui-monospace, SF Mono, Menlo, Consolas`).

**Character:** a single sans for the prose layer paired with a single mono for everything that reads as instrumentation. There is no display family; the largest text on the page is 26px sans at weight 600. The personality lives in the contrast between the two stacks, not in any one font's flourish.

### Hierarchy
- **Display** (600, 26px, line-height 1.2, letter-spacing −0.02em): the page H1 (`chunk-to-chat`) and the per-session H2. The only sizes large enough to be read from a meter away.
- **Title** (600, 13px, line-height 1.4, letter-spacing −0.01em): card session names. Truncated with ellipsis; never wraps.
- **Body** (400, 15px, line-height 1.6): all running prose, `prose` blocks, observer insight text, chat slot context. Capped naturally at the 1280px layout width; single-column reading lengths inside panels stay under 75ch.
- **Label** (mono, 500, 11–12px, letter-spacing 0.06em, uppercase): section labels, panel labels, "review load" lead-in, kv keys. Mono signals "this is chrome, not content."
- **Micro** (mono, 500, 9px, letter-spacing 0.08em, uppercase): badges, model tags, observer's `obs` label, observer tag list, chart axis numbers. Anything that has to fit inside an 8px-tall pill.
- **Console** (mono, 400, 13px, line-height 1.65): terminal block body. The only place mono runs at body sizes; the only place text is white-on-dark.

### Named Rules

**The Two-Stack Rule.** Sans for prose, mono for instruments. The contrast between them is the entire type system; do not add a third family, an italic display, or a script. Hierarchy comes from scale and weight inside each stack.

**The Mono-Means-Chrome Rule.** When something is in mono on the light surface, it is operating as instrumentation: a label, a tag, an axis, a key, an elapsed time. Body prose is sans even when it describes mono concepts. The terminal block is the one exception: there, mono is the content because the underlying source is.

**The All-Caps Stays Tiny Rule.** Uppercase tracking is reserved for ≤12px labels. Headings are mixed case at sentence weight. There is no uppercase H1, H2, or button label anywhere in the system.

## 4. Elevation

The system is essentially flat. Depth comes from the page-vs-surface contrast (`Paper` behind `Surface`) and from a single hairline border on every card and panel. Cards do not lift on hover; selection is signaled by a tint and a colored border, not by a shadow.

The one exception is the primary CTA, which carries a soft indigo-tinted ambient shadow at rest and a slightly larger shadow on hover with a 1px translateY. The CTA is the only element in the system that is allowed to rise off the page, and it does so because its job is to be unmistakable from any viewing angle.

The terminal block does not lift; it sits flush, distinguished by surface color (`Console Ground`) and corner radius rather than elevation.

### Shadow Vocabulary
- **CTA Ambient** (`box-shadow: 0 6px 20px -10px rgba(99, 102, 241, 0.5)`): default state of `.cta` and equivalents. The only colored shadow in the system; tints toward indigo because the surface it lifts is indigo.
- **CTA Lifted** (`box-shadow: 0 10px 28px -12px rgba(99, 102, 241, 0.6)`): hover state for the same.

### Named Rules

**The Flat-By-Default Rule.** No surface lifts unless it is the primary call to action. Cards, panels, chat slots, the terminal, observer insights — all sit flush. If you find yourself reaching for a shadow to "make something pop," step back: the answer is contrast (Paper vs Surface), border weight, or — usually — removing whatever is competing with it.

**The Tinted-Shadow Rule.** When a shadow does appear, it carries the surface's hue, not pure black. The CTA shadow is rgba indigo, not rgba neutral. Pure-black shadows on a tinted-neutral page read as cheap.

## 5. Components

### Buttons
- **Shape:** primary CTA at panel radius (12px); send button at input radius (6px). Never pill-shaped, never square-cornered.
- **Primary CTA:** Signal Indigo background, white text, 22px / 24px padding, body-sized type at weight 500. Carries the only ambient shadow in the system. Hover deepens to Signal Indigo Deep, lifts 1px, and grows the shadow.
- **Send Button (`›`):** 40×40px square at input radius, Signal Indigo, white glyph at 18px / 600. Sits in the same row as a chat textarea, both stretching to the same height. Disabled state collapses to Hairline Strong background with Ink Soft text.
- No secondary, ghost, or tertiary button exists. Every actionable surface is either the CTA or the send button. If a third button type appears, the design has drifted; redesign instead of adding.

### Cards (Session Cards in the Sidebar)
- **Corner Style:** 8px (smaller than panel; cards live inside the system, panels frame it).
- **Background:** Surface at rest; Signal Indigo Tint when selected.
- **Border:** 1px Hairline; transitions to Signal Indigo on hover and on selected.
- **Padding:** 10px / 12px — deliberately tight; this is a sidebar inbox, not a feature card grid.
- **Internal layout:** title row (name + model tag), source line in mono, optional observer insight callout, kv rows for items / tokens.
- **No shadow, no scale, no animation on hover beyond the border-color change.** Selection is the only state worth a tint.

### Panels (Detail Pane)
- **Corner Style:** 12px.
- **Background:** Surface.
- **Border:** 1px Hairline.
- **Padding:** 22px / 24px — generous compared to cards; panels are read, cards are scanned.
- **Internal labels:** uppercase mono at 11px, Pewter, 10px bottom margin.
- **Subdivisions** within a panel use a dashed 1px Hairline border, not a solid border — to read as "same panel, separate idea" rather than "next thing."

### Terminal Block
- **Surface:** Console Ground (`#15151c`); Console Ink (`#e5e5ee`) text; Console Prompt (`#a8aafd`) for the `$ ` prefix; Console Soft for the empty placeholder.
- **Type:** Console role (mono, 13px, 1.65 line-height).
- **Padding:** 18px / 22px.
- **Radius:** 10px — slightly less than panels, slightly more than cards. Sits between the two visually; not a panel, not a card, a literal terminal pane.
- **Scrolls vertically up to 360px max-height.** Never auto-scrolls to bottom on update by reflex; that's a future decision.
- **Wrapping:** `white-space: pre-wrap; word-break: break-word`. Lines wrap; long unbroken tokens (paths, hashes) break.

### Chat Slot
- **Container:** Surface, Hairline border, 12px radius, 12px / 14px padding. One per flagged turn.
- **Context line:** 12px Ink Soft prose with optional 10px mono Pewter tags appended.
- **Textarea:** Paper background (so it sits *into* the slot, not on top), Hairline Strong border, 6px radius, 8px / 10px padding, 14px / 1.5 type, min-height 40px, vertically resizable. On focus, border becomes Signal Indigo and background flips to Surface.
- **Send button:** 40×40px Signal Indigo square (see Buttons), `›` glyph, sits flush right at the same height as the textarea's min-height.
- **Sent indicator:** small 12px italic Ink Soft text below the row. No checkmark, no green pill.

### Observer Insight (Callout)
- **Container:** Signal Indigo Tint background, hairfine (3px) radius, ~6px / 8px padding, 11px Ink prose.
- **Label:** 9px mono uppercase Signal Indigo, prefixing the insight text.
- **Tag list:** 9px mono Pewter, on a second line.
- **Legacy:** the current implementation includes a 2px Signal Indigo `border-left` stripe. **This violates The No-Side-Stripe Rule** (see Don'ts) and is scheduled for removal at the next critique pass. Going forward: full border, background tint, and the leading mono label carry the role.

### Model Tag (Pill)
- **Style:** Chip Tint background, Ink Soft text, 9px mono uppercase 0.08em tracking, 2px / 6px padding, hairfine 3px radius.
- **Role:** identifies the underlying model on a session card. Truncates if too wide; never wraps.

### Charts (Turn Complexity, Code Changes)
- **Frame:** no panel container; sits directly on Paper. Y-axis at left in mono Pewter ticks; X-axis baseline + left axis at 1px Hairline; one dashed Hairline mid-line for the 50% gridline.
- **Bars:** input bar in Pewter at 0.55 opacity (so it reads as background), output bar in Signal Indigo at 0.9 opacity, *latest* output bar in Live Coral at 1.0 opacity. The system has zero other uses for opacity-as-meaning.
- **Code-changes bars:** Diff Green for added, Diff Red for removed, both at 0.9 opacity. The chart is suppressed entirely if all turns have zero changes; do not render an empty chart.
- **Width-stable bars:** every bar is 14px wide. Do not vary bar width to encode meaning; the bar's height is the only axis.

### Empty States
- **Style:** italic 13px Ink Soft text on a 1px dashed Hairline Strong outline at panel radius, 24–32px padding, centered.
- **Voice:** lowercase, dry, never apologetic. "select a session" not "Please select a session to begin." "no active session detected — start claude code in a project" not "Looks like nothing's running yet!"

## 6. Do's and Don'ts

### Do:

- **Do** carry indigo as the agent's one voice. If you're tempted to add an indigo divider, indigo heading, or indigo decoration somewhere outside the active turn / selected card / CTA / send button, reach for Pewter or Hairline instead.
- **Do** keep coral reserved for "this just happened" — exclusively the latest turn's output bar in the complexity chart.
- **Do** use mono for every label, axis, tag, key, elapsed time, and badge; sans for prose. Mono signals "instrumentation."
- **Do** use 1px hairline borders to separate cards, panels, charts. The borders are the structure.
- **Do** keep dashed borders for empty states and intra-panel subdivisions only.
- **Do** stay flat. If you reach for a shadow, ask whether contrast or whitespace would do the work instead. The CTA's tinted shadow is the only shadow in the system, and it earned its place.
- **Do** render the code-changes chart only when there's something to render. An empty chart is worse than no chart.
- **Do** keep the terminal block as the one dark surface in any view. If a second dark surface appears, the design has drifted.
- **Do** write all UI copy in lowercase, in the dry-with-a-wink voice of `notes/state.md` and the in-code conventions. Capitalized headings are not the personality.

### Don't:

- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent on cards, panels, callouts, alerts, or list items. The current `.observer-insight` does this and is in violation; do not propagate the pattern, and rewrite that one element with a full border + background tint instead.
- **Don't** introduce gradient text (`background-clip: text`), glassmorphism (backdrop-filter blur on cards), or pure `#000` / `#fff` neutrals. Use the named neutrals; they are tinted toward the page hue on purpose.
- **Don't** ship the **hero-metric template** (big number, small label, supporting stats, gradient accent). PRODUCT.md names this as an anti-reference; the visual system enforces it by giving you no display-large numeric type.
- **Don't** ship **Datadog / Grafana density** (rows of identical panels, gauges-because-gauges). The two charts that exist are load-bearing; do not multiply them.
- **Don't** ship **AI-app aesthetic** (gradient blobs, pastel "calm" tones, ✨ sparkle copy, "your AI assistant" tone). The accent vocabulary is two solid colors, full-stop.
- **Don't** bring back severity badges, side-stripe alert cards, or sidebars-of-sidebars. They were ripped out for a reason; the legacy `.badge.light/.medium/.heavy` CSS is scheduled for deletion.
- **Don't** ship **notification-bait**: pulsing dots, growing counters, color-changing favicon, attention animations when nothing has actually changed. The contrast between idle and active is the loudest thing in the UI; do not erode it.
- **Don't** add a third button type. Primary CTA and send button cover every action. If a flow needs a "secondary" or "ghost" button, redesign the flow instead.
- **Don't** capitalize headings, badge text, or button labels. Lowercase is the voice.
- **Don't** animate layout properties (width, height, top, padding). State changes use opacity and transform only; transitions cap at 200ms with an ease-out curve.
- **Don't** extend Diff Green or Diff Red beyond the code-changes chart. They are data colors, not status colors. There are no green success pills or red error pills in this system.
