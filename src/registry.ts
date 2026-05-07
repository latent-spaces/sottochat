// unified per-tick session discovery — the typescript counterpart of
// vendor/abtop/src/collector/mod.rs MultiCollector + SharedProcessData.
//
// one tick: fetch process table once, run both collectors against the same
// snapshot, return a sorted unified result. tick cadence is 2s (matches
// abtop main.rs:140). expensive work (children map, lsof for codex) only
// runs on slow ticks (every 5 ticks = 10s) — same gate abtop uses.
//
// reference map (rust → ts):
//   SharedProcessData            mod.rs:81-125
//   MultiCollector               mod.rs:136-269
//   SLOW_POLL_INTERVAL = 5       mod.rs:158
//   tick / collect orchestration mod.rs:206-241

import type { ClaudeSession } from "./claude-discovery";
import { discoverClaudeSessions } from "./claude-discovery";
import type { CodexSession } from "./codex-discovery";
import { discoverCodexSessions } from "./codex-discovery";
import {
  getProcessInfo,
  getChildrenMap,
  type ProcInfo,
} from "./process-discovery";

const TICK_MS_DEFAULT = 2_000;
const SLOW_POLL_INTERVAL = 5; // every Nth tick

// Unified per-session shape used by the server and UI. agent-specific fields
// live on the typed children below; the discriminated union lets consumers
// branch on `agent` without re-deriving capabilities. abtop's AgentSession
// is one big struct with cross-agent fields; we keep them split because the
// inbox doesn't need a flattened view yet.
export type RegistrySession =
  | ({ agent: "claude" } & ClaudeSession)
  | ({ agent: "codex" } & CodexSession);

export type RegistrySnapshot = {
  sessions: RegistrySession[];
  /** PID → ProcInfo for the tick that produced `sessions`. consumers that
   * want to derive Executing/Thinking from CPU can use this directly so we
   * don't re-fetch. */
  procs: Map<number, ProcInfo>;
  childrenMap: Map<number, number[]>;
  tookMs: number;
  fetchedAt: number;
  tickCount: number;
};

export type RegistryOptions = {
  tickMs?: number;
  /** When false, codex is skipped entirely. matches abtop's
   * MultiCollector::with_hidden(["codex"]). default on. */
  enableCodex?: boolean;
  /** When false, claude is skipped entirely. mostly useful for testing. */
  enableClaude?: boolean;
  /** Called after each tick with the freshest snapshot. for ws fanout. */
  onSnapshot?: (s: RegistrySnapshot) => void;
};

export type Registry = {
  /** Most recent snapshot (or undefined before the first tick lands). */
  current: () => RegistrySnapshot | undefined;
  /** Run a tick now. resolves with the snapshot. used by /diag and tests. */
  tick: () => Promise<RegistrySnapshot>;
  stop: () => void;
};

export function startRegistry(opts: RegistryOptions = {}): Registry {
  const tickMs = opts.tickMs ?? TICK_MS_DEFAULT;
  const enableCodex = opts.enableCodex !== false;
  const enableClaude = opts.enableClaude !== false;

  let stopped = false;
  let tickCount = 0;
  let last: RegistrySnapshot | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<RegistrySnapshot> | undefined;

  // Slow-tick rationale (mod.rs:101-107, :207-209): refreshing the children
  // map every 2s is fine on most machines, but we still gate codex's lsof
  // call to slow ticks because it's the only ~hundreds-of-ms shell-out in
  // the loop. claude discovery is pure node fs and runs every tick.
  const runOnce = async (): Promise<RegistrySnapshot> => {
    const t0 = performance.now();
    const procs = await getProcessInfo();
    const childrenMap = getChildrenMap(procs);
    const slowTick = tickCount % SLOW_POLL_INTERVAL === 0;

    const tasks: Promise<RegistrySession[]>[] = [];
    if (enableClaude) {
      tasks.push(
        Promise.resolve(
          discoverClaudeSessions(procs).map(
            (s) => ({ agent: "claude", ...s }) as RegistrySession,
          ),
        ),
      );
    }
    if (enableCodex && (slowTick || !last)) {
      tasks.push(
        discoverCodexSessions(procs).then((arr) =>
          arr.map((s) => ({ agent: "codex", ...s }) as RegistrySession),
        ),
      );
    } else if (enableCodex && last) {
      // reuse the previous codex set on fast ticks. abtop equivalent is
      // mod.rs:218-226 reusing cached_ports.
      tasks.push(Promise.resolve(last.sessions.filter((s) => s.agent === "codex")));
    }

    const buckets = await Promise.all(tasks);
    const sessions = buckets.flat();
    sessions.sort((a, b) => b.startedAt - a.startedAt);

    const snap: RegistrySnapshot = {
      sessions,
      procs,
      childrenMap,
      tookMs: performance.now() - t0,
      fetchedAt: Date.now(),
      tickCount,
    };
    last = snap;
    tickCount += 1;
    opts.onSnapshot?.(snap);
    return snap;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (stopped) return;
      inflight = runOnce()
        .catch((e) => {
          console.error("[registry] tick failed:", e);
          // return a stale-but-non-empty snapshot if we have one, otherwise
          // fall through to a synthetic empty so the loop continues.
          return (
            last ?? {
              sessions: [],
              procs: new Map(),
              childrenMap: new Map(),
              tookMs: 0,
              fetchedAt: Date.now(),
              tickCount,
            }
          );
        })
        .finally(() => {
          inflight = undefined;
          schedule();
        });
    }, tickMs);
  };

  // First tick fires immediately (callers want an answer before the first
  // 2s elapses). subsequent ticks are scheduled.
  inflight = runOnce()
    .catch((e) => {
      console.error("[registry] initial tick failed:", e);
      return (
        last ?? {
          sessions: [],
          procs: new Map(),
          childrenMap: new Map(),
          tookMs: 0,
          fetchedAt: Date.now(),
          tickCount,
        }
      );
    })
    .finally(() => {
      inflight = undefined;
      schedule();
    });

  return {
    current: () => last,
    tick: async () => {
      if (inflight) return inflight;
      return runOnce();
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
