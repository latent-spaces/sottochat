# creative review — video-pane build

opinionated self-critique of the choices that landed during the overnight run. each axis: what's there, what's risky, two concrete alternatives. terse on purpose.

## marker semantics (INSIGHT / BE_CAREFUL / STEP / NOTE)

**risk:** the four labels are very design-doc-y. they ship the visual chip but they don't shape the *story*. INSIGHT next to a beat about "the agent ran fs.watch" lands flat.

**alt 1 — story shapes:** `PUNCHLINE / GOTCHA / PIVOT / ASIDE`. each names a *moment in a narrative arc* rather than a category in a write-up. PUNCHLINE forces the scriptifier to find the beat that actually pays off; GOTCHA names the surprise; PIVOT names the architectural turn; ASIDE is the kind aside.

**alt 2 — energy only:** drop semantics entirely. `LOW / HIGH / SHIFT`. just intensity. the karaoke does the work of conveying *what*; markers convey *how loud*. fewer rules, more breathing room for the prose.

## marker visual treatment (pill / banner / corner)

**risk:** pill is the most boring of the three but it's the default. first-impression is the boring one.

**alt 1:** make `corner` the default. it's the lightest-touch and the most novel (audio cue + tint shift). pill becomes the "i want it explicit" choice.

**alt 2:** ditch the picker. ship one treatment that adapts: PUNCHLINE/HIGH gets banner energy, ASIDE/LOW gets a corner whisper, SHIFT gets a cross-fade between two visual states. style follows semantics.

## scriptifier prompts (default / cinematic / tldr / deep-dive)

**risk:** four lowercase variants of the same voice. cinematic ≈ default + drama, deep-dive ≈ default + specifics. tldr is the only one that meaningfully changes the *shape* (3-5 beats). variation E is adding comedic / noir / kids — that opens a real range.

**alt 1 — drop "default":** rename the current default to `house` so it's a *style choice*, not a fallback. forces every session to commit to a tone.

**alt 2 — duet mode:** two scriptifier subprocesses for one turn, each with a different style. their beats interleave alphabetically by start word. produces back-and-forth narration. *scriptifier B counters scriptifier A.* would land best with two voices (af_heart + am_michael), pingponged on alternating beats.

## voice picker (warm / calm / crisp)

**risk:** functional, characterless. one-word labels feel like radio-button options.

**alt 1 — characters with taglines:** `warm — the friend who calls at 11pm` / `calm — the voice you find when you slow down` / `crisp — your professor before tenure`. tagline reveals on hover. picker becomes a casting decision, not a config knob.

**alt 2 — tone slider:** drop the three-voice picker entirely. one slider: warm ↔ crisp. server picks the matching voice. fewer choices, faster to land on a vibe. (downside: am_michael drops out — male voice option lost. could add a separate "register" toggle.)

## video-pane visual identity

**risk:** the pane is a card with text scrolling. cut-the-cake has a strong dessert aesthetic — mascots, frosting, sprinkles, six-hue palette — and the video-pane doesn't tap any of it. orphaned from the visual system.

**alt 1 — frosted play button + sprinkle burst on word advance.** play button gets the same SVG frosting cap that lives on the bar charts (color-mix lightened). every active-word transition fires a tiny 3-sprinkle burst (existing helper) at the word's center. ties the pane back to the brand without extra weight.

**alt 2 — pinned cake-perch mascot.** during playback, the wandering cake-perch lands inside the video-pane (top-right) and reacts at marker beats — the existing 15-mild-reaction pool already covers what we need. perch animates a subtle nod on each PUNCHLINE/HIGH/INSIGHT.

## naming

**risk:** "video-pane" is the wrong name. nothing in the live experience is video — it's animated text plus tts. only the MP4 export is actually video.

**alt 1:** rename live mode to `narration` (e.g. `.narration-pane`, "narrated by..."). reserve "video" for the MP4 export. tighter mental model: narration is the live alternative; video is the shareable export.

**alt 2:** keep "video" but lean into it. the in-app should *feel* like watching a video, not reading captions over audio. that means: a frame around the content (drop-shadow, rounded corners), a subtle vignette, maybe a faux-progress bar that feels playful (a frosting drip that fills horizontally?). this is the more ambitious read — make the metaphor real.

## audio

**risk:** narration alone, no music bed. silence between beats can feel awkward in non-tldr modes.

**alt 1 — soft music bed at 8% volume.** 30-second loop of soft instrumental, kokoro-style ambient. one shared track for all sessions. duck during marker beats so the marker breathes.

**alt 2 — beat-driven sfx instead of music.** subtle whoosh on beat advance, soft ding on marker entry (corner style already does this for one marker type — generalize). no continuous bed. quieter overall, more *Pixar short* vibe than *podcast*.

## interactivity

**risk:** the user is a passive listener. no way to influence what gets emphasized, no way to mark a beat as "wait i want to dwell on this."

**alt 1 — bookmarks.** click a beat while playing → adds it to a session-level bookmarks list. next render of the pane surfaces "bookmarked beats" in a small chip row above the controls. low-effort interaction, high signal for the user about what mattered.

**alt 2 — re-roll.** small "re-script" button on the pane head re-runs the scriptifier for the same turn (cost: one sonnet call, ~2-5s). useful when the first script lands flat. could also auto-re-roll if no markers and the turn was high-magnitude.

---

**bottom line.** the variation work landed solid mechanics — pickers, presets, audio, marker dispatch, mp4 export. the open creative ground is in the *semantic layer*: marker labels, scriptifier styles' actual range, audio bed, interactivity. the visual identity has the most under-investment — the pane is functional but doesn't sing in the cut-the-cake idiom.

if i had to ship one of these next, i'd ship **alt 1 of "video-pane visual identity"** — frosted play button + sprinkle burst — because it's the cheapest investment that makes the pane *belong* to the project, not just live in it.
