// tails every cc-schema jsonl across all known sources. one file ↔ one
// FileState (offset, partial buffer, seenUuids), so two simultaneous
// claude code sessions don't fight over a shared offset (the old "flap"
// bug). pattern: claude-mem TranscriptWatcher (notes/claude-mem-patterns.md
// §1, §3), simplified — we re-glob each tick instead of watching roots.
//
// we only register a tailer for files whose mtime is within RECENT_MS,
// so historical sessions on disk don't get fully parsed on startup.
//
// sources covered:
//   - claude code cli:  ~/.claude/projects/<slug>/<uuid>.jsonl
//   - claude.app local-agent-mode:
//       ~/Library/Application Support/Claude/local-agent-mode-sessions/**
//       both audit.jsonl and nested .claude/projects/.../<uuid>.jsonl
// codex sessions use a different schema and are not yet wired.

import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Dirent } from "node:fs";
import { parseRecord, type MetaEvent } from "./jsonl";

export type SessionInfo = {
  sessionId: string;
  path: string;
  slug: string;
  source: string;
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
  discover: () => Promise<string[]>;
  describe: (path: string) => { slug: string; sessionId: string };
};

type FileState = {
  info: SessionInfo;
  offset: number;
  partial: string;
  seenUuids: Set<string>;
  announced: boolean;
};

const HOME = homedir();
const CC_PROJECTS = join(HOME, ".claude/projects");
const CLAUDE_APP_LAM = join(
  HOME,
  "Library/Application Support/Claude/local-agent-mode-sessions"
);

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

export function startTailer(opts: TailerOptions): { stop: () => void } {
  const pollMs = opts.pollMs ?? 500;
  const recentMs = opts.recentMs ?? 60 * 60 * 1000;
  const targets: WatchTarget[] = [
    ccTarget(opts.projectSlug),
    claudeAppTarget(),
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
        const recUuid = (raw as { uuid?: unknown })?.uuid;
        if (typeof recUuid === "string") {
          if (state.seenUuids.has(recUuid)) continue;
          state.seenUuids.add(recUuid);
        }
        const parsed = parseRecord(raw);
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

  void (async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (e) {
        console.error("[tailer]", e);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  })();

  return {
    stop: () => {
      stopped = true;
    },
  };
}
