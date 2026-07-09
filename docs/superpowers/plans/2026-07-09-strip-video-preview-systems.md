# Strip video/preview systems + collapsible sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove both video-generation systems (composer + legacy karaoke/pill/tts pane) from cut-the-cake, fix the "jsonl" session-classification leak, and make the sessions sidebar collapse to a thin icon rail — leaving the core tailer → turns → observer → chat loop plus the code-changes chart.

**Architecture:** Backend is `src/*.ts` run by Bun (`bun src/server.ts`, port 3737). Frontend is a single-file SPA `public/index.html` (~312 KB inline JS+CSS) fed over WebSocket. Removal is surgical: delete five backend modules and their `server.ts` wiring, strip two panes + their JS from the frontend, then two small frontend edits (classification, sidebar).

**Tech Stack:** Bun, TypeScript, vanilla JS/CSS single-file frontend, WebSocket broadcast.

## Global Constraints

- No test framework exists (`package.json` scripts: `dev`, `start`, `typecheck`). Per-task verification = `bun typecheck` clean + dead-symbol grep returns empty + drive the app in a browser.
- Voice/chrome rules (DESIGN.md / PRODUCT.md): lowercase copy, camelCase identifiers, delights only in the five named places. The sidebar rail is chrome — reuse existing session colors + live avatar, add no new mascots.
- Keep untouched: `triggers.ts`, `observer.ts`, `chat-agent.ts`, `tailer`, `turns`, `registry`, discovery modules, and the "auto break-down" toggle (`autosend-toggle` — observer auto-send, not video).
- Commit after each task. Branch: `strip-video-preview` (already checked out).
- No `console.log` left in committed frontend code.

---

### Task 1: Remove the composer subsystem (backend)

The composer is the most self-contained: its own module, routes, starter, SSE events, and demo fixture.

**Files:**
- Delete: `src/composer.ts`
- Modify: `src/server.ts`

**In `src/server.ts`, remove every composer reference:**
- Import (line 13): `import { startComposer, composerRootDirFor, composerSafeKey, type ComposerEvent } from "./composer";`
- The `startComposer({...})` block (starts ~line 1621) and any variable it's assigned to.
- Routes: `/composer/` serve handler (~784–820), `POST /composer/demo` (~929), `POST /composer/regen` (~978).
- The `DEMO_COMPOSITION_HTML` fixture (~508–630) — used only by `/composer/demo`.
- Any composer state on `SessionState` / snapshot (search `composer` in the `SessionState` type, `getOrCreate`, and `snapshot()`).
- SSE broadcasts of kinds `composer:running` / `composer:linting` / `composer:ready` / `composer:error`.

- [ ] **Step 1: Delete the module**

```bash
git rm src/composer.ts
```

- [ ] **Step 2: Strip composer wiring from server.ts**

Remove the import, the `startComposer` block, the three `/composer/*` routes, `DEMO_COMPOSITION_HTML`, composer state fields, and composer SSE broadcasts (anchors above).

- [ ] **Step 3: Verify no dangling references**

Run: `grep -rniE "composer" src/`
Expected: empty (comments referencing composer removed too).
Run: `bun typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "remove composer subsystem (backend)"
```

---

### Task 2: Remove the legacy video pipeline — scriptifier + infographer + tts + export (backend)

These three subprocesses are tightly coupled (beats → pills → audio) and share the turn-close handler and demo fixtures; remove together.

**Files:**
- Delete: `src/scriptifier.ts`, `src/infographer.ts`, `src/tts.ts`, `src/hyperframes-export.ts`
- Modify: `src/server.ts`, `package.json`

**In `src/server.ts`, remove:**
- Imports (lines 7–10): scriptifier (`startScriptifier`, `SCRIPT_STYLES`, `MARKER_VOCABS`, `ScriptBeat`, `ScriptStyle`, `MarkerVocab`), infographer (`startInfographer`, `Pill`), tts (`generateTts`, `ttsAudioPath`, `WordTiming`), hyperframes-export (`exportToMp4`, `exportMp4Path`).
- Module-level state: `activeScriptStyle` (~87), `activeMarkerVocab` (~96), types `ScriptPayload` (~135) and `PillPlanPayload` (~150), `prunePillPlans` (~296).
- `SessionState` fields `scripts` (~187) and `pillPlans` (~188); their init in `getOrCreate` (~336); their serialization in `snapshot()` (`pillPlans` ~394; `scriptStyle`/`markerVocab` ~1429–1430).
- Fixtures: `DEMO_BEATS` (~490), `DEMO_PILLS` (~632), and the `injectDemoScript`-style handler body they feed.
- Routes: `/tts/` (~753), `/export/` (~767), `POST /debug/export-script` (~823), `POST /debug/inject-script` (~1024), `POST /debug/regen-script` (~1243), `POST /debug/script-style` (~1304), `POST /debug/marker-vocab` (~1328).
- Starters + feed: `startInfographer({...})` (~1508), `startScriptifier({...})` (~1543), and `scriptifier.feed(...)` (~1773).
- SSE broadcasts of kinds `script:beats`, `script:ready`, `script:error`, `pills:beats`, `scriptstyle:setting`, `markervocab:setting`.

**In `package.json`:** remove the `"hyperframes": "^0.5.3"` devDependency (used only by the deleted `tts.ts` and `hyperframes-export.ts`).

- [ ] **Step 1: Delete the modules**

```bash
git rm src/scriptifier.ts src/infographer.ts src/tts.ts src/hyperframes-export.ts
```

- [ ] **Step 2: Strip pipeline wiring from server.ts** (anchors above)

- [ ] **Step 3: Remove the hyperframes devDependency**

Edit `package.json` to delete the `hyperframes` line under `devDependencies`, then:

```bash
bun install
```

- [ ] **Step 4: Verify no dangling references**

Run: `grep -rniE "scriptifier|infographer|generateTts|\btts\b|pillPlan|ScriptPayload|scriptStyle|markerVocab|exportToMp4|hyperframes" src/`
Expected: empty.
Run: `bun typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "remove legacy video pipeline (scriptifier/infographer/tts/export)"
```

---

### Task 3: Remove both panes from the frontend

**Files:**
- Modify: `public/index.html`

**Remove CSS:**
- The `.composer-pane*` block (starts ~746, the comment `/* composer-pane …`).
- The `.video-pane-legacy*` block (starts ~882) and the karaoke video-player / pill / style-vocab-picker styles that follow it.

**Remove markup (inside `#detail-pane`, ~2754):**
- `#d-composer-pane` (~2774), `#d-video-pane-legacy` (~2776), `#d-video-pane` (~2782), and the demo / regen / style-vocab picker controls within them.

**Remove JS:**
- The WebSocket handler else-if arms (~7434–7550): `scriptstyle:setting`, `markervocab:setting`, `script:beats`/`script:ready`, `pills:beats`, `script:error`, `composer:running`/`linting`/`ready`/`error`.
- The karaoke player, pill-rendering, tts-audio-playback, and composer-iframe helper functions these arms call (search their function names from the removed handler bodies).
- Any `fetch("/composer/…")` / `fetch("/tts/…")` / `fetch("/debug/…")` calls tied to the removed buttons.

**Re-flow:** ensure `#detail-pane` reads header → code-changes chart → LATEST EXCHANGE + chat, with no leftover gap where the panes were (remove wrapper divs, not just contents).

- [ ] **Step 1: Remove pane CSS, markup, and JS** (anchors above)

- [ ] **Step 2: Verify no dangling references**

Run: `grep -aniE "composer-pane|video-pane|pills:beats|scriptstyle|markervocab|d-video|d-composer" public/index.html`
Expected: empty.

- [ ] **Step 3: Drive the app**

```bash
bun src/server.ts   # background; port 3737
```
In a browser at `http://localhost:3737/`: select a live session. Confirm the detail pane shows only **header → chart → chat**, no empty panes or leftover spacing, and **zero console errors/warnings**.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "remove composer + legacy video panes from frontend"
```

---

### Task 4: Fix the "jsonl" session-classification leak

**Files:**
- Modify: `public/index.html` (`isInternalSession`, ~3522)

Replace the hardcoded per-role slug allowlist with a strict match on our two sandbox roots. The `--` (double-dash) tell comes from the hidden-dir boundary (`/.cut-the-cake` → `--cut-the-cake`), so a real repo cloned as `cut-the-cake` (single dash: `-workspace-cut-the-cake`) is never caught.

- [ ] **Step 1: Replace the function body**

```js
    function isInternalSession(sess) {
      const slug = sess?.info?.slug || '';
      return slug.includes('--cut-the-cake') || slug.includes('--chunk-to-chat');
    }
```

- [ ] **Step 2: Drive the app**

With the server running, load `http://localhost:3737/`. Confirm the **internal · sdk subprocesses** divider groups the observer + chat sessions, and there are **no unnamed "jsonl" cards** in the user-driven list above the divider.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "fix: strict internal-session classification (no more jsonl leaks)"
```

---

### Task 5: Collapsible sessions sidebar (thin icon rail)

**Files:**
- Modify: `public/index.html` — `.sidebar` CSS (~285), the `<aside class="sidebar">` header (~2745), the card-creation site (search `card.dataset.sessionId`), and the app-init JS.

**Interfaces (existing, reused):**
- `sessionColorVars(sessionId)` (~2918) sets inline `--accent` on each card element.
- `sessionName(sess)` returns the display name.
- Cards render into `#cards`; live cards contain a `.live-word` span.

- [ ] **Step 1: Add the toggle button to the sidebar header**

Replace the header line (`<h2 class="section-label">sessions</h2>`) with a header row containing the label and a chevron toggle:

```html
      <div class="sidebar-head">
        <h2 class="section-label">sessions</h2>
        <button class="sidebar-toggle" id="sidebar-toggle" type="button"
                aria-label="collapse sessions" aria-expanded="true">◀</button>
      </div>
```

- [ ] **Step 2: Add collapsed-rail CSS**

Add after the `.sidebar` block (~285):

```css
    .sidebar-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sidebar-toggle {
      border: none; background: transparent; color: var(--fg-muted);
      cursor: pointer; font-size: 11px; line-height: 1; padding: 4px;
      border-radius: 6px; transition: color .15s var(--ease-out), background .15s var(--ease-out);
    }
    .sidebar-toggle:hover { color: var(--accent); background: var(--chip-tint); }

    .sidebar.collapsed { width: 52px; min-width: 52px; }
    .sidebar.collapsed .section-label,
    .sidebar.collapsed .ambient-quiet,
    .sidebar.collapsed .inbox-separator-label,
    .sidebar.collapsed .empty-inbox { display: none; }
    .sidebar.collapsed .sidebar-head { justify-content: center; }
    .sidebar.collapsed .sidebar-toggle { transform: rotate(180deg); }

    /* cards collapse to color dots (accent comes from sessionColorVars) */
    .sidebar.collapsed .session-card { padding: 0; min-height: 0; height: 28px;
      display: flex; align-items: center; justify-content: center; }
    .sidebar.collapsed .session-card > * { display: none; }
    .sidebar.collapsed .session-card::before {
      content: ''; display: block; width: 12px; height: 12px; border-radius: 50%;
      background: var(--accent); opacity: 0.55;
    }
    .sidebar.collapsed .session-card:has(.live-word)::before { opacity: 1; }
    .sidebar.collapsed .session-card.selected::before {
      box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
    }
```

(Confirm the card element's class is `session-card` at the creation site; if it differs, use the actual class.)

- [ ] **Step 3: Add a hover title to each card (so the rail is legible)**

At the card-creation site (near `card.dataset.sessionId = …`), add:

```js
      card.title = sessionName(sess);
```

- [ ] **Step 4: Wire the toggle + persist**

In app-init JS (near the `autosend-toggle` wiring, ~2817):

```js
    const sidebarEl = document.querySelector(".sidebar");
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const SIDEBAR_KEY = "ctc:sidebar-collapsed";
    function paintSidebar(collapsed) {
      if (!sidebarEl || !sidebarToggle) return;
      sidebarEl.classList.toggle("collapsed", collapsed);
      sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      sidebarToggle.setAttribute("aria-label", collapsed ? "expand sessions" : "collapse sessions");
    }
    paintSidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
    sidebarToggle?.addEventListener("click", () => {
      const collapsed = !sidebarEl.classList.contains("collapsed");
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
      paintSidebar(collapsed);
    });
```

- [ ] **Step 5: Drive the app**

Load `http://localhost:3737/`. Click the chevron: sidebar collapses to a rail of color dots (live = full opacity, idle = dimmed, selected = ring); hovering a dot shows the session name; the chat pane widens. Click again to expand. Reload the page: collapsed state persists. Zero console errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: collapsible sessions sidebar (thin icon rail)"
```

---

## Self-Review

- **Spec coverage:** §1 backend removal → Tasks 1–2; §2 frontend pane removal → Task 3; §3 classification fix → Task 4; §4 collapsible sidebar → Task 5; §5 verification → each task's drive step + final. All covered.
- **Placeholders:** none — additions show complete code; deletions list exact symbols + a grep that must return empty.
- **Consistency:** `isInternalSession`, `sessionColorVars`, `sessionName`, `.session-card`, `#cards`, `autosend-toggle` names match the codebase as grepped. Two implementation-time confirmations flagged inline (composer/pipeline state field names in `SessionState`; the card element's class).
