# Product

## Register

product

## Users

Solo developer (the author) plus a small ring of claude-code power users who will find the repo on GitHub and run it locally. Assumed-literate: comfortable with `jsonl`, terminal output, "turn", "context tokens", "tool calls". No hand-holding budget; jargon is fine; tooltips and onboarding flows are not the answer.

Primary moment of use: the user is at a two-monitor desk with claude code running in one terminal and chunk-to-chat open in the other, glancing over every few minutes to decide whether a turn is worth interrupting. Secondary mode: left open all day on a side monitor as ambient awareness, expected to stay quiet until something genuinely matters.

## Product Purpose

Turn long autonomous agent runs into a quick, iterative chat. Tail every claude code (and adjacent agent) session in real time, run a persistent observer over the closed-turn stream, and surface only the moments worth user attention as a one-sentence insight plus an editable prefill the user can hand back to the original agent.

Success looks like: the user can leave several agents running unattended, glance at chunk-to-chat, and within two seconds know whether to keep working on something else or jump in with a precise course-correction.

## Brand Personality

Three words: **wry, terminal-native, sparing.**

Voice: lowercase prose, dry-with-a-wink, confident without being cute. Code identifiers are camelCase; copy and chrome are lowercase. Personality lives in word choice and small surprises, never in chrome volume.

Emotional goal: the feeling of a sharp tool that respects your time. Not "calm minimalism", not "fun playful AI", not "serious enterprise dashboard". Closer to a power-user CLI that happens to render in a browser.

## Anti-references

- **Datadog / Grafana density.** Charts and gauges because charts and gauges; rows of identical panels.
- **Hero-metric SaaS template.** Big number, small label, supporting stats, gradient accent.
- **AI-app aesthetic.** Gradient blobs, glassmorphism, pastel "calm" tones, ✨ sparkle copy, "your AI assistant" tone.
- **Corporate Vercel-cream-and-black landing.** This is not marketing. No hero. No CTA stack.
- **Severity badges, side-stripe alert cards, sidebars-of-sidebars.** Already ripped out for a reason; do not return.
- **Notification-bait.** Pulses, red dots, growing counters, attention-stealing animation when nothing genuinely changed.
- **Dashboard-template-readme aesthetic.** Identical card grids, icon + heading + body, repeated.

## Design Principles

1. **Strip until it hurts, then strip more.** The product question on every screen is: what is the minimal information that makes the next decision obvious? Density is the enemy, not the goal. When in doubt, remove.

2. **Defer to the observer.** The model picks the moment worth surfacing. The chrome is scaffolding for its insight and prefill; the chrome must never out-shout the content it's framing.

3. **Ambient by default, present when it matters.** Glanceable from across the desk; quiet when nothing is happening; unmistakable when something is. The contrast between idle and active states should be the loudest thing in the UI.

4. **Terminal-literate, not terminal-cosplay.** Mono type, lowercase, dry voice are real because the user lives in a terminal. Do not bolt on CRT scanlines, fake typing animations, ASCII art frames, or other retro affectations.

5. **Fun lives in the voice, not the chrome.** Personality is carried by copy and the occasional small surprise. The visual system itself stays restrained so the voice has room to land.

## Accessibility & Inclusion

Not a hard floor. The audience is power users on their own machines; forkers can adapt for their needs. Still, do not ship genuinely broken contrast, never rely on color alone to encode state, and respect `prefers-reduced-motion` for any motion that gets added.
