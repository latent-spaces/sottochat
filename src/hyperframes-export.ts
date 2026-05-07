// hyperframes-export: render a ScriptPayload (beats + audio + word timings +
// markers) into a real shareable mp4 via the hyperframes cli. content-addressed
// cache keyed by sha256(beats + voice + audioHash + version) — second call for
// the same hash is an instant hit (the mp4 is already on disk).
//
// flow per fresh hash:
//   1. scaffold a project at <exportDir>/index.html. composition is built
//      mechanically by buildComposition() — fixed 1280x720, lyric-scroll
//      column, per-word highlights via gsap, marker banners on enter.
//   2. copy/symlink the source narration wav as <exportDir>/narration.wav
//      so the composition can reference it relatively.
//   3. (best-effort) `npx hyperframes lint --strict` — log warnings to
//      <exportDir>/render.log; never fail the export on lint output.
//   4. `npx hyperframes render --quality draft --output output.mp4 --workers
//      auto`. capture stdout + stderr to render.log so failures are diagnosable.
//   5. probeDuration via ffprobe + statSync().size for `bytes`.
//
// concurrency: in-flight requests for the same hash share a single promise so
// near-simultaneous calls don't double-render.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, copyFileSync } from "node:fs";
import { writeFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ScriptBeat } from "./scriptifier";
import type { WordTiming } from "./tts";

export type ExportResult = {
  hash: string;
  mp4Path: string;
  durationS: number;
  bytes: number;
};

export type ExportOptions = {
  turnId: string;
  beats: ScriptBeat[];
  audioPath: string;
  audioHash: string;
  words: WordTiming[];
  durationS: number;
  voice: string;
  style?: string;
};

const CACHE_DIR = join(homedir(), ".cut-the-cake", "exports");
// bump if the composition format changes — invalidates every cached mp4.
const COMPOSITION_VERSION = "v1";

// in-flight dedupe — keyed by hash. cleared on settle.
const inflight = new Map<string, Promise<ExportResult>>();

export function exportCacheDir(): string {
  return CACHE_DIR;
}

export function exportMp4Path(hash: string): string {
  return join(CACHE_DIR, hash, "output.mp4");
}

function exportDir(hash: string): string {
  return join(CACHE_DIR, hash);
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

// stable JSON.stringify for hashing. plain objects only get key-sorted; arrays
// keep their order (beats + words are order-significant). beats include their
// optional fields normalised so a missing `marker` and a `marker: undefined`
// hash the same.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
  }
  return `{${parts.join(",")}}`;
}

function hashFor(beats: ScriptBeat[], voice: string, audioHash: string): string {
  // include only the fields that affect the rendered mp4. the audio hash
  // already covers text + voice for the wav itself; we still hash beats so a
  // beat-level metadata change (marker, emphasis) without an audio change
  // invalidates the mp4. version literal lets us bust the cache when the
  // composition template changes.
  const normalisedBeats = beats.map((b) => ({
    text: b.text,
    ...(b.marker ? { marker: b.marker } : {}),
    ...(b.emphasis && b.emphasis.length ? { emphasis: b.emphasis } : {}),
  }));
  const payload = {
    beats: normalisedBeats,
    voice,
    audioHash,
    version: COMPOSITION_VERSION,
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

// run a child, append stdout + stderr to logPath. returns the captured stdout
// for callers that need it; rejects on non-zero exit with a tail of stderr.
function run(
  cmd: string,
  args: string[],
  cwd: string,
  logPath: string,
  label: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const writeChunk = (tag: string, chunk: Buffer) => {
      const text = chunk.toString();
      // best-effort log append — don't await. ordering is good-enough.
      void appendFile(logPath, `[${label}:${tag}] ${text}`).catch(() => {});
    };
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      writeChunk("stdout", d);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      writeChunk("stderr", d);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const tail = stderr.trim().split("\n").slice(-5).join("\n");
        reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${tail}`));
      }
    });
  });
}

async function probeDuration(wavPath: string, logPath: string): Promise<number> {
  const out = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", wavPath],
    join(wavPath, ".."),
    logPath,
    "ffprobe"
  );
  const n = parseFloat(out.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`ffprobe returned non-numeric duration: ${out.trim()}`);
  }
  return n;
}

// build the composition html as a string. pure function of the export options
// — no fs I/O, no module-level state — so the same inputs always produce the
// same html (composition cache key is hash-stable).
//
// layout:
//   - 1280x720 root, soft pink wash background
//   - top-left mono uppercase 14px label
//   - centered lyric-scroll column with current beat at 56px and prev/next
//     beats fading at 28px above/below
//   - per-word highlight tweens: backgroundColor on/off at word startS/endS
//   - beat-change tween: y translation on the column wrapper, 380ms power3.out
//   - marker banner overlay: slides from top, 240ms in / 1100ms hold / 240ms out
//   - bottom-right attribution + duration label
//
// timeline construction is fully synchronous; beats / words / boundaries are
// inlined as JSON so no fetches happen at render time. all eases are picked
// from a small bag (power3.out, power3.in, back.out(1.4), power2.inOut) so we
// satisfy hyperframes' "vary at least 3 different eases" guideline.
export function buildComposition(opts: ExportOptions): string {
  const dur = Math.max(opts.durationS, 0.5);
  const beatTokens = opts.beats.map((b) => tokenize(b.text));
  let cursor = 0;
  const beatBoundaries = opts.beats.map((b, i) => {
    const tokens = beatTokens[i] || [];
    const startWordIdx = cursor;
    cursor += tokens.length;
    const endWordIdx = cursor;
    const startW = opts.words[startWordIdx];
    const endW = opts.words[endWordIdx - 1];
    const fallbackPerBeat = opts.beats.length > 0 ? dur / opts.beats.length : 0;
    const startS = startW ? startW.startS : i * fallbackPerBeat;
    const endS = endW ? endW.endS : (i + 1) * fallbackPerBeat;
    return {
      beatIdx: i,
      startWordIdx,
      endWordIdx,
      startS,
      endS,
      marker: b.marker || null,
      text: b.text,
    };
  });

  // per-word inlining: which (beatIdx, indexInBeat) does each word time map to?
  // we emit one span per token and look up its startS/endS by global index.
  const totalTokens = cursor;
  const wordSchedules: Array<{ globalIdx: number; startS: number; endS: number }> = [];
  for (let i = 0; i < Math.min(totalTokens, opts.words.length); i++) {
    wordSchedules.push({
      globalIdx: i,
      startS: opts.words[i]!.startS,
      endS: opts.words[i]!.endS,
    });
  }

  // emphasis sets per beat (lowercase, punctuation-trimmed).
  const beatEmph = opts.beats.map((b) => {
    const set = new Set<string>();
    for (const e of b.emphasis || []) {
      const n = normaliseToken(e);
      if (n) set.add(n);
    }
    return set;
  });

  // beat-html: each beat is a wrapper with data-beat-idx and one span per token.
  // the outer column wrapper carries the y translation; individual beats carry
  // opacity and font-size tweens.
  let globalWordIdx = 0;
  const beatHtmlParts: string[] = [];
  for (let i = 0; i < opts.beats.length; i++) {
    const tokens = beatTokens[i] || [];
    const emph = beatEmph[i]!;
    const spans: string[] = [];
    for (const tok of tokens) {
      const isEmph = emph.has(normaliseToken(tok));
      const cls = "vb-word" + (isEmph ? " emph" : "");
      spans.push(
        `<span class="${cls}" id="vbw-${globalWordIdx}" data-word-idx="${globalWordIdx}">${escapeHtml(tok)}</span>`
      );
      globalWordIdx++;
    }
    beatHtmlParts.push(
      `<div class="vb-beat" id="vbb-${i}" data-beat-idx="${i}">${spans.join(" ")}</div>`
    );
  }
  const beatsHtml = beatHtmlParts.join("\n");

  // banner targets for marker beats — emitted into the dom upfront with
  // opacity:0 so the timeline can reveal them at the right time. one banner
  // div per marked beat, positioned absolutely over the column.
  const markedBeats = beatBoundaries.filter((b) => !!b.marker);
  const bannerHtml = markedBeats
    .map((b) => {
      const cls = "vb-banner " + (b.marker || "");
      const labelText = String(b.marker || "").toLowerCase().replace(/_/g, " ");
      return `<div class="${cls}" id="vbn-${b.beatIdx}">
  <div class="vbn-label">${escapeHtml(labelText)}</div>
  <div class="vbn-text">${escapeHtml(b.text)}</div>
</div>`;
    })
    .join("\n");

  const attribution = `narrated by scriptifier · ${escapeHtml(opts.voice)}`;
  const durLabel = formatDuration(dur);

  // timeline schedule data — inline JSON so no fetches at render time.
  const beatBoundariesJson = JSON.stringify(beatBoundaries);
  const wordSchedulesJson = JSON.stringify(wordSchedules);
  const markedBeatsJson = JSON.stringify(markedBeats.map((b) => ({ beatIdx: b.beatIdx, startS: b.startS })));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>cut-the-cake export · ${escapeHtml(opts.turnId)}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, #fff5f8 0%, #fffafc 60%);
      font-family: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif;
      color: #1f1320;
      -webkit-font-smoothing: antialiased;
    }
    [data-composition-id="root"] {
      position: relative;
      width: 1280px;
      height: 720px;
      overflow: hidden;
      background: linear-gradient(180deg, #fff5f8 0%, #fffafc 60%);
    }
    .corner-label {
      position: absolute;
      top: 32px;
      left: 40px;
      font-family: ui-monospace, "SFMono-Regular", "Menlo", monospace;
      font-size: 14px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #ec4899;
      font-weight: 600;
    }
    .corner-attribution {
      position: absolute;
      bottom: 28px;
      right: 40px;
      font-family: ui-monospace, "SFMono-Regular", "Menlo", monospace;
      font-size: 12px;
      letter-spacing: 0.06em;
      color: #7d5366;
      text-align: right;
    }
    .corner-attribution .ca-dur {
      display: inline-block;
      margin-left: 8px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(236, 72, 153, 0.35);
      color: #b6437b;
    }
    .vb-stage {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .vb-column {
      width: 1040px;
      max-width: 1040px;
      display: flex;
      flex-direction: column;
      gap: 28px;
      align-items: center;
      will-change: transform;
    }
    .vb-beat {
      width: 100%;
      text-align: center;
      font-size: 28px;
      line-height: 1.45;
      font-weight: 400;
      opacity: 0.22;
      will-change: transform, opacity, font-size;
      word-break: break-word;
    }
    .vb-word {
      display: inline-block;
      padding: 2px 4px;
      margin: 0 1px;
      border-radius: 6px;
      background-color: transparent;
      will-change: background-color;
    }
    .vb-word.emph {
      color: #ec4899;
      font-weight: 600;
    }
    .vb-banner {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      padding: 24px 48px;
      display: flex;
      align-items: center;
      gap: 18px;
      opacity: 0;
      transform: translateY(-100%);
      will-change: transform, opacity;
      z-index: 10;
      box-shadow: 0 8px 28px -16px rgba(31, 19, 32, 0.35);
    }
    .vb-banner .vbn-label {
      font-family: ui-monospace, "SFMono-Regular", "Menlo", monospace;
      font-size: 14px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-weight: 700;
      flex-shrink: 0;
    }
    .vb-banner .vbn-text {
      font-size: 22px;
      line-height: 1.35;
      font-weight: 500;
    }
    .vb-banner.INSIGHT     { background: #fde68a; color: #78350f; }
    .vb-banner.BE_CAREFUL  { background: #fed7aa; color: #7c2d12; }
    .vb-banner.STEP        { background: #dbeafe; color: #1e3a8a; }
    .vb-banner.NOTE        { background: #fffafc; color: #6b4757; border-bottom: 2px dashed rgba(107, 71, 87, 0.4); }
  </style>
</head>
<body>
  <audio id="narration" data-start="0" data-duration="${dur}" data-track-index="0" src="narration.wav" data-volume="1"></audio>
  <div data-composition-id="root" data-width="1280" data-height="720" data-start="0" data-duration="${dur}" data-track-index="1">
    <div class="corner-label">cut-the-cake · video pane</div>
    <div class="vb-stage">
      <div class="vb-column" id="vb-column">
${beatsHtml}
      </div>
    </div>
${bannerHtml}
    <div class="corner-attribution">${attribution}<span class="ca-dur">${escapeHtml(durLabel)}</span></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    (function () {
      window.__timelines = window.__timelines || {};
      var beatBoundaries = ${beatBoundariesJson};
      var wordSchedules = ${wordSchedulesJson};
      var markedBeats = ${markedBeatsJson};
      var totalDuration = ${dur};
      var tl = gsap.timeline({ paused: true });

      // initial layout: every beat starts faded, with the first beat as the
      // active "current" one (full opacity + 56px). beat 0's enter happens at
      // t=0 so the user sees a full layout in frame one.
      tl.set(".vb-beat", { opacity: 0.22, fontSize: 28, fontWeight: 400 }, 0);
      if (beatBoundaries.length > 0) {
        tl.set("#vbb-0", { opacity: 1, fontSize: 56, fontWeight: 500 }, 0);
      }

      // beat transitions: when a new beat becomes active, scroll the column so
      // it lands center, fade prev/next neighbours appropriately. fixed beat
      // height heuristic — center index * (avg beat height) pulls the column.
      var BEAT_PITCH = 110; // approximate gap-inclusive height per beat at 28px
      function scrollToBeat(idx, time) {
        var y = -(idx * BEAT_PITCH);
        tl.to("#vb-column", {
          y: y,
          duration: 0.38,
          ease: "power3.out",
        }, time);
      }
      // first beat is centered at t=0 (no scroll needed for idx 0).
      // for each subsequent beat, fade out the previous current, fade in the
      // new current at full opacity + 56px, scroll the column.
      for (var i = 0; i < beatBoundaries.length; i++) {
        var bb = beatBoundaries[i];
        if (i > 0) {
          var prev = beatBoundaries[i - 1];
          // previous beat: drop back to neighbour state
          tl.to("#vbb-" + prev.beatIdx, {
            opacity: 0.45,
            fontSize: 28,
            fontWeight: 400,
            duration: 0.28,
            ease: "power2.inOut",
          }, bb.startS);
          // promote new current
          tl.to("#vbb-" + bb.beatIdx, {
            opacity: 1,
            fontSize: 56,
            fontWeight: 500,
            duration: 0.32,
            ease: "back.out(1.4)",
          }, bb.startS);
          scrollToBeat(i, bb.startS);
        }
      }

      // per-word highlights: schedule a fill-on at word.startS and a fill-off
      // at word.endS. backgroundColor only — no display/visibility mutation.
      for (var w = 0; w < wordSchedules.length; w++) {
        var ws = wordSchedules[w];
        tl.to("#vbw-" + ws.globalIdx, {
          backgroundColor: "rgba(236, 72, 153, 0.28)",
          duration: 0.05,
          ease: "power2.out",
        }, Math.max(0, ws.startS));
        tl.to("#vbw-" + ws.globalIdx, {
          backgroundColor: "rgba(236, 72, 153, 0)",
          duration: 0.05,
          ease: "power2.in",
        }, Math.max(0, ws.endS));
      }

      // marker banners: slide in from top at beat startS, hold 1.1s, slide out.
      for (var m = 0; m < markedBeats.length; m++) {
        var mb = markedBeats[m];
        var sel = "#vbn-" + mb.beatIdx;
        var t0 = Math.max(0, mb.startS);
        tl.to(sel, {
          y: 0,
          yPercent: 0,
          opacity: 1,
          duration: 0.24,
          ease: "power3.out",
        }, t0);
        tl.to(sel, {
          y: 0,
          yPercent: -100,
          opacity: 0,
          duration: 0.24,
          ease: "power3.in",
        }, t0 + 0.24 + 1.1);
      }

      window.__timelines["root"] = tl;
    })();
  </script>
</body>
</html>
`;
}

function tokenize(s: string): string[] {
  return String(s || "").trim().split(/\s+/).filter(Boolean);
}

function normaliseToken(s: string): string {
  return String(s || "").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + (sec < 10 ? "0" : "") + sec;
}

async function exportOnce(opts: ExportOptions, hash: string): Promise<ExportResult> {
  ensureCacheDir();
  const dir = exportDir(hash);
  const outMp4 = join(dir, "output.mp4");
  const logPath = join(dir, "render.log");

  // cache hit — mp4 already on disk for this hash. probe + size only.
  if (existsSync(outMp4)) {
    const durationS = await probeDuration(outMp4, logPath).catch(() => opts.durationS);
    const bytes = (() => {
      try {
        return statSync(outMp4).size;
      } catch {
        return 0;
      }
    })();
    console.log(`[export] cache hit ${hash.slice(0, 8)} · ${durationS.toFixed(2)}s · ${bytes} bytes`);
    return { hash, mp4Path: outMp4, durationS, bytes };
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // wipe any stale log before this attempt so the log reflects only this run.
  await writeFile(logPath, `[export] ${new Date().toISOString()} · hash=${hash} · turnId=${opts.turnId} · voice=${opts.voice}\n`, "utf8");

  // copy the source wav next to the composition. copy (not symlink) so the
  // composition dir is portable / re-renderable from a backup.
  const localAudio = join(dir, "narration.wav");
  if (!existsSync(localAudio)) {
    copyFileSync(opts.audioPath, localAudio);
  }

  // write the composition html.
  const html = buildComposition(opts);
  await writeFile(join(dir, "index.html"), html, "utf8");

  // best-effort lint. captures output to render.log; we never fail the export
  // on lint warnings — they're informational.
  console.log(`[export] lint ${hash.slice(0, 8)}`);
  try {
    await run("npx", ["hyperframes", "lint"], dir, logPath, "lint");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[export] lint warned for ${hash.slice(0, 8)}: ${msg}`);
    // continue — lint failures shouldn't block render. detail is in render.log.
  }

  // render — mp4 only, draft quality, workers auto. capture to render.log.
  console.log(`[export] render ${hash.slice(0, 8)}`);
  const renderStart = Date.now();
  await run(
    "npx",
    [
      "hyperframes",
      "render",
      "--quality", "draft",
      "--output", "output.mp4",
      "--workers", "auto",
      "--format", "mp4",
    ],
    dir,
    logPath,
    "render"
  );
  console.log(`[export] render done ${hash.slice(0, 8)} in ${((Date.now() - renderStart) / 1000).toFixed(1)}s`);

  if (!existsSync(outMp4)) {
    throw new Error(`hyperframes render did not produce ${outMp4}`);
  }
  const durationS = await probeDuration(outMp4, logPath).catch(() => opts.durationS);
  const bytes = (() => {
    try {
      return statSync(outMp4).size;
    } catch {
      return 0;
    }
  })();
  return { hash, mp4Path: outMp4, durationS, bytes };
}

export function exportToMp4(opts: ExportOptions): Promise<ExportResult> {
  const hash = hashFor(opts.beats, opts.voice, opts.audioHash);
  const existing = inflight.get(hash);
  if (existing) return existing;
  const p = exportOnce(opts, hash).finally(() => {
    inflight.delete(hash);
  });
  inflight.set(hash, p);
  return p;
}
