// tails the active claude code session jsonl. polls every 500ms,
// tracks byte offset, holds partial final line, dedupes by record uuid.
// borrowed pattern: claude-mem FileTailer (notes/claude-mem-patterns.md §1).

import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseRecord, type MetaEvent } from "./jsonl";

export type SessionInfo = { sessionId: string; path: string; slug: string };

export type TailerOptions = {
  projectSlug?: string;
  pollMs?: number;
  onEvent: (ev: MetaEvent) => void;
  onSession?: (info: SessionInfo) => void;
};

const PROJECTS_ROOT = join(homedir(), ".claude/projects");

async function findActiveJsonl(slug?: string): Promise<SessionInfo | null> {
  let bestPath: string | null = null;
  let bestMtime = -Infinity;
  let bestSession = "";
  let bestSlug = "";

  const tryDir = async (dir: string, dirSlug: string) => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try {
        const s = await stat(p);
        if (s.mtimeMs > bestMtime) {
          bestMtime = s.mtimeMs;
          bestPath = p;
          bestSession = f.replace(/\.jsonl$/, "");
          bestSlug = dirSlug;
        }
      } catch {
        // ignore
      }
    }
  };

  if (slug) {
    await tryDir(join(PROJECTS_ROOT, slug), slug);
  } else {
    let slugs: string[];
    try {
      slugs = await readdir(PROJECTS_ROOT);
    } catch {
      return null;
    }
    for (const s of slugs) await tryDir(join(PROJECTS_ROOT, s), s);
  }

  if (!bestPath) return null;
  return { path: bestPath, sessionId: bestSession, slug: bestSlug };
}

export function startTailer(opts: TailerOptions): { stop: () => void } {
  const pollMs = opts.pollMs ?? 500;
  const slug = opts.projectSlug;

  let activePath: string | null = null;
  let offset = 0;
  let partial = "";
  const seenUuids = new Set<string>();
  let stopped = false;

  const tick = async () => {
    const found = await findActiveJsonl(slug);
    if (!found) return;
    if (found.path !== activePath) {
      activePath = found.path;
      offset = 0;
      partial = "";
      opts.onSession?.(found);
    }

    const fh = await open(activePath, "r").catch(() => null);
    if (!fh) return;

    try {
      const s = await fh.stat();
      if (s.size < offset) {
        offset = 0;
        partial = "";
      }
      if (s.size === offset) return;

      const len = s.size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      offset = s.size;

      const text = partial + buf.toString("utf-8");
      const lines = text.split("\n");
      partial = lines.pop() ?? "";

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
          if (seenUuids.has(recUuid)) continue;
          seenUuids.add(recUuid);
        }
        for (const ev of parseRecord(raw)) opts.onEvent(ev);
      }
    } finally {
      await fh.close();
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
