---
name: sottochat
description: a multilingual meta-discussion layer for autonomous coding agents
colors:
  bg: "oklch(98% 0.008 350)"
  surface: "oklch(99.4% 0.005 350)"
  fg: "oklch(22% 0.014 320)"
  fg-soft: "oklch(45% 0.018 320)"
  fg-muted: "oklch(58% 0.018 320)"
  border: "oklch(89.5% 0.016 350)"
  border-strong: "oklch(80% 0.028 350)"
  chip-tint: "oklch(96.5% 0.014 350)"
  accent: "oklch(57% 0.205 354)"
  accent-hover: "oklch(51% 0.205 354)"
  accent-soft: "oklch(94.2% 0.038 350)"
  plum: "oklch(58% 0.15 310)"
  diff-green: "oklch(50% 0.12 150)"
  diff-red: "oklch(54% 0.18 25)"
typography:
  sans: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
  mono: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
register: product
---

# Design System: sottochat

## North Star

**The back-channel.** sottochat is the quiet side-channel beside the terminal. The agent runs at full voice in its own session; sottochat is where the user follows along, thinks it through in their own language, and prepares a precise reply to send back.

Scene: one developer, two monitors, afternoon or late-night ambient light, several agents running in parallel. The product must stay calm until the user opens a run, then make the meta conversation feel focused and aware of the original session.

## Visual Direction

Light mode is intentional. The app lives next to terminals, but it is not terminal cosplay. The surface is warm paper, not black glass. The split-paragraph logo uses the operative strawberry and agent-side plum; a light culinary touch remains in frosting caps on charts and a few mascots, but the default read should be "precise local tool" before "dessert toy."

The playful visual layer is kept only where it earns its keep:

- logo mark
- selected-session mascot
- detail-pane cake perch
- chart frosting caps
- frosted-bar sprinkle burst

Ambient background sprinkles are removed. Hover effects attached to a direct
chart interaction may remain if they are subtle and motion-respectful.

## Color

Primary strategy: restrained product UI with one operative accent. The browser
can choose among four complete light color systems in Settings: Quiet Berry
(default), Ink and Ember, Session Spectrum, and Radix Ruby. The first three are
defined in OKLCH; Radix Ruby uses the published Radix Colors 3.0.0 values.

- **Paper** `oklch(98% 0.008 350)`: page background.
- **Surface** `oklch(99.4% 0.005 350)`: cards and controls.
- **Ink** `oklch(22% 0.014 320)`: primary text.
- **Pewter** `oklch(58% 0.018 320)`: metadata and instrument labels.
- **Strawberry** `oklch(57% 0.205 354)`: current selection, focus, send, live, and brand mark.
- **Strawberry tint** `oklch(94.2% 0.038 350)`: selected card and active chip fills.
- **Plum** `oklch(58% 0.15 310)`: agent-side role only where paired with user-side accent.
- **Diff green/red**: code change chart only.

Rules:

- Accent means action or current selection. Do not use it for decoration.
- Per-session colors may scope to the card and selected detail pane only when
  Session Spectrum is active. The other systems keep a stable accent.
- Green and red are data colors, not status badges.
- New colors should be written as OKLCH in CSS when touched.
- No gradient text, gradient borders, or new glass surfaces.

## Typography

Use two stacks only:

- System sans for session names, summaries, explanations, controls, and prose.
- System mono for labels, context counts, elapsed time, role labels, and compact instruments.

Scale:

- Detail title: 26px, 600.
- Wordmark: 20px, 600.
- Card title: 13px, 600.
- Body: 14-15px.
- Mono labels: 9-11px.

No display face. No script face. No viewport-scaled type.

## Layout

The shell is stable and predictable:

- Sticky top nav with wordmark, language selector, and repo pill.
- Left session inbox, collapsible to a thin rail.
- Right detail pane with selected session title, latest exchange, Q&A, and optional charts.
- Internal SDK subprocesses stay in a collapsed section below user-driven sessions.

Spacing should feel practical, not decorative. Avoid card-in-card composition. Cards are only for repeated session rows, chat rows, and suggested-reply blocks.

## Components

### Top Nav

Wordmark: `sottochat`.

Tagline: `discuss the response, answer well`.

The language selector uses the same pill vocabulary as the repo link. It chooses the language for the meta discussion and session labels, not the language of suggested replies to agents.

Two compact controls sit beside it:

- a three-swatch button cycles the four browser-local color systems
- a threshold button opens an anchored menu for `off`, `275+`, `700+`, or `1.2k+`; each option briefly explains its frequency, and the selected threshold runs the first localized preset once for qualifying completed replies
- a token button opens an anchored daily-history panel for model usage created by sottochat chat and observer calls; every day names the exact SDK model IDs and their token subtotals, while aggregate totals include uncached input, cache writes, cache reads, and output and exclude the watched coding agent

### Session Card

The card answers two supporting questions:

- What is this run about?
- Is it live, recent, or idle?

An optional model tag and context-token tag are instruments, not badges. Do not add severity states.

### Detail Header

The title is the session name. Secondary line is source, elapsed time, context tokens, and cwd when available.

The destructive chat control should say `clear chat`, not `reset`.

### Charts

Charts are supporting evidence, collapsed by default. They should never become the main product.

- Complexity chart: user words vs agent output plus tool pressure.
- Code chart: added vs removed lines.
- Last five turns only.
- X-axis labels stay suppressed.

### Latest Exchange

The latest exchange shows the agent tail first. Long agent output is pinned to its end and can expand with `show full`; the control includes the full message word count.

When the upstream agent has not replied yet, show the user's last message and a quiet typing indicator. Hide the Q&A box while waiting.

### Meta Discussion Box

The box is empty by default and seeded server-side, not visibly prefilled. It is the main product surface: the user asks about the original run in their own language, and the assistant answers with awareness of the latest exchange and recent turns.

Preset chips are shortcuts for common asks:

- summarize
- explain simply
- what happened here?
- what should I answer?

The context stepper should read as `context` or `turns`, not as a mystery label. `ctx` is acceptable only if a tooltip names it clearly.

### Prepared Reply Card

Assistant messages may contain one fenced `to-agent` block. Render it as a copyable card:

- label: `copy to agent`
- body: mono, LTR, agent language
- copy confirmation: `copied`

The card is the handoff back to the original session. It is not an in-app send action, and it should never imply that sottochat can write to the terminal directly.

## Motion

Motion must explain state or reward direct interaction. It must never announce ordinary background refreshes.

Allowed:

- Sidebar card enter, exit, and FLIP movement.
- Session content reveal on selection.
- Send hover.
- One quiet typing indicator while a real subprocess is thinking.
- Mascot hover reactions, if reduced motion disables them.

Needs restraint:

- Mascot specials.

Ban:

- Pulses for mere freshness.
- Notification dots.
- Bounce or elastic easing.
- Layout-property animation in new work.

## Microcopy

Chrome stays lowercase. Every label should name the object it changes.

Preferred labels:

- `sottochat`
- `discuss the response, answer well`
- `sessions`
- `pick a session`
- `clear chat`
- `context turns`
- `show charts`
- `hide charts`
- `latest exchange`
- `copy to agent`

Avoid:

- `break it down`
- `auto`
- `reset` when only chat history is cleared
- `no active session detected`
- `you are...`
- vague status text such as `error: agent stopped`

## Implementation Drift To Track

- `public/index.html` still contains literal control bytes used as separators; replace them with printable constants.
- Some controls are below 44px touch target size.
- External CDN scripts are loaded at runtime.
- Older notes describe scriptifier, TTS, and export features that are absent from this branch.
