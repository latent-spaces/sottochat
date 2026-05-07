// thin wrapper around `npx hyperframes tts` + `npx hyperframes transcribe`.
// content-addressed cache keyed by sha256(text + voice). second call for the
// same hash is a cache hit — read existing wav + words.json, no subprocess.
//
// flow per fresh hash:
//   1. write <hash>.txt with the script
//   2. spawn `npx hyperframes tts <hash>.txt --voice <voice> --output <hash>.wav`
//   3. spawn `npx hyperframes transcribe <hash>.wav` → produces transcript.json,
//      rename to <hash>.words.json
//   4. probe duration with ffprobe
//
// concurrency: in-flight requests for the same hash share one promise so two
// near-simultaneous calls don't double-spawn the toolchain.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type WordTiming = { text: string; startS: number; endS: number };

export type TtsResult = {
  hash: string;
  audioPath: string;
  durationS: number;
  words: WordTiming[];
};

export type TtsOptions = {
  text: string;
  voice?: string;
};

const DEFAULT_VOICE = Bun.env.META_TTS_VOICE ?? "af_heart";
const CACHE_DIR = join(homedir(), ".cut-the-cake", "tts-cache");

// in-flight dedupe — keyed by hash. cleared on settle.
const inflight = new Map<string, Promise<TtsResult>>();

export function ttsCacheDir(): string {
  return CACHE_DIR;
}

export function ttsAudioPath(hash: string): string {
  return join(CACHE_DIR, `${hash}.wav`);
}

function ttsTextPath(hash: string): string {
  return join(CACHE_DIR, `${hash}.txt`);
}

function ttsWordsPath(hash: string): string {
  return join(CACHE_DIR, `${hash}.words.json`);
}

function hashFor(text: string, voice: string): string {
  return createHash("sha256").update(`${voice}${text}`).digest("hex");
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

// run a child, return stdout. reject on non-zero exit, capturing stderr in the
// error message so the caller sees what hyperframes / ffprobe complained about.
function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
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

async function probeDuration(wavPath: string): Promise<number> {
  const out = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", wavPath],
    CACHE_DIR
  );
  const n = parseFloat(out.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`ffprobe returned non-numeric duration: ${out.trim()}`);
  }
  return n;
}

// hyperframes transcribe drops a `transcript.json` next to the wav (per smoke
// test). it's an array of {text, start, end} per word. shape may vary across
// versions — be permissive on field names.
async function readTranscript(transcriptPath: string): Promise<WordTiming[]> {
  const raw = await readFile(transcriptPath, "utf8");
  const parsed = JSON.parse(raw);
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { words?: unknown }).words)
      ? ((parsed as { words: unknown[] }).words)
      : [];
  const out: WordTiming[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : typeof o.word === "string" ? o.word : "";
    const startS =
      typeof o.start === "number"
        ? o.start
        : typeof o.startS === "number"
          ? o.startS
          : typeof o.start_time === "number"
            ? o.start_time
            : NaN;
    const endS =
      typeof o.end === "number"
        ? o.end
        : typeof o.endS === "number"
          ? o.endS
          : typeof o.end_time === "number"
            ? o.end_time
            : NaN;
    if (!text || !Number.isFinite(startS) || !Number.isFinite(endS)) continue;
    out.push({ text, startS, endS });
  }
  return out;
}

async function generateOnce(text: string, voice: string, hash: string): Promise<TtsResult> {
  ensureCacheDir();
  const wavPath = ttsAudioPath(hash);
  const wordsPath = ttsWordsPath(hash);

  // cache hit — we have both audio and timings already.
  if (existsSync(wavPath) && existsSync(wordsPath)) {
    const [words, durationS] = await Promise.all([readTranscript(wordsPath), probeDuration(wavPath)]);
    console.log(`[tts] cache hit ${hash.slice(0, 8)} · ${durationS.toFixed(2)}s · ${words.length} words`);
    return { hash, audioPath: wavPath, durationS, words };
  }

  // write the script to a file so hyperframes tts can read it. piping via
  // stdin would be nicer but the cli's convention is a path argument.
  const textPath = ttsTextPath(hash);
  await writeFile(textPath, text, "utf8");

  console.log(`[tts] generate ${hash.slice(0, 8)} · voice=${voice} · ${text.length} chars`);
  const ttsStart = Date.now();
  await run(
    "npx",
    ["hyperframes", "tts", textPath, "--voice", voice, "--output", `${hash}.wav`],
    CACHE_DIR
  );
  console.log(`[tts] tts done ${hash.slice(0, 8)} in ${((Date.now() - ttsStart) / 1000).toFixed(2)}s`);

  // transcribe drops a transcript.json next to the wav per the smoke test —
  // rename it to <hash>.words.json so concurrent jobs don't stomp each other.
  const transcribeStart = Date.now();
  await run("npx", ["hyperframes", "transcribe", `${hash}.wav`], CACHE_DIR);
  const defaultTranscript = join(CACHE_DIR, "transcript.json");
  if (!existsSync(defaultTranscript)) {
    throw new Error(`hyperframes transcribe did not produce ${defaultTranscript}`);
  }
  await rename(defaultTranscript, wordsPath);
  console.log(
    `[tts] transcribe done ${hash.slice(0, 8)} in ${((Date.now() - transcribeStart) / 1000).toFixed(2)}s`
  );

  const [words, durationS] = await Promise.all([readTranscript(wordsPath), probeDuration(wavPath)]);
  return { hash, audioPath: wavPath, durationS, words };
}

export function generateTts(opts: TtsOptions): Promise<TtsResult> {
  const text = opts.text;
  const voice = opts.voice ?? DEFAULT_VOICE;
  const hash = hashFor(text, voice);

  const existing = inflight.get(hash);
  if (existing) return existing;

  const p = generateOnce(text, voice, hash).finally(() => {
    inflight.delete(hash);
  });
  inflight.set(hash, p);
  return p;
}
