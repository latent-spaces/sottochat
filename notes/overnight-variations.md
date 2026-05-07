# overnight variations — video-pane

quick tour of what landed during the overnight autonomous run. read this first when you sit down. revert anchor before all of it: tag `pre-registry-flip` at `a1044a9`.

## see it now

server should still be running on `:3737` with `META_DEBUG=1`. a demo script has already been injected on this session's card (`-Users-oronans-workspace-claude-meta`). open `http://localhost:3737/` → click into the claude-meta card → the video-pane is between charts-band and conversation, fully populated with 9 beats / 2 markers / 41.4s of audio, ready to play.

if the demo isn't there (server crashed, restart, etc):
```
curl -X POST http://localhost:3737/debug/inject-script \
  -H 'content-type: application/json' \
  -d '{"sessionKey": "claude-code:/Users/oronans/.claude/projects/-Users-oronans-workspace-claude-meta/<sid>.jsonl"}'
```
or with no sessionKey since the route now requires it explicitly — pick one from `curl localhost:3737/state | jq '.sessions[0].key'`.

## the four pickers in `.video-pane-head` (left → right)

1. **voice** — `warm | calm | crisp` (af_heart / am_michael / bf_emma). per-session. clicking opens a small dropdown with id + accent caption. POSTs `/debug/voice`. localStorage seeded by hello payload.
2. **script style** — `default | cinematic | tldr | deep-dive | comedic | noir | kids`. seven scriptifier prompt presets, each with its own sandbox subprocess at `~/.cut-the-cake/scriptifier/<style>/`. global. POSTs `/debug/script-style`. **affects future turns only** — won't re-roll the current script.
3. **marker style** — `pill | banner | corner | stamp | ticker | halo`. how INSIGHT/BE_CAREFUL/STEP/NOTE flag visually inside the karaoke. global. URL param `?marker=<style>` works as a shortcut.
4. **(implicit) mp4 export button** — appears in `.video-pane-controls` once status is ready. click → `rendering 0:NN` ticker → `download mp4 · NNNkb` link.

## the seven scriptifier voices, in vibe order

- **default** — current, dry-with-a-wink, terminal-flavored, 6-15 short beats.
- **cinematic** — documentary-voiceover gravitas, declarative confidence, 8-18 longer beats.
- **tldr** — exactly 3-5 ultra-terse beats.
- **deep-dive** — 10-25 specific beats with file/function names, nerdier register.
- **comedic** — punchy, setup→twist→payoff rhythm, dry-with-a-smirk. punchline word emphasis.
- **noir** — terse atmospheric prose, hard verbs, no hedging. INSIGHT lands like a clue dropping into place.
- **kids** — friendly explainer, concrete metaphors over jargon ("the watcher peeks at the file like checking the cookie jar").

## the six marker treatments

| style    | how it lands                                                      |
|----------|-------------------------------------------------------------------|
| pill     | inline chip before the beat text (default).                        |
| banner   | full-bleed overlay slides in from top of stage, holds 1.1s, exits. |
| corner   | small glyph + label in head row, soft 200Hz audio cue, beat tint.  |
| stamp    | 56px round svg "rubber-stamp" rotation+scale entrance, sits inline.|
| ticker   | marker pill scrolls right→left along the bottom of the pane.       |
| halo     | pulsing accent box-shadow on the active beat for its duration.     |

each marker uses the same fixed cross-session palette (`#fde68a` insight, `#fed7aa` be_careful, `#dbeafe` step, dashed paper for note) so users learn to recognize them.

## the mp4 export

click "export mp4" on a ready script. the server scaffolds a real hyperframes composition at `~/.cut-the-cake/exports/<hash>/` — 1280x720 lyric-scroll layout, per-word soft-pink highlight tweens, banner-style marker overlays, the same wav copied as `narration.wav`. lints (warn-only) then renders via `npx hyperframes render --quality draft --workers auto`. cache key = sha256({beats, voice, audioHash, version:"v1"}). on completion the button swaps to `download mp4 · NNNkb` linking at `/export/<hash>.mp4`. ~30-90s per render typical; in-flight Map dedupes concurrent exports of the same hash.

## creative-review.md

[notes/creative-review.md](creative-review.md) — opinionated 8-axis self-critique with concrete alternatives i'd ship next. tldr if you only read one section: marker semantics (PUNCHLINE/GOTCHA/PIVOT/ASIDE feels like a more story-shaped vocabulary than INSIGHT/BE_CAREFUL/STEP/NOTE).

## commits since `pre-registry-flip`

```
75b13d6  video-pane: parallel-modality alternative to reading the conversation strip
2305ab6  debug: /debug/inject-script for video-pane visual verification
ecb9108  video-pane fixes from codex review (high + medium + low)
592d19f  video-pane: marker style variants (pill | banner | corner)
48c788b  video-pane: scriptifier prompt presets (default | cinematic | tldr | deep-dive)
226aad6  video-pane: per-session voice picker (warm | calm | crisp)
1a70d27  scriptifier: 3 more prompt presets — comedic | noir | kids
e189b1a  notes: creative review of the video-pane build
2b2b7d6  video-pane: mp4 export (D) + 3 more marker treatments (F) + script-style picker entries (E)
```

still in flight at the time of writing: variation G (frosted play button + sprinkle burst on word advance — visual identity per creative-review.md alt 1) and variation Q (defensive caps on scriptifier output size — closes the codex "trust-based output size" finding). both background workers, will land after this doc is committed.

## known unverified

i couldn't drive a browser this run — chrome-devtools-mcp wedged on every list_pages/new_page. the visual layer of every variation has been **code-reviewed** but not **eye-confirmed**. likely small CSS/animation tweaks land in the morning pass.

## verified end-to-end (after the initial doc was written)

mp4 render path: **works**. triggered an export against the injected demo (turn `demo-movy3b54`); render completed in 22.2s and produced a valid 2 MB / 41.39s mp4. served via `/export/<hash>.mp4` with the hex-only path-traversal guard. hyperframes lint warned (expected — composition has many backgroundColor tweens which lint flags as "non-transform animation") but didn't block. cached at `~/.cut-the-cake/exports/<hash>/` with `index.html`, `narration.wav`, `output.mp4`, `render.log`. cache-hit on subsequent identical exports skips the 22s render entirely.

## hot priorities for tomorrow morning

1. open the page, verify the four pickers work and the marker treatments aren't broken.
2. trigger one mp4 export to confirm the render path works end-to-end.
3. pick from the creative-review.md alternatives — i'd start with marker semantics rename (PUNCHLINE/GOTCHA/PIVOT/ASIDE) since it changes how every other variation feels.
