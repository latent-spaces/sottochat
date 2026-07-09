// tails every cc-schema jsonl across all known sources. one file ↔ one
// FileState (offset, partial buffer, seenUuids), so two simultaneous
// claude code sessions don't fight over a shared offset (the old "flap"
// bug). pattern: claude-mem TranscriptWatcher (notes/claude-mem-patterns.md
// §1, §3): per-tick re-glob as the steady-state baseline + a recursive
// fs.watch on each source root that wakes the tick the moment a new file
// appears — without it a brand-new session can be invisible for up to
// pollMs (default 500ms), and on systems where dir mtime caching is sticky
// the gap can stretch. fs.watch fires on creation so the next tick fires
// within milliseconds.
//
// we only register a tailer for files whose mtime is within RECENT_MS,
// so historical sessions on disk don't get fully parsed on startup.
//
// sources covered:
//   - claude code cli:  ~/.claude/projects/<slug>/<uuid>.jsonl
//   - claude.app local-agent-mode:
//       ~/Library/Application Support/Claude/local-agent-mode-sessions/**
//       both audit.jsonl and nested .claude/projects/.../<uuid>.jsonl
//   - codex cli:        ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//
// codex rollouts use a totally different schema (see codex-jsonl.ts) and
// require a stateful parser — the FileState carries an optional CodexParseState
// for codex-source files that the tailer threads through parseCodexRecord.

import { open, readdir, stat } from "node:fs/promises";
import { existsSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Dirent } from "node:fs";
import { parseRecord, type MetaEvent } from "./jsonl";
import { createCodexParseState, parseCodexRecord, type CodexParseState } from "./codex-jsonl";

export type SessionInfo = {
  sessionId: string;
  path: string;
  slug: string;
  source: string;
  /** the agent's real working directory, lifted from the raw jsonl `cwd` field.
   *  authoritative — the slug can't be reversed to a path (dashes are ambiguous). */
  cwd?: string;
};

export type TailerOptions = {
  pollMs?: number;
  projectSlug?: string;
  recentMs?: number;
  onEvent: (info: SessionInfo, ev: MetaEvent) => void;
  onSession?: (info: SessionInfo) => void;
};

type WatchTarget = {
  name: string;
  // root for the recursive fs.watch (must be a real dir on disk; if it
  // doesn't exist yet we just skip the watcher and rely on polling).
  watchRoot: string;
  discover: () => Promise<string[]>;
  describe: (path: string) => { slug: string; sessionId: string };
};

type FileState = {
  info: SessionInfo;
  offset: number;
  partial: string;
  seenUuids: Set<string>;
  announced: boolean;
  /** present only for source === "codex" — the codex parser is stateful. */
  codexState: CodexParseState | null;
};

const HOME = homedir();
const CC_PROJECTS = join(HOME, ".claude/projects");
const CLAUDE_APP_LAM = join(
  HOME,
  "Library/Application Support/Claude/local-agent-mode-sessions"
);
const CODEX_SESSIONS = join(HOME, ".codex/sessions");

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function listJsonlRecursive(root: string, depth = 8): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string, d: number): Promise<void> => {
    if (d < 0) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await visit(p, d - 1);
      } else if (e.isFile() && p.endsWith(".jsonl")) {
        out.push(p);
      }
    }
  };
  await visit(root, depth);
  return out;
}

function ccTarget(slugFilter?: string): WatchTarget {
  return {
    name: "claude-code",
    watchRoot: CC_PROJECTS,
    async discover() {
      let slugs: string[];
      try {
        slugs = await readdir(CC_PROJECTS);
      } catch {
        return [];
      }
      const wanted = slugFilter ? slugs.filter((s) => s === slugFilter) : slugs;
      const out: string[] = [];
      for (const s of wanted) {
        const dir = join(CC_PROJECTS, s);
        let entries: string[];
        try {
          entries = await readdir(dir);
        } catch {
          continue;
        }
        for (const f of entries) {
          if (f.endsWith(".jsonl")) out.push(join(dir, f));
        }
      }
      return out;
    },
    describe(path) {
      const parts = path.split("/");
      const filename = parts[parts.length - 1] ?? "";
      const slug = parts[parts.length - 2] ?? "";
      const sessionId = filename.replace(/\.jsonl$/, "");
      return { slug, sessionId };
    },
  };
}

function claudeAppTarget(): WatchTarget {
  return {
    name: "claude-app",
    watchRoot: CLAUDE_APP_LAM,
    async discover() {
      return await listJsonlRecursive(CLAUDE_APP_LAM, 8);
    },
    describe(path) {
      const parts = path.split("/");
      const filename = parts[parts.length - 1] ?? "";
      if (filename === "audit.jsonl") {
        const parent = parts[parts.length - 2] ?? "";
        const m = parent.match(UUID_RE);
        return { slug: parent, sessionId: m ? m[0] : parent };
      }
      const slug = parts[parts.length - 2] ?? "";
      const sessionId = filename.replace(/\.jsonl$/, "");
      return { slug, sessionId };
    },
  };
}

// codex rollout layout: ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl.
// the trailing UUID matches session_meta.payload.id, so we can read it from the
// filename for an immediate sessionId without parsing the file. slug is a
// date-based placeholder until session_meta is parsed and codex-jsonl mutates
// state.cwdSlug — the tailer lifts info.slug in the read loop once that lands.
function codexTarget(): WatchTarget {
  return {
    name: "codex",
    watchRoot: CODEX_SESSIONS,
    async discover() {
      return await listJsonlRecursive(CODEX_SESSIONS, 4);
    },
    describe(path) {
      const parts = path.split("/");
      const filename = parts[parts.length - 1] ?? "";
      const m = filename.match(UUID_RE);
      const sessionId = m ? m[0] : filename.replace(/\.jsonl$/, "");
      // placeholder slug from the date dir (YYYY/MM/DD) so the inbox card has
      // *something* to show before session_meta lands.
      const dateParts = parts.slice(-4, -1);
      const slug = "codex-" + dateParts.join("-");
      return { slug, sessionId };
    },
  };
}

export function startTailer(opts: TailerOptions): { stop: () => void } {
  const pollMs = opts.pollMs ?? 500;
  const recentMs = opts.recentMs ?? 60 * 60 * 1000;
  const targets: WatchTarget[] = [
    ccTarget(opts.projectSlug),
    claudeAppTarget(),
    codexTarget(),
  ];

  const files = new Map<string, FileState>();
  let stopped = false;

  const tickFile = async (path: string, target: WatchTarget) => {
    let mtimeMs = 0;
    try {
      const s = await stat(path);
      mtimeMs = s.mtimeMs;
    } catch {
      return;
    }

    let state = files.get(path);
    if (!state) {
      // never seen; skip if stale on disk
      if (Date.now() - mtimeMs > recentMs) return;
      const { slug, sessionId } = target.describe(path);
      state = {
        info: { path, slug, sessionId, source: target.name },
        offset: 0,
        partial: "",
        seenUuids: new Set(),
        announced: false,
        codexState: target.name === "codex" ? createCodexParseState() : null,
      };
      files.set(path, state);
    }

    const fh = await open(path, "r").catch(() => null);
    if (!fh) return;

    try {
      const s = await fh.stat();
      if (s.size < state.offset) {
        state.offset = 0;
        state.partial = "";
      }
      if (s.size === state.offset) return;

      const len = s.size - state.offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, state.offset);
      state.offset = s.size;

      const text = state.partial + buf.toString("utf-8");
      const lines = text.split("\n");
      state.partial = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          continue;
        }
        // lift the agent's real working directory off the raw record (claude
        // code writes `cwd` on every message record). stable per session.
        const recCwd = (raw as { cwd?: unknown })?.cwd;
        if (typeof recCwd === "string" && recCwd && state.info.cwd !== recCwd) {
          state.info.cwd = recCwd;
        }
        // claude records carry a uuid we dedup against; codex rollouts have
        // no per-record uuid and rely on the offset-based reader to skip
        // already-seen lines.
        const recUuid = (raw as { uuid?: unknown })?.uuid;
        if (typeof recUuid === "string") {
          if (state.seenUuids.has(recUuid)) continue;
          state.seenUuids.add(recUuid);
        }
        const parsed = state.codexState
          ? parseCodexRecord(raw, state.codexState)
          : parseRecord(raw);
        // codex's session_meta sets cwdSlug as a side-effect (it doesn't emit
        // a MetaEvent itself). lift the placeholder slug to the real one once
        // it arrives so subsequent onEvent calls carry the right info.
        if (state.codexState?.cwdSlug && state.info.slug !== state.codexState.cwdSlug) {
          state.info.slug = state.codexState.cwdSlug;
        }
        if (parsed.length === 0) continue;
        if (!state.announced) {
          state.announced = true;
          opts.onSession?.(state.info);
        }
        for (const ev of parsed) opts.onEvent(state.info, ev);
      }
    } finally {
      await fh.close();
    }
  };

  const tick = async () => {
    for (const target of targets) {
      let paths: string[];
      try {
        paths = await target.discover();
      } catch {
        continue;
      }
      for (const path of paths) {
        await tickFile(path, target);
      }
    }
  };

  // wake-up channel: fs.watch on each watchRoot raises a flag, and a single
  // sleep promise resolves either after pollMs or whenever that flag flips.
  // this collapses bursty notify storms into one extra tick rather than one
  // tick per fs.watch event (claude-mem §3 — "re-globbing is cheap because
  // tailers.has guards keep it idempotent" applies here too).
  let wakeResolve: (() => void) | null = null;
  let pendingWake = false;
  const wake = () => {
    pendingWake = true;
    if (wakeResolve) {
      const r = wakeResolve;
      wakeResolve = null;
      r();
    }
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (pendingWake) {
        pendingWake = false;
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        wakeResolve = null;
        pendingWake = false;
        resolve();
      }, ms);
      wakeResolve = () => {
        clearTimeout(timer);
        pendingWake = false;
        resolve();
      };
    });

  const watchers: FSWatcher[] = [];
  for (const target of targets) {
    if (!existsSync(target.watchRoot)) continue;
    try {
      const w = fsWatch(target.watchRoot, { recursive: true, persistent: false }, () => {
        wake();
      });
      w.on("error", () => {
        /* ignored — recursive watches occasionally drop on rename storms;
           the poller is the source of truth, the watch is a wake-up signal. */
      });
      watchers.push(w);
    } catch {
      // some platforms (older linux kernels, network mounts) reject recursive
      // watches; that's fine, polling still works.
    }
  }

  void (async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (e) {
        console.error("[tailer]", e);
      }
      await sleep(pollMs);
    }
  })();

  return {
    stop: () => {
      stopped = true;
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* swallow */
        }
      }
      watchers.length = 0;
      wake();
    },
  };
}
