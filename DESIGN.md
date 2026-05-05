---
name: cut-the-cake
description: a strawberry-trimmed console for long autonomous agent runs
colors:
  ink: "#1a1a1f"
  ink-soft: "#6e6e7a"
  pewter: "#9090a0"
  paper: "#fdf9fa"
  surface: "#ffffff"
  hairline: "#efe8eb"
  hairline-strong: "#dcd2d6"
  chip-tint: "#f5eef1"
  strawberry: "#ec4899"
  strawberry-deep: "#db2777"
  strawberry-tint: "#fce7f3"
  plum: "#a855f7"
  plum-tint: "#f3e8ff"
  glass-paper: "rgba(253, 249, 250, 0.72)"
  console-ground: "#15151c"
  console-ink: "#e5e5ee"
  console-prompt: "#f9a8d4"
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
  input: "8px"
  card: "10px"
  console: "10px"
  panel: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "56px"
components:
  top-nav:
    backgroundColor: "{colors.glass-paper}"
    backdropFilter: "blur(12px) saturate(140%)"
    borderBottom: "1px solid {colors.hairline}"
    height: "56px"
    padding: "0 24px"
    sticky: true
  github-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline-strong}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
    typography: "title"
  button-primary:
    backgroundColor: "{colors.strawberry}"
    textColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "12px 18px"
    typography: "body"
  button-primary-hover:
    backgroundColor: "{colors.strawberry-deep}"
  button-send:
    backgroundColor: "{colors.strawberry}"
    textColor: "{colors.surface}"
    rounded: "{rounded.input}"
    width: "44px"
    height: "44px"
    glyph: "rocket"
  card-session:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  card-session-selected:
    backgroundColor: "{colors.strawberry-tint}"
    borderColor: "{colors.strawberry}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px 24px"
  banner-backdrop:
    image: "/assets/header-banner-cake-clouds.webp"
    placement: "session-summary panel, right edge, tapered into negative space"
    opacity: 1
  mascot-avatar-active:
    image: "/assets/mascot-cupcake-wand.webp"
    size: "64px"
  mascot-avatar-idle:
    image: "/assets/mascot-cupcake-fork.webp"
    size: "64px"
  empty-state-illustration:
    image: "/assets/empty-state-cake-duo.webp"
    size: "320px"
  send-rocket:
    image: "/assets/send-button-rocket.webp"
    size: "28px"
  terminal:
    backgroundColor: "{colors.console-ground}"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.console}"
    padding: "18px 22px"
    typography: "console"
  chat-textarea:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
  tag-chip:
    backgroundColor: "{colors.strawberry-tint}"
    textColor: "{colors.strawberry-deep}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
    typography: "label"
  model-tag:
    backgroundColor: "{colors.chip-tint}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.hairfine}"
    padding: "2px 6px"
    typography: "micro"
---

# Design System: cut-the-cake

## 1. Overview

**Creative North Star: "The Patisserie Press."**

A precision instrument that wears strawberry. The page is a near-white cream surface with hairline structure; saturation arrives in two roles: **strawberry** as the operative voice (active, latest, send) and **plum** as the agent's voice in the charts. Five — and only five — places carry illustration: the logo, the live-session avatar, the welcome banner, the empty state, and the send rocket. Everything else stays close to the quiet greys it inherited from the prior system.

The terminal block remains the single dark surface in the page, untouched. It is the seriousness anchor the rest of the design leans against.

The system explicitly rejects: the kawaii-AI dashboard cliché (mascots and sparkles slathered over every surface), pastel "calm" AI palettes, gradient blobs and ambient glow, glassmorphism as a default texture, and notification-bait motion. Strawberry is *committed*, not *calm*; whimsy is *concentrated*, not *atmospheric*.

**Key Characteristics:**
- Cream-tinted surface, hairline borders, almost no shadow except on the primary CTA.
- Strawberry covers ≤10% of any view; plum appears only inside the complexity chart.
- Type hierarchy carried by mono for instruments, sans for prose. No display family.
- Density rhythm: tight inside cards, generous between sections.
- One frosted glass surface in the system: the sticky top nav. Not two.
- One dark surface in the system: the terminal block. Not two.

## 2. Colors

OKLCH-aware palette. Strawberry strategy: **committed** for the brand voice, *restrained* in deployment. The two accents collectively cover well under 10% of any view; their rarity makes them legible.

### Primary

- **Strawberry** (`#ec4899`): the operative voice. Wordmark, live border, selected card border, focus rings, primary CTA, send-button surface, *latest* output bar in the complexity chart, tag-chip text. If something is strawberry, it is acting (running, just-happened, do-this-now).
- **Strawberry Deep** (`#db2777`): hover/pressed state for strawberry surfaces.
- **Strawberry Tint** (`#fce7f3`): selected-card background, tag-chip background, observer-insight callout background.

### Secondary

- **Plum** (`#a855f7`): the agent's voice inside data. Used exclusively as the agent (output) bar in the turn-complexity chart, paired with strawberry input bars and the brighter strawberry "latest" bar. Plum does not appear in chrome, copy, or buttons — it is a chart-only accent the way Diff Green and Diff Red are.
- **Plum Tint** (`#f3e8ff`): held in reserve for a future "background plum" use; not currently shipping.

### Tertiary (data colors only)

- **Diff Green** (`#10b981`) and **Diff Red** (`#ef4444`): used only on the lines-added / lines-removed bars in the code-changes chart. Quarantined.

### Neutral

- **Ink** (`#1a1a1f`): primary text on the cream page.
- **Ink Soft** (`#6e6e7a`): secondary text — source/elapsed lines, "what happened so far" muted prose, back link.
- **Pewter** (`#9090a0`): tertiary text — section labels, kv keys, axis ticks. Anything labeling rather than reading.
- **Paper** (`#fdf9fa`): page background. A whisper of pink keeps the cream warm and gives strawberry a native context.
- **Surface** (`#ffffff`): card and panel background.
- **Hairline** (`#efe8eb`): default 1px border. Tinted toward the page hue, not pure grey.
- **Hairline Strong** (`#dcd2d6`): dashed empty-state outlines, chat textarea border at rest.
- **Chip Tint** (`#f5eef1`): model-tag pill background; the only neutral fill that isn't paper or surface.

### Glass

- **Glass Paper** (`rgba(253, 249, 250, 0.72)`): semi-translucent paper used by the sticky top nav exactly. The only translucent fill in the system.

### Console

- **Console Ground** (`#15151c`): the terminal block. Appears exactly once per session detail.
- **Console Ink** (`#e5e5ee`): terminal body text.
- **Console Prompt** (`#f9a8d4`): the `$ ` prompt — desaturated strawberry so the terminal feels related to the rest of the system without competing.
- **Console Soft** (`#65657a`): muted in-terminal text.

### Named Rules

**The One Voice Rule.** Strawberry is the operative voice. It appears on the wordmark, the active session card border, the latest output bar, the primary CTA, the send button, focus rings, and tag-chip text. Nothing else. Do not use strawberry as a divider, a hover tint on an unrelated surface, a heading underline, or decoration.

**The Latest-Only Rule.** Two roles for "now": (1) strawberry on the *latest* output bar in the detail-pane complexity chart, replacing the prior coral scoping; (2) strawberry border on the *currently-selected* sidebar card. Anywhere else, "latest" is signalled by mono Pewter elapsed text ("now", "Xs ago"), not by color.

**The Plum Quarantine Rule.** Plum lives inside the turn-complexity chart only. It is the chart's "agent voice" against the chart's "user voice" (strawberry input). Plum does not extend into chrome, status pills, or anywhere outside that one chart.

**The Data-Color Quarantine Rule.** Diff Green and Diff Red live inside the code-changes chart only.

**The Single Glass Surface Rule.** The sticky top nav is the only element in the system that uses `backdrop-filter: blur`. Any second blur is a violation; do not blur cards, modals, popovers, or dropdowns. The reason blur is allowed at all is that page content scrolls under the nav, which is exactly the textbook purposeful case.

## 3. Typography

**Display Font:** system sans stack (`-apple-system, BlinkMacSystemFont, Inter, Segoe UI`).
**Body Font:** same system sans.
**Label / Mono Font:** system mono stack (`ui-monospace, SF Mono, Menlo, Consolas`).

A single sans for the prose layer paired with a single mono for everything that reads as instrumentation. There is no display family. The wordmark in the top nav is the same sans at weight 600 in strawberry; the personality lives in the color, not in a script face.

### Hierarchy

- **Display** (600, 26px, line-height 1.2, letter-spacing −0.02em): the page wordmark and the per-session H2.
- **Title** (600, 13px, line-height 1.4, letter-spacing −0.01em): card session names and the GitHub-pill label. Truncated with ellipsis; never wraps.
- **Body** (400, 15px, line-height 1.6): all running prose, observer insight text, chat slot context. Capped at 75ch inside panels.
- **Label** (mono, 500, 11–12px, letter-spacing 0.06em, uppercase): section labels, panel labels, kv keys.
- **Micro** (mono, 500, 9px, letter-spacing 0.08em, uppercase): badges, model tags, chart axis numbers.
- **Console** (mono, 400, 13px, line-height 1.65): terminal block body. The only place mono runs at body sizes; the only place text is white-on-dark.

### Named Rules

**The Two-Stack Rule.** Sans for prose, mono for instruments. No third family, no italic display, no script. Hierarchy comes from scale and weight inside each stack.

**The Mono-Means-Chrome Rule.** Mono on the cream surface = instrumentation. Body prose is sans even when it describes mono concepts. The terminal block is the one exception.

**The All-Caps Stays Tiny Rule.** Uppercase tracking reserved for ≤12px labels. Headings and the wordmark are mixed case at sentence weight.

## 4. Elevation

The system is essentially flat. Depth comes from page-vs-surface contrast (Paper behind Surface) and from a single hairline border on every card and panel. The two exceptions:

- **The primary CTA** carries a soft strawberry-tinted ambient shadow at rest and a slightly larger shadow on hover with a 1px translateY. Tinted toward strawberry because the surface is strawberry.
- **The sticky top nav** sits visually above the page via `backdrop-filter` + a 1px hairline along its bottom edge. No drop shadow.

The terminal block does not lift. Cards do not lift on hover.

### Shadow Vocabulary

- **CTA Ambient** (`box-shadow: 0 6px 20px -10px rgba(236, 72, 153, 0.55)`).
- **CTA Lifted** (`box-shadow: 0 10px 28px -12px rgba(236, 72, 153, 0.65)`).

### Named Rules

**The Flat-By-Default Rule.** Cards, panels, the terminal, observer insights all sit flush. If a shadow is needed to "make something pop," the answer is contrast or removal.

**The Tinted-Shadow Rule.** Shadows carry the surface's hue, not pure black. The CTA shadow is rgba strawberry.

## 5. Components

### Top Nav

- **Surface:** Glass Paper with `backdrop-filter: blur(12px) saturate(140%)`.
- **Sticky:** `position: sticky; top: 0; z-index: 10`.
- **Height:** 56px; padding 0 / 24px.
- **Bottom edge:** 1px Hairline. No drop shadow.
- **Left:** the cake-slice logo (24px) + "cut-the-cake" wordmark in Strawberry at Display 20px / 600 weight (smaller than the in-page H1 so the nav doesn't dominate).
- **Right:** GitHub pill — Surface background, Hairline Strong border, pill radius, 6px / 12px padding, `★ <count>` in Title type. Real `href` to the project repo. No hover lift; border darkens to Strawberry on hover.
- **No middle nav links** until the app gains real routes. When they arrive: active link gets a 2px Strawberry underline, others stay Ink.

### Logo

- **Source:** `logo-cake-slice.webp` at 96×96 source; rendered at 24–32px in the nav and at 32px in the favicon.
- **Background:** none — the asset has alpha; let it sit on the glass nav directly.

### Mascot Avatar

- **Active variant** (`mascot-cupcake-wand.webp`): appears in the *selected* sidebar card and tucked into the detail-pane header, at 64–80px.
- **Idle variant** (`mascot-cupcake-fork.webp`): replaces the active variant when the selected session has been idle ≥5 minutes.
- **Other sidebar cards:** no mascot. The mascot is a *selection signal*, not a per-card decoration. This is what keeps the asset use scarce.

### Banner Backdrop

- **Source:** `header-banner-cake-clouds.webp`.
- **Placement:** absolutely positioned at the right edge of the session-summary panel, tapering into negative space on the left so the summary text reads cleanly. `pointer-events: none`.
- **Opacity:** 1 — the asset's own taper does the fade; do not stack a CSS gradient mask.
- **Appearance gate:** only on the detail pane's first panel ("what happened so far"). Not behind charts, not behind chat input.

### Empty State

- **Source:** `empty-state-cake-duo.webp` rendered at 320–400px wide.
- **Placement:** centered in the detail pane when no session is selected; paired with the existing italic "select a session" copy.
- **Replaces:** the current dashed-outline panel.

### Buttons

- **Primary CTA:** Strawberry surface, white text, panel radius, 12px / 18px padding, body type at weight 500, CTA Ambient shadow.
- **Send Button (rocket):** 44×44px square, input radius, Strawberry surface, the `send-button-rocket.webp` asset rendered at 28px centered. Disabled state: surface flips to Hairline Strong, asset desaturates to 0.5 opacity.
- **GitHub Pill:** see Top Nav.
- No secondary, ghost, or tertiary button. CTA + send + nav pill is the entire button vocabulary.

### Cards (Session Cards in the Sidebar)

- **Corner Style:** card radius (10px).
- **Background:** Surface at rest; Strawberry Tint when selected.
- **Border:** 1px Hairline; Strawberry on hover and selected.
- **Padding:** 10px / 12px.
- **Internal layout:** title row (`[project] observer-name` + model tag), source line in mono, optional observer insight prose, foot line in mono Pewter (live / Xs ago / idle Xm).
- **Selected card:** the active mascot avatar tucks into the bottom-right corner at 64px, slightly clipped by the card's rounded corner so it reads as a peek, not a sticker.

### Panels (Detail Pane)

- **Corner Style:** panel radius (14px).
- **Background:** Surface.
- **Border:** 1px Hairline.
- **Padding:** 22px / 24px.
- **Internal labels:** uppercase mono at 11px, Pewter, 10px bottom margin. Optionally paired with a 16px outlined glyph in Strawberry (e.g. ⚡ for "break it down — one at a time").

### Terminal Block

Unchanged from the prior system. Console Ground surface, Console Ink text, Console Prompt for `$ `, Console Soft for placeholders. 18px / 22px padding, console radius (10px), max-height 360px, vertical scroll, pre-wrap.

### Chat Input (single per session)

- **Container:** Surface, Hairline border, panel radius, 12px / 14px padding.
- **Context line:** 12px Ink Soft prose with optional 10px mono Pewter tags appended.
- **Textarea:** Paper background (so it sits *into* the container), Hairline Strong border, input radius, 10px / 12px padding, 14px / 1.5 type, min-height 44px. On focus, border becomes Strawberry and background flips to Surface.
- **Send button:** 44×44px Strawberry square with the rocket asset (see Buttons).
- **Tip line:** 11px Pewter mono, below the input. e.g. "tip: ask for smaller steps, rationale, or alternatives" on the left; "⌘ ↵ to send" right-aligned.

### Tag Chip

- **Container:** Strawberry Tint background, Strawberry Deep text, pill radius, 4px / 10px padding.
- **Type:** Label (mono, 11px, uppercase 0.06em).
- **Use:** observer-emitted tags appended to the insight callout. *Not* used for status, severity, or anything else.

### Charts (Turn Complexity, Code Changes)

- **Frame:** no panel container; sits on Paper. Y-axis at left in mono Pewter ticks; X-axis baseline at 1px Hairline; one dashed Hairline mid-line.
- **Complexity bars:** input bar in Strawberry at 0.4 opacity, output bar in Plum at 0.85, *latest* output bar in Strawberry at 1.0 with a small "(latest count)w" callout pill above it.
- **Code-changes bars:** Diff Green for added, Diff Red for removed, both at 0.9 opacity. Suppressed entirely on zero changes.
- **Bar width:** 14px, fixed. The bar's height is the only encoding axis.

### Empty States (chrome-level)

- **Style:** italic 13px Ink Soft text on a 1px dashed Hairline Strong outline at panel radius, 24–32px padding, centered. Used for "no active session detected" in the sidebar.
- **Voice:** lowercase, dry, never apologetic.
- **Note:** the *detail-pane* empty state is the cake-duo illustration (see above), not a dashed outline.

## 6. Do's and Don'ts

### Do

- **Do** carry strawberry as the one operative voice. Treat any urge to add a strawberry divider, heading underline, or hover tint outside its allowed surfaces as a system drift — reach for Pewter or Hairline instead.
- **Do** keep plum inside the complexity chart only.
- **Do** keep the five mascot/illustration spots a hard count: logo, live-session avatar, welcome banner, empty state, send rocket. If a sixth lands, cut one of the five.
- **Do** let the terminal block stay unchanged. It is the seriousness anchor.
- **Do** keep mono for every label, axis, tag, key, elapsed time; sans for prose.
- **Do** stay flat. The CTA shadow and the nav blur are the only depth in the system.
- **Do** render the code-changes chart only when there's something to render.
- **Do** write all UI copy in lowercase, in the dry-with-a-wink voice.

### Don't

- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent. Full borders, background tints, leading icons — never side stripes.
- **Don't** introduce gradient text, gradient buttons, gradient borders, glassmorphism beyond the one nav surface, or pure `#000` / `#fff` neutrals.
- **Don't** ship the **hero-metric template**, **Datadog / Grafana density**, **AI-app aesthetic** (gradient blobs, ambient glow, "your AI assistant" tone), or **generic kawaii UI** (rounded geometric script faces, lavender + mint pastels, sticker-pack illustrations everywhere).
- **Don't** scatter mascots. They live in five named places. A mascot in a sixth place is an automatic fail.
- **Don't** add a third button type. CTA + send + GitHub pill covers everything.
- **Don't** capitalize headings, badge text, or button labels. Lowercase is the voice.
- **Don't** animate layout properties. State changes use opacity and transform, ≤200ms, ease-out.
- **Don't** extend Diff Green / Diff Red beyond the code-changes chart, and don't extend Plum beyond the complexity chart.
- **Don't** add notification-bait: pulsing dots, growing counters, tab-title flickers, attention animations when nothing has actually changed.
