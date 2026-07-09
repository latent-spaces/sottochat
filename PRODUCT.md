# Product

## Register

product

## Users

Solo developer (the author) plus a small ring of claude-code power users who will find the repo on GitHub and run it locally. Assumed-literate: comfortable with `jsonl`, terminal output, "turn", "context tokens", "tool calls". No hand-holding budget; jargon is fine; tooltips and onboarding flows are not the answer.

Primary moment of use: the user is at a two-monitor desk with claude code running in one terminal and cut-the-cake open in the other, glancing over every few minutes to decide whether a turn is worth interrupting. Secondary mode: left open all day on a side monitor as ambient awareness, expected to stay quiet until something genuinely matters.

## Product Purpose

Turn long autonomous agent runs into a quick, glanceable read — in your own language. Tail every claude code (and adjacent agent) session in real time and run a persistent observer over the closed-turn stream, which labels each session with a one-sentence "what this is about", refreshed as the work evolves. When a run is worth a closer look, ask about it in plain language: the app explains the latest output in your language and, when you're deciding what to tell the agent, drafts a reply to paste back into your terminal (the app only reads the transcript — copy-paste is the bridge to the real session).

The explanation language is configurable — Hebrew by default, plus English, Arabic, Spanish, French, Russian, German, Chinese — and drives everything the app says *to* you; the drafted reply stays in the agent's own language.

Success looks like: the user can leave several agents running unattended, glance at cut-the-cake, and within two seconds know what each one is about and whether to jump in — then get a precise course-correction drafted without breaking the glance.

## Brand Personality

Three words: **wry, dessert-coded, sparing.**

Voice: lowercase prose, dry-with-a-wink, confident without being cute. Code identifiers are camelCase; copy and chrome are lowercase. Personality lives in word choice and a small handful of named visual delights, five places exactly, no more.

Emotional goal: a sharp tool with a sweet tooth. The chrome wears strawberry; the data stays exact; the terminal block stays unchanged. Closer to a patisserie that sells precision instruments than to "your AI assistant" or to "calm minimalism".

## Anti-references

- **Datadog / Grafana density.** Charts and gauges because charts and gauges; rows of identical panels.
- **Hero-metric SaaS template.** Big number, small label, supporting stats, gradient accent.
- **AI-app aesthetic.** Gradient blobs, ambient glow, pastel "calm" tones, "your AI assistant" tone. Strawberry pink and the dessert mascots are allowed only in the five named places enumerated in DESIGN.md; anywhere else they are this anti-reference.
- **Generic kawaii UI.** Rounded geometric script faces, lavender + mint pastels, balloon emojis, sticker-pack illustrations applied without restraint. The whimsy here is contained, not slathered.
- **Severity badges, side-stripe alert cards, sidebars-of-sidebars.** Already ripped out for a reason; do not return.
- **Notification-bait.** Pulses, red dots, growing counters, attention-stealing animation when nothing genuinely changed.
- **Dashboard-template-readme aesthetic.** Identical card grids, icon + heading + body, repeated.

## Design Principles

1. **Strip until it hurts, then strip more.** The product question on every screen is: what is the minimal information that makes the next decision obvious? Density is the enemy, not the goal. When in doubt, remove.

2. **Defer to the model.** The observer labels each session; the chat assistant explains it and drafts the reply. The chrome is scaffolding for that content — the summary, the explanation, the drafted reply — and must never out-shout it.

3. **Ambient by default, present when it matters.** Glanceable from across the desk; quiet when nothing is happening; unmistakable when something is. The contrast between idle and active states should be the loudest thing in the UI.

4. **Terminal-literate, not terminal-cosplay.** Mono type, lowercase, dry voice are real because the user lives in a terminal. Do not bolt on CRT scanlines, fake typing animations, ASCII art frames, or other retro affectations.

5. **Fun lives in the voice and in five named places.** Copy carries personality. The chrome carries strawberry, but only at the logo, the live-session avatar, the welcome banner, the empty state, and the send button. Six is too many; one of the five gets cut. The terminal block never changes.

## Accessibility & Inclusion

Not a hard floor. The audience is power users on their own machines; forkers can adapt for their needs. Still, do not ship genuinely broken contrast, never rely on color alone to encode state, and respect `prefers-reduced-motion` for any motion that gets added.
