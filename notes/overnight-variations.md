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

## the five pickers in `.video-pane-head` (left → right)

1. **voice** — `warm | calm | crisp` (af_heart / am_michael / bf_emma). per-session. clicking opens a small dropdown with id + accent caption. POSTs `/debug/voice`. localStorage seeded by hello payload.
2. **script style** — `default | cinematic | tldr | deep-dive | comedic | noir | kids`. seven scriptifier prompt presets, each with its own sandbox subprocess at `~/.cut-the-cake/scriptifier/<style>--<vocab>/`. global. POSTs `/debug/script-style`. **affects future turns only** — won't re-roll the current script.
3. **marker vocab** — `design | story`. design = INSIGHT/BE_CAREFUL/STEP/NOTE; story = PUNCHLINE/GOTCHA/PIVOT/ASIDE. same semantic intent, different prose energy. global. POSTs `/debug/marker-vocab`. **affects future turns only.**
4. **marker style** — `pill | banner | corner | stamp | ticker | halo`. how the marker tokens flag visually inside the karaoke. global. URL param `?marker=<style>` works as a shortcut.
5. **(implicit) mp4 export button** — appears in `.video-pane-controls` once status is ready. click → `rendering 0:NN` ticker → `download mp4 · NNNkb` link.

## tour mode

a "tour" button sits next to the marker-style picker (only when the active script has at least one marker, since the tour cycles marker treatments). click → karaoke proceeds while the marker style swaps every four seconds (`pill → banner → corner → stamp → ticker → halo → pill → …`), so you can see the full design space in one playback. click again to stop and the user's previous style is restored. picking a marker manually mid-tour exits cleanly. while the tour runs, the button glows accent with a soft box-shadow pulse so the active state is obvious; respects `prefers-reduced-motion`.

## interactivity: bookmarks

each `.video-beat` shows a small ribbon icon in its top-right corner. visible while .current or on hover; full-color (filled) when bookmarked. click toggles. bookmarked beats render as a `.video-bookmarks` chip row above the controls — `📑 #N` (1-based beat index). click a chip seeks the audio to that beat's `startS`. the demo session has beat 7 (the INSIGHT/PUNCHLINE one) pre-bookmarked so you can see the chip on first load.

server-side: `Map<sessionKey, Map<turnId, Set<number>>>`. POST `/debug/bookmark` `{sessionKey, turnId, beatIdx, action: "add"|"remove"|"toggle"}`, POST `/debug/bookmarks/clear`, broadcasts `bookmark:setting`. snapshot rehydrates on hello.

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
7912f10  notes: morning tour of the overnight variations
419e621  scriptifier: defensive caps on prompt input + model output (Q)
010acff  video-pane: visual identity — frosted play button + sprinkle burst (G)
e2218d2  notes: mp4 export verified end-to-end (live render, 22.2s, 2MB)
8d217a8  video-pane: alternative marker vocabulary — design ↔ story (R)
```

tags: `overnight-variations-v1` at `010acff`, `overnight-final` at `e96cb92` (this run's last commit).

```
3e2f448  notes: tour catches up — five pickers + R commit listed
d52fd52  video-pane: per-turn beat bookmarks (S)
5abd497  notes: tour catches up — bookmarks (S) + live-verified endpoints
4b3aa16  video-pane: voice picker gets character taglines (U)
e96cb92  video-pane: marker-tour button — cycle through all six treatments (V)
```

19 commits since `pre-registry-flip`.

## live-verified endpoints (curled this run)

- `POST /debug/inject-script` — injects the cached cafebabe demo on the workspace-claude-meta session, confirmed `status: ready` with audioUrl.
- `POST /debug/marker-vocab {vocab: "story"}` and `{vocab: "design"}` — both return `{ok: true}`. invalid vocab returns 400 with the allowlist.
- `POST /debug/bookmark` — add/remove/toggle all work, returns sorted-asc array. out-of-range beatIdx returns 400. demo session has beat 7 pre-bookmarked.
- `POST /debug/export-script` — kicks off real mp4 render. completed in 22.2s for the 41s demo wav, output at `/export/<hash>.mp4` streams 2 MB of valid mp4.
- `GET /tts/<hash>.wav` — streams the cached audio. `GET /export/<hash>.mp4` similarly. both honor the hex-only path-traversal guards.

## ws messages the client now handles

- `script:beats` / `script:ready` / `script:error` — scriptifier + tts pipeline
- `scriptstyle:setting` — script-style picker swap broadcast
- `markervocab:setting` — marker-vocab picker swap broadcast
- `voice:setting` — per-session voice override broadcast
- `bookmark:setting` — bookmark toggle broadcast
- `export:rendering` / `export:ready` / `export:error` — mp4 export pipeline

## known unverified

i couldn't drive a browser this run — chrome-devtools-mcp wedged on every list_pages/new_page. the visual layer of every variation has been **code-reviewed** but not **eye-confirmed**. likely small CSS/animation tweaks land in the morning pass.

## verified end-to-end (after the initial doc was written)

mp4 render path: **works**. triggered an export against the injected demo (turn `demo-movy3b54`); render completed in 22.2s and produced a valid 2 MB / 41.39s mp4. served via `/export/<hash>.mp4` with the hex-only path-traversal guard. hyperframes lint warned (expected — composition has many backgroundColor tweens which lint flags as "non-transform animation") but didn't block. cached at `~/.cut-the-cake/exports/<hash>/` with `index.html`, `narration.wav`, `output.mp4`, `render.log`. cache-hit on subsequent identical exports skips the 22s render entirely.

## hot priorities for tomorrow morning

1. open the page, verify the four pickers work and the marker treatments aren't broken.
2. trigger one mp4 export to confirm the render path works end-to-end.
3. pick from the creative-review.md alternatives — i'd start with marker semantics rename (PUNCHLINE/GOTCHA/PIVOT/ASIDE) since it changes how every other variation feels.
