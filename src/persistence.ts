// tiny disk persistence for user-visible session state (~/.sottochat/state.json).
// chat threads, summaries, and token counters survive server restarts; the chat
// subprocess itself does not — a restored thread is display history, and the
// next send spawns a fresh subprocess re-seeded from the latest turns.

import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { ChatChunk } from "./chat-agent";

export type ChatArchive = { archivedTs: number; chunks: ChatChunk[] };

// only state the boot-time jsonl replay can NOT rebuild belongs here: chat
// threads and summaries (model-derived, cost tokens to regenerate), the
// user-tuned context depth, and the summary cadence counter. token counters
// and model are deliberately absent — the tailer re-reads recent files in
// full at boot, so restoring them would double-count.
export type PersistedSession = {
  lastEventTs?: number;
  chatThread?: ChatChunk[];
  chatArchives?: ChatArchive[];
  summary?: string;
  summaryTs?: number;
  summaryLang?: string;
  chatContextTurns?: number;
  closedTurnCount?: number;
  customName?: string;
};

const STATE_DIR = join(homedir(), ".sottochat");
const STATE_FILE = join(STATE_DIR, "state.json");
const SAVE_DEBOUNCE_MS = 2_000;

export function loadPersistedSessions(): Map<string, PersistedSession> {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
      sessions?: Record<string, PersistedSession>;
    };
    if (!raw || typeof raw !== "object") return new Map();
    return new Map(Object.entries(raw.sessions ?? {}));
  } catch {
    // missing or corrupt file — start clean; the next save rewrites it.
    return new Map();
  }
}

export function startPersister(
  collect: () => Map<string, PersistedSession>,
  options: { stateFile?: string; saveDebounceMs?: number } = {},
): {
  /** debounced save — safe to call on every mutation. */
  schedule: () => void;
  /** synchronous save — for shutdown paths. */
  flush: () => void;
} {
  const stateFile = options.stateFile ?? STATE_FILE;
  const stateDir = dirname(stateFile);
  const saveDebounceMs = options.saveDebounceMs ?? SAVE_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function write(): void {
    let tmp: string | null = null;
    try {
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
      const sessions: Record<string, PersistedSession> = {};
      for (const [k, v] of collect()) sessions[k] = v;
      // Use a process-unique temporary name. Dev/scratch servers can run beside
      // the installed server, and a shared `state.json.tmp` lets one process
      // rename the other process's file out from under it.
      tmp = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(tmp, JSON.stringify({ sessions }));
      renameSync(tmp, stateFile);
      tmp = null;
    } catch (e) {
      console.error("[persist] save failed:", e);
    } finally {
      if (tmp && existsSync(tmp)) {
        try {
          unlinkSync(tmp);
        } catch {
          // best-effort cleanup; the state file itself was never replaced
        }
      }
    }
  }

  return {
    schedule() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        write();
      }, saveDebounceMs);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      write();
    },
  };
}
