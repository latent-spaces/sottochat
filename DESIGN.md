---
name: sottochat
description: a multilingual meta-discussion layer for autonomous coding agents
colors:
  bg: "#fdf9fa"
  surface: "#fffdfd"
  fg: "#1a1a1f"
  fg-soft: "#6e6e7a"
  fg-muted: "#9090a0"
  border: "#efe8eb"
  border-strong: "#dcd2d6"
  chip-tint: "#f5eef1"
  accent: "#ec4899"
  accent-hover: "#db2777"
  accent-soft: "#fce7f3"
  plum: "#a855f7"
  diff-green: "#10b981"
  diff-red: "#ef4444"
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

Ambient sprinkles and over-the-top mascot specials are implementation drift. Keep them only if they can be made almost invisible and fully motion-respectful; otherwise cut them.

## Color

Primary strategy: restrained product UI with one operative accent.

- **Paper** `#fdf9fa`: page background.
- **Surface** `#fffdfd`: cards and controls. Avoid pure white in new work.
- **Ink** `#1a1a1f`: primary text.
- **Pewter** `#9090a0`: metadata and instrument labels.
- **Strawberry** `#ec4899`: current selection, focus, send, live, and brand mark.
- **Strawberry tint** `#fce7f3`: selected card and active chip fills.
- **Plum** `#a855f7`: agent-side role only where paired with user-side accent.
- **Diff green/red**: code change chart only.

Rules:

- Accent means action or current selection. Do not use it for decoration.
- Per-session colors may scope to the card and selected detail pane only.
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

The latest exchange shows the agent tail first. Long agent output is pinned to its end and can expand with `show full`.

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

- Ambient sprinkles.
- Mascot specials.
- Auto chart intro.

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
