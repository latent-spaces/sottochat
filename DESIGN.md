---
name: cut-the-cake
description: a strawberry-trimmed console for long autonomous agent runs
colors:
  fg: "#1a1a1f"
  fg-soft: "#6e6e7a"
  fg-muted: "#9090a0"
  bg: "#fdf9fa"
  surface: "#ffffff"
  border: "#efe8eb"
  border-strong: "#dcd2d6"
  chip-tint: "#f5eef1"
  accent: "#ec4899"
  accent-hover: "#db2777"
  accent-soft: "#fce7f3"
  plum: "#a855f7"
  glass-paper: "rgba(253, 249, 250, 0.72)"
  diff-green: "#10b981"
  diff-red: "#ef4444"
  session-strawberry: "#ec4899"
  session-peach: "#f97316"
  session-mint: "#10b981"
  session-blueberry: "#3b82f6"
  session-lavender: "#a855f7"
  session-honey: "#eab308"
  burst-pink: "#ec4899"
  burst-pink-light: "#f9a8d4"
  burst-plum: "#a855f7"
  burst-honey: "#fbbf24"
  burst-mint: "#5dd0c2"
  burst-blueberry: "#7c8cf0"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  wordmark:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "20px"
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
  conversation:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
  micro:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  tag:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "9px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  hairfine: "3px"
  input: "8px"
  card: "10px"
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
    textColor: "{colors.fg}"
    height: "56px"
    padding: "0 24px"
  nav-wordmark:
    textColor: "{colors.accent}"
    typography: "{typography.wordmark}"
  github-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
    typography: "{typography.title}"
  nav-toggle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
    typography: "{typography.title}"
  nav-toggle-on:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.fg}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  card-session:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  card-session-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  card-session-idle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-soft}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  model-tag:
    backgroundColor: "{colors.chip-tint}"
    textColor: "{colors.fg-soft}"
    rounded: "{rounded.hairfine}"
    padding: "2px 6px"
    typography: "{typography.tag}"
  chart-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.panel}"
    padding: "14px 16px 12px"
  chart-icon:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.input}"
    width: "28px"
    height: "28px"
  legend-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-soft}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
    typography: "{typography.label}"
  chat-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.panel}"
    padding: "14px 16px"
  chat-textarea:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
    typography: "{typography.conversation}"
  chat-textarea-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
  send-button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.input}"
    width: "44px"
    height: "44px"
  send-button-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.input}"
    width: "44px"
    height: "44px"
  chat-row-agent:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
    typography: "{typography.conversation}"
  chat-auto-tag:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "1px 6px"
    typography: "{typography.tag}"
  empty-inbox:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg-soft}"
    rounded: "{rounded.card}"
    padding: "32px 16px"
---

# Design System: cut-the-cake

## 1. Overview

**Creative North Star: "the patisserie press."**

a precision instrument that wears strawberry. the page is a near-white cream surface, hairline structure, almost no shadow. saturation arrives in two roles: **strawberry** as the operative voice (active, latest, send, focus) and **plum** as the agent's voice in the charts. ambient layers sit underneath: three large blurred radial blobs (warm pink + lavender) and a drift of small randomized sprinkles. the chrome carries dessert vocabulary, but only at named places.

each session is given its own dessert hue from a six-color palette (strawberry, peach, mint, blueberry, lavender, honey) hashed deterministically from `sessionId`. the per-session hue overrides `--accent` / `--accent-hover` / `--accent-soft` / `--plum` on that card and on the detail pane while it's open. brand chrome (top nav, gh-pill, send button outside any session scope) stays strawberry — the operative-voice rule applies unchanged inside each scope, the scope just rotates which hue is operative.

the system explicitly rejects: the kawaii-AI dashboard cliché (mascots and sparkles on every surface), pastel "calm" AI palettes, gradient blobs as a default texture, glassmorphism beyond the one nav surface, hero-metric SaaS templates, datadog/grafana density, severity badges, side-stripe alert cards, and notification-bait motion. strawberry is *committed*, not *calm*; whimsy is *concentrated*, not *atmospheric*.

**key characteristics:**
- cream-tinted surface, hairline borders, almost no shadow except the send-button CTA.
- two-monitor desk reading distance: chrome stays quiet, observer insight stays loud.
- per-session palette spreads the operative-voice role across six hues without losing strawberry as the brand voice.
- type is system sans for prose + system mono for instruments; no display family.
- one frosted glass surface in the system: the sticky top nav. one only.
- six concentrated places carry illustration or playful motion (enumerated in components); everywhere else stays close to the quiet greys.
- ambient layers (bg-blobs + sprinkle drift) sit behind everything but never above the cards. both honor `prefers-reduced-motion`.

## 2. Colors

a near-white cream surface plus one operative voice (strawberry) and one chart-only second voice (plum). per-session palette extends the operative-voice role across six dessert hues; data colors are quarantined.

### Primary

- **Strawberry** (`#ec4899`): the operative voice. wordmark, live border, selected-card border + tint, focus rings, send-button surface, "you" role label, brand jump-roll mark, default `--accent` outside any per-session scope. if something is strawberry, it is acting (running, just-happened, do-this-now).
- **Strawberry Deep** (`#db2777`): hover/pressed for strawberry surfaces.
- **Strawberry Tint** (`#fce7f3`): default `--accent-soft`. selected-card background, chart icon bubble, auto-tag pill, toggle-on background.

### Secondary

- **Plum** (`#a855f7`): the agent's voice. paired with strawberry-input bars in the complexity chart, used for the agent role label in the chat-thread block. quarantined to those two locations.

### Per-session palette (override Strawberry/Plum within scope)

- **Strawberry** (`#ec4899` accent, `#db2777` hover, `#a855f7` plum): default brand hue.
- **Peach** (`#f97316` accent, `#ea580c` hover, `#ec4899` plum).
- **Mint** (`#10b981` accent, `#059669` hover, `#14b8a6` plum).
- **Blueberry** (`#3b82f6` accent, `#2563eb` hover, `#818cf8` plum).
- **Lavender** (`#a855f7` accent, `#9333ea` hover, `#ec4899` plum).
- **Honey** (`#eab308` accent, `#ca8a04` hover, `#f97316` plum).

each session resolves to one of these via `djb2(sessionId) mod 6`, applied as inline `--accent` / `--accent-hover` / `--accent-soft` / `--plum` overrides on the card root and on `#detail-content` while open.

### Tertiary (data colors only)

- **Diff Green** (`#10b981`) and **Diff Red** (`#ef4444`): used only on the lines-added / lines-removed bars in the code-changes chart. quarantined.

### Neutral

- **Foreground / Ink** (`#1a1a1f`): primary text.
- **Foreground Soft** (`#6e6e7a`): secondary text. sources, elapsed lines, italic empty-state copy.
- **Foreground Muted / Pewter** (`#9090a0`): tertiary text. labels, axis ticks, foot lines, all mono labels.
- **Bg / Paper** (`#fdf9fa`): page background. a whisper of pink keeps the cream warm.
- **Surface** (`#ffffff`): card and panel background.
- **Border** (`#efe8eb`): default 1px hairline. tinted toward the page.
- **Border Strong** (`#dcd2d6`): empty-inbox dashed outline, textarea border at rest.
- **Chip Tint** (`#f5eef1`): model-tag pill, inline code background.

### Glass

- **Glass Paper** (`rgba(253, 249, 250, 0.72)`): semi-translucent paper used by the sticky top nav exactly. the only translucent fill in the system.

### Sprinkle burst palette

six fixed colors used inside the radial sprinkle-burst on frosted-bar hover, mixed in alongside ~60% bar-color sprinkles for variety: `#ec4899` strawberry, `#f9a8d4` light pink, `#a855f7` plum, `#fbbf24` honey, `#5dd0c2` mint, `#7c8cf0` blueberry. these are *animation tokens*, not chrome tokens. they appear only inside `.sprinkle-burst` particles during the 800ms burst lifetime.

### Named Rules

**The One Voice Rule.** within a per-session scope, the operative voice (`--accent`) is the session's hue. outside any session scope (top nav, gh-pill, send button, brand jump-roll), the operative voice is strawberry. nothing else gets to act as an operative voice. no second-accent dividers, no decorative-accent hover tints on unrelated surfaces, no heading underlines.

**The Per-Session Palette Rule.** the per-session palette overrides `--accent` / `--accent-hover` / `--accent-soft` / `--plum` only on the card root and on `#detail-content` while open. it does not extend to brand chrome. a peach-flagged card gets a peach insight border; the wordmark above it is still strawberry. brand voice is not session voice.

**The Plum Quarantine Rule.** plum lives in the turn-complexity chart's output bar (and its "latest" emphasis variant) and in the agent-role label of the chat-thread block. nowhere else.

**The Data-Color Quarantine Rule.** diff-green and diff-red live in the code-changes chart only.

**The Single Glass Surface Rule.** the sticky top nav is the only element that uses `backdrop-filter: blur`. any second blur is a violation. ambient `bg-blobs` use a `filter: blur(80px)` on the blob shapes themselves; that's a render filter, not a backdrop filter, and stays underneath the page.

## 3. Typography

**Display Font:** system sans stack (`-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif`).
**Body Font:** same system sans.
**Label / Mono Font:** system mono stack (`ui-monospace, SF Mono, Menlo, Consolas, monospace`).

a single sans for the prose layer, a single mono for everything that reads as instrumentation. no display family, no script, no italic display. the wordmark is the same sans at weight 600 in strawberry. personality lives in the color, not the typeface.

### Hierarchy

- **Display** (600, 26px, line-height 1.2, letter-spacing −0.02em): the per-session H2 in the detail pane. colored with `--accent` (the session's per-palette hue while one is selected).
- **Wordmark** (600, 20px, line-height 1.2, letter-spacing −0.02em): the top-nav `cut-the-cake` mark in strawberry. one size smaller than the H2 so the nav doesn't dominate.
- **Title** (600, 13px, line-height 1.4, letter-spacing −0.01em): card session names + gh-pill + nav-toggle. truncated with ellipsis, never wraps.
- **Body** (400, 15px, line-height 1.6): all running prose. capped at 75ch.
- **Conversation** (400, 14px, line-height 1.55): conversation strip + chat-thread + textarea. the conv-md markdown body lives at 78ch max.
- **Label** (mono, 500, 11px, letter-spacing 0.06em, uppercase): section labels (`sessions`), chart titles, chat-context glyph label (`break it down`), chat-tip text.
- **Micro** (mono, 500, 10px, letter-spacing 0.08em, uppercase): conversation role labels (`prev-agent`, `you`, `agent`), card foot text, chart axis ticks.
- **Tag** (mono, 500, 9px, letter-spacing 0.04em, lowercase): the model-tag pill on cards.

### Named Rules

**The Two-Stack Rule.** sans for prose, mono for instruments. no third family, no italic display, no script.

**The Mono-Means-Chrome Rule.** mono on the cream surface = instrumentation. body prose is sans even when it describes mono concepts.

**The All-Caps Stays Tiny Rule.** uppercase tracking is reserved for ≤11px labels. headings, the wordmark, button labels stay mixed case. the model-tag is the one exception — it's lowercase mono *with* tracking, so it reads as a code-like badge rather than a screaming caps pill.

## 4. Elevation

the system is essentially flat. depth comes from page-vs-surface contrast (bg behind surface) and a single hairline on every card and panel. exceptions:

- **the send button** carries a soft strawberry-tinted ambient shadow at rest and a slightly larger shadow on hover with a 1px translateY. tinted toward the surface's hue.
- **the sticky top nav** sits visually above the page via `backdrop-filter` plus a 1px hairline at its bottom edge. no drop shadow.
- **the cake-perch** mascot carries a soft `drop-shadow(0 3px 5px rgba(0,0,0,0.12))` so it reads as a physical thing perched on the surface, not a sticker.

cards do not lift on hover. panels do not lift.

### Shadow vocabulary

- **send-rest** (`box-shadow: 0 6px 20px -10px rgba(236, 72, 153, 0.55)`): ambient strawberry beneath the send button at rest.
- **send-hover** (`box-shadow: 0 10px 28px -12px rgba(236, 72, 153, 0.65)`): same color, larger spread, paired with `transform: translateY(-1px)` on hover.
- **cake-perch** (`drop-shadow(0 3px 5px rgba(0, 0, 0, 0.12))`): the only neutral-tinted shadow in the system. reads only when the mascot is on a colored surface (frosted bar, chart card edge).
- **toggle-on glow** (`box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 28%, transparent)`): a 3px soft ring around the toggle dot when auto-break-down is on. the only "ring" elevation on the page; reads as state-on, not as decoration.

### Named Rules

**The Flat-By-Default Rule.** cards, panels, charts, observer insights, and conversation rows all sit flush. if a shadow feels needed to "make something pop," the answer is contrast or removal.

**The Tinted-Shadow Rule.** when a shadow is genuinely required, it carries the surface's own hue. the send-button shadow is rgba strawberry; the toggle-on ring is `color-mix` against `--accent`.

## 5. Components

### Top nav

- **surface:** `glass-paper` with `backdrop-filter: blur(12px) saturate(140%)`. height 56px, padding 0 24px, sticky to the viewport top with a 1px hairline bottom.
- **left:** the cake-slice logo (`logo-cake-slice.webp`) at 32px + the wordmark at 20px / 600 in strawberry + a tagline ("turn long agent runs into a quick iterative chat") at 12px in fg-soft (hidden below 720px).
- **right:** reconnecting indicator (mono 11px, fg-muted, hidden by default) + auto-break-down toggle pill + github pill.
- **brand jump-roll:** hovering anywhere on `.nav-left` triggers a gsap timeline on the logo only — `y: -16` jumping out of `expo.out`, then `rotation: 360` planar spin in `power2.inOut`, then `y: 0` landing in `expo.out`. total ~1.3s. debounced via a `playing` flag so re-hovers don't stack. the wordmark itself does not move.

### Auto break-down toggle

- **shape:** pill (matches the gh-pill silhouette).
- **off:** surface bg + border-strong + a hairline-strong dot. label `auto break-down · off`.
- **on:** accent-soft bg + accent border + accent dot with a 3px `color-mix` ring around it. label `auto break-down`.
- **interaction:** click → POST `/chat/auto-send` → server flips the global flag → broadcast over ws → all connected clients re-paint. optimistic local flip on click; reverts on failure.

### GitHub pill

- **shape:** pill, surface bg, border-strong, 6px / 12px padding.
- **content:** `★` glyph (mono, color `#f4b942`) + a star count placeholder (`—` literal; real count not wired).
- **hover:** border darkens to `--accent`. no lift.

### Logo

- **source:** `logo-cake-slice.webp` at 96×96; rendered at 32px in the top-nav and as the page favicon.
- **transform-origin:** `50% 70%` so the brand jump-roll anchors at the cake's bottom edge.

### Sidebar inbox

- **layout:** sticky 320px column with a 1px rose-tint right border (`rgba(244, 114, 182, 0.10)`) and a barely-there top-down rose gradient (`rgba(252, 231, 243, 0.32) → 0` over 70% height). below 880px it collapses to a stacked column with the rose tint moving to a bottom border.
- **section label:** `sessions` in mono 11px Pewter, uppercase tracked.
- **empty inbox:** italic 13px fg-soft on a 1px dashed border-strong outline at card radius. message: `no active session detected — start claude code in a project`.
- **ambient quiet:** when every visible session is idle ≥5min and nothing's selected, the cards collapse to a single-line `quiet` mono note. mouse movement temporarily wakes the full list for 30s.

### Session card

- **shape:** card radius (10px), 10px / 12px padding, 1px hairline.
- **at rest:** `surface` background, hairline border. transitions: `border-color 400ms ease-out, background 200ms ease-out, opacity 400ms ease-out`.
- **hover:** border swaps to `--accent` (the session's hue while a per-session scope owns this card); opacity restores to 1.
- **live:** border is `--accent`. used to mark sessions that have closed a turn within the recent window.
- **idle:** opacity 0.6.
- **selected:** `--accent` border + `--accent-soft` background + opacity 1. mascot mounts in the bottom-right corner.
- **update pulse:** when the card's signature changes (insight or sessionName), the `is-updated` keyframe fires once — accent box-shadow ring (8px max) + 2.2% scale at peak, 1.6s, ease-out. ignores plain `lastEventTs` ticks so minute-tick changes don't flash.
- **internal layout:** title row (`[project] observer-name` + model-tag pill, both ellipsis-truncated) → optional insight prose (sans 13px, fg, only when `decision.open === true`) → mono Pewter foot line (optional `live` word in accent + `Xs ago` / `idle Xm`).

### Card mascot (selected only)

- **size:** 36 × 36px svg.
- **placement:** absolute, `right: -2px`, `bottom: 1px`, `z-index: 2` so it floats over the card's bottom text. no padding-right reserve on the card; layout doesn't shift when the mascot mounts.
- **variant:** `cake-icon.svg` while live, `mascot-var-2.svg` after the session has been idle ≥5min. cycles automatically with the card's `live` / `idle` class.
- **hover animation:** y-axis turntable spin distinct from the brand jump-roll's planar z-spin. timeline: jump up 9px + scale 1.07 in `power2.out` → opacity dives to 0.45 in `power2.inOut` over ~400ms → `rotationY: 360` flip in `power2.inOut` while opacity holds at 0.45 → landing drop + scale 1.0 in `back.out(1.2)` → opacity returns to 1.0 in `power2.inOut` over the landing. delegated via `mouseover` on document so re-rendered cards pick up the listener; `dataset.flipping` cooldown prevents stacked timelines.

### Wandering cake-perch (detail pane only)

a single mascot mounts in the detail pane on every session-open, picking a deterministic random surface based on `djb2(sessionId)`. different sessions land on different surfaces; the same session always lands on the same surface across the app session.

**perch surfaces (size adapts per surface):**

- `.cx-bar.bar-output` / `.cx-bar.bar-added` (frosted bars only) — 26px, anchored at `bar-top`.
- `.chart-card` — 38px, anchored at `card-top-right`.
- `.session-head h2` — 30px, anchored at `head-right`.
- `.chat-input` — 36px, anchored at `input-top-right`.

**variants:** three palette-unified svgs picked from a hash so different sessions get different mascot poses while reading as the same cartoon — `mascot-uni-1.svg`, `mascot-uni-2.svg`, `mascot-uni-3.svg`. all three draw from a shared canonical palette (wine outlines, body-pink + body-coral, cream + peach skin, orange + orange-deep accents, lavender + lavender-pink decoration). `transform-origin: 50% 100%` and a hashed `--cake-tilt` (a few degrees) keep each one slightly off-axis without looking glitched. the sidebar selected-card mascot pulls from a separate two-svg pair (`cake-icon.svg` for live, `mascot-var-2.svg` for idle).

**motion:** mounts silently with no entrance gsap (the prior cake fades out softly on session change before the new one mounts). re-mounted on every 5s refresh tick (chart and chat-input innerHTML wipes destroy DOM nodes inside them) without animation, so the cake stays visually pinned.

### Charts band

- **layout:** `display: grid; grid-template-columns: 1fr 1fr; gap: 16px`. complexity chart pinned to column 1, code-changes chart pinned to column 2. when one suppresses, its slot stays empty (no auto-stretch). below 880px it collapses to a single column.
- **chart-card surface:** soft tinted gradient + colored hairline border. complexity uses a 350-hue gradient `oklch(98% 0.014 350) → surface` with `--accent-soft` border; code uses a 155-hue gradient `oklch(98% 0.012 155) → surface` with `oklch(92% 0.06 155)` border.
- **head row:** tinted icon bubble (28×28px, accent-soft for complexity, mint-tint for code) holding a 16px svg glyph (line-graph for complexity, `</>` for code) + uppercase mono title in the card's accent color + legend pills (white surface, hairline border, colored square dot, sans 11px label).
- **bars:** flex distribution. `.cx-pair` `flex: 1 1 0`, max-width 56px per pair, 22px per bar. complexity uses input accent @ 0.55 + output plum @ 0.9; the latest pair gets plum @ 1.0. code-changes uses diff-green added @ 0.9 and diff-red removed @ 0.9; the chart self-suppresses on all-zero.
- **both charts cap at `CHART_TURNS = 5`** (the last 5 turns only, no scrolling).
- **axes:** y-axis 3 ticks (top yMax, mid yMax/2, bot 0). x-axis: dropped (no time labels). foot: small mono Pewter "Xm ago" right-aligned.

### Bar frost

- **silhouette:** `frosting-new.svg`, applied via CSS `mask-image`. swap shapes by editing the file in place; the inline rendering follows automatically.
- **fill:** `color-mix(in oklab, currentColor 60%, white 40%)` so the icing reads lighter than the bar — icing as a material, not paint.
- **dimensions:** 36px tall cap, with 20% rim above the bar's top edge and 80% overlap inside the bar. positioned at `left: -50%; right: -50%; top: -7px; width: 200%`.
- **applied to:** every `.cx-bar` whose height percentage is ≥ `BAR_FROST_MIN_PCT` (25%). short bars don't get a cap — frosting-on-stub looks dwarfed.

### Sprinkle burst (frosted-bar hover)

- **trigger:** `mouseover` on a `.cx-bar` that carries a `.bar-frost` cap. delegated via document. throttled per bar via `dataset.burstTs` with an 800ms cooldown so re-entries don't stack.
- **particles:** 9 sprinkles per burst, 4×9px capsule + 5×5px round (~40% rounds).
- **colors:** ~60% the bar's own `currentColor`, ~40% picks from `BURST_COLORS` (six fixed dessert hues: strawberry, light pink, plum, honey, mint, blueberry).
- **trajectory:** radial. angles distributed across the full 360° (`(2π / 9) * i + jitter`), distance 30–50px outward, random rotation ±180–400°, total duration ~0.6–0.85s. one-stage tween (no second-stage fall).
- **timeline:** `opacity 0→1` in 0.08s `power1.out` → `x/y/rotation` in `power2.out` → `opacity 1→0` in 0.25s `power1.in` overlapping the tail of the radial tween.

### Conversation strip

- **content:** exactly three messages: `prev-agent → you → agent`. older turns intentionally hidden — the chat input below is the surface for the next ask.
- **agent body:** rendered as markdown via `marked.parse({breaks: true, gfm: true})` into `.conv-md` (claude-session styling: headings 14–17px, lists, fenced code, inline `code`, blockquote, hr, links). max-width 78ch.
- **truncation:** agent blocks cap at `max-height: 240px` with a fade-out gradient (`linear-gradient(to bottom, transparent, var(--bg) 90%)`) and a `show full` toggle (mono accent button). expanded state survives 5s refresh ticks via an `expandedBodies` Set keyed `(sessionId, turnId, role)`.
- **user body:** plain `escapeHtml` + `pre-wrap`, no markdown.
- **role labels:** mono 10px uppercase Pewter; `you` is colored `--accent`.
- **bottom border:** 1px hairline below the strip; spaces it from the chat-thread block.

### Chat-thread block (auto-rendered when active)

- **container:** flex column, 12px gap. hidden via `:empty` rule when the thread is dormant.
- **user rows:** plain escaped text + pre-wrap. role label `you` in `--accent`.
- **agent rows:** `.conv-md` markdown body inside a surface card (1px hairline, input radius, 10px / 12px padding). role label `agent` in `--plum`.
- **auto pill:** server-fired user chunks (`kind === "auto"`) carry an inline `auto` pill next to the role label — accent-soft bg, accent text, mono tag typography (9px / 0.06em / uppercase), pill radius. visually disambiguates server-fired from typed messages.
- **status row:** mono 11px Pewter italic at the bottom. `thinking` shows a leading `•` glyph in accent that pulses 1.2s ease-in-out (the only animated dot in the system; explicitly *not* notification-bait — it gates while a real subprocess is generating). `respawning` and `error` show muted message text. hidden when status is `idle` or `spawned`.

### Chat input

- **container:** surface bg, 1px hairline, panel radius (14px), 14px / 16px padding.
- **context line:** sans 13px fg, optional mono 11px accent label `⚡ break it down` followed by the observer's latest insight. when no flag, the line goes italic muted: `no observer flag yet — pick this up and edit it.`
- **textarea:** bg-paper at rest (sits *into* the container), border-strong, input radius, 10px / 12px padding, 14px / 1.5 type, min-height 44px, vertical resize. on focus, the border becomes `--accent` and the background flips to `surface`.
- **send button:** 44 × 44 strawberry square, input radius, an inline svg arrow-up glyph at 20px (Lucide-style stroked path), strawberry shadow at rest + larger shadow on hover with `translateY(-1px)`. disabled state flips the surface to border-strong and desaturates the svg to opacity 0.5. `⌘ ↵` keyboard shortcut wired.
- **tip line:** flex space-between. left: mono 11px Pewter `tip: ask for smaller steps, rationale, or alternatives`. right: mono 11px Pewter `⌘ ↵ to send` with the keys colored `--accent`.
- **per-session draft:** textarea content is cached in a `chatDrafts` map keyed by sessionKey, lost on reload.

### Detail pane

- **layout:** flex 1, min-width 0, 4px / 0 / 20px / 22px padding. carries a top-down cream gradient (`rgba(255, 244, 232, 0.30) → 0` over 70% height) so the sidebar and detail read as two temperatures of the same surface.
- **empty state:** the cake-duo illustration (`empty-state-cake-duo.webp`) at 360px max-width + italic 14px fg-soft `select a session` below.
- **selected state cascade:** when a session is selected, the detail-content children blur-fade in with a two-tier stagger — region step 0.12s, leaf step 0.04s, duration 0.75s, `power2.out`. plan: `.session-head` (h2 + .source) → `.charts-band` (#d-chart, #d-code-chart) → `.conversation` (rows) → `.chat-input` (children). every component gets its own beat.
- **session head:** display 26px in `--accent` (the session's hue) + a mono 13px `◆ source · elapsed` line in fg-soft.
- **untouched line:** mono 11px Pewter `untouched for Xm` shown only when the session has been quiet long enough.

### Ambient layers

- **bg-blobs:** three large blurred radial blobs (`filter: blur(80px)`) at 0.35–0.55 opacity. `position: fixed; inset: 0; z-index: -1; overflow: hidden`. fixed in viewport, no motion. colors are `oklch(94% ...)` warm pink and lavender — gentle lift, not "AI gradient blob aesthetic." they live behind everything and are excluded from any blur-cascade interaction.
- **sprinkles:** 14 (mobile) or 30 (desktop ≥720px) capsule + round particles at `position: fixed; z-index: 0`. randomized hue + position + rotation. each carries a gsap yoyo float (`sine.inOut`, 4–8s) bobbing ±8–16px. respects `prefers-reduced-motion`.

### Sidebar FLIP layout

when a card enters or exits the sidebar, the surrounding cards FLIP-animate to their new positions:

- **snapshot before:** capture each persisting card's `getBoundingClientRect().top`.
- **animate after:** `gsap.from(card, {y: deltaY, duration: 0.55, ease: power3.out, overwrite: "auto"})` plus `clearProps: "transform"` on completion to release the inline transform leak.
- **the leak fix:** earlier versions used `gsap.from` without `clearProps` — when a card animated away, FLIP could leave a residual `transform`, and re-renders of that card mounted in the wrong position. the current implementation calls `gsap.killTweensOf(el, "y,transform")` on every persisting card before the new tween, then `clearProps: "transform"` on completion.

### Empty states (chrome-level)

- **inbox empty:** italic 13px fg-soft on a 1px dashed border-strong outline at card radius, 32px / 16px padding, centered. used in the sidebar.
- **conversation empty:** italic 13px fg-soft, 24px vertical padding, no outline. used in the conversation strip when a session has no closed turns yet.
- **chat-context muted:** when no observer flag yet, the chat-input's context line goes italic muted, prefixed with the same `⚡ break it down` mono label so the affordance is consistent.

### Concentrated whimsy spots (the named delights)

the system is loud at six places. anywhere else, dessert vocabulary is the kawaii-AI anti-reference.

1. **the logo + brand jump-roll** in the top nav — strawberry wordmark, cake-slice glyph, hover-fired jump+spin+drop timeline.
2. **the sidebar selected mascot** — svg cake/mascot-var-2 corner peek at 36px on the active card, with the y-axis flip + opacity dive on hover.
3. **the wandering cake-perch** — single mascot picks a random detail-pane surface per session-open; size adapts per surface; tilt is hashed.
4. **the frosting caps on bars** — drip silhouette via mask + color-mix lightening; only on bars ≥25% height.
5. **the sprinkle hover-burst** — radial 9-particle spray out of a frosted bar's rim on cursor entry; 800ms cooldown.
6. **the empty-state cake-duo** — 360px illustration when no session is selected.

> drift note: PRODUCT.md states "five places exactly, no more." the implementation currently runs at six. the system needs to either drop one (the cake-duo and the cake-perch overlap conceptually, and the cake-duo is only seen on first load) or update the rule to six. resolve before the next visual pass.

## 6. Do's and Don'ts

### Do:

- **Do** carry strawberry as the operative voice outside any per-session scope, and the session's hashed dessert hue inside one. treat any urge to add a strawberry divider, heading underline, or hover tint outside its allowed surfaces as a system drift; reach for Pewter or Hairline instead.
- **Do** keep plum in the complexity chart's output bar and the chat-thread agent role label only.
- **Do** keep diff-green and diff-red in the code-changes chart only.
- **Do** keep the sticky top nav as the only `backdrop-filter: blur` surface.
- **Do** keep mono for every label, axis, role tag, and elapsed time; sans for prose.
- **Do** stay flat. the send-button shadow, the cake-perch drop-shadow, the toggle-on ring, and the FLIP layout micro-motion are the only depth in the system.
- **Do** render the code-changes chart only when there's something to render.
- **Do** write all UI copy in lowercase, dry-with-a-wink. the wordmark is `cut-the-cake`, never `Cut the Cake`. button labels are `auto break-down`, never `Auto Break-Down`.
- **Do** honor `prefers-reduced-motion`. every gsap timeline early-returns when reduced motion is on; css transitions zero out via the global selector.

### Don't:

- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent. full borders, background tints, leading numbers, or nothing.
- **Don't** introduce gradient text, gradient buttons, gradient borders, glassmorphism beyond the one nav surface, or pure `#000` / `#fff` neutrals.
- **Don't** ship the **hero-metric template**, **datadog / grafana density**, **AI-app aesthetic** (gradient blobs as default texture, ambient glow on every surface, "your AI assistant" tone), or **generic kawaii UI** (rounded geometric script faces, lavender + mint pastels everywhere, sticker-pack illustrations applied without restraint).
- **Don't** add **severity badges, side-stripe alert cards, or sidebars-of-sidebars**. ripped out for a reason.
- **Don't** add **notification-bait**: pulsing dots, growing counters, tab-title flickers, attention animations when nothing has actually changed. the chat `thinking` pulse is allowed because it gates while a real subprocess is generating; nothing else gets to pulse.
- **Don't** ship the **dashboard-template-readme aesthetic**, identical card grids of icon + heading + body, repeated.
- **Don't** scatter mascots beyond the named whimsy spots above. a mascot in a seventh place is an automatic fail.
- **Don't** add a third button type beyond send + nav-toggle + gh-pill. if you need another action, look for an inline text affordance or a mono micro-button (`show full` style) instead.
- **Don't** capitalize headings, badge text, or button labels. lowercase is the voice.
- **Don't** animate layout properties. state changes use opacity and transform, ≤200ms, ease-out.
- **Don't** extend the per-session palette outside the card root and `#detail-content`. brand chrome stays strawberry.
- **Don't** introduce CRT scanlines, fake typing animations, ASCII art frames, or any other terminal-cosplay decoration. the user lives in a terminal already.
