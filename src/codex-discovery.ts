// codex-side process-driven session discovery, ported from
// vendor/abtop/src/collector/codex.rs (macOS arm — lsof-based).
//
// codex doesn't write a sessions/<pid>.json metadata file the way claude
// code does, so the only way to map a live codex PID to its rollout file is
// to read its open file descriptors. on macOS we shell out to `lsof -F pn`;
// on linux abtop reads /proc/<pid>/fd directly. we do lsof on both since
// we're a single-binary bun service and consistency wins over a free syscall.
//
// session metadata lives inside the jsonl as the first event:
//   {"type":"session_meta","payload":{"id":..., "cwd":..., "cli_version":...,
//    "timestamp":..., "git":{"branch":...}}}
// we parse only that first event for inbox purposes — token counts, tool
// calls, turn aggregation can land later in src/codex-jsonl.ts when we wire
// the parser into the existing turns.ts/observer.ts pipeline.
//
// reference map (rust → ts):
//   findCodexPidsFromShared      abtop codex.rs:299-316
//   mapPidToJsonl  (macOS arm)   abtop codex.rs:391-417
//   todaySessionDir              abtop codex.rs:151-162
//   parse_codex_jsonl (subset)   abtop codex.rs:580-688 (only session_meta)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cmdHasBinary, type ProcInfo } from "./process-discovery";

const HOME = homedir();
const DEFAULT_SESSIONS_DIR = join(HOME, ".codex", "sessions");

// abtop codex.rs:117 — only "recently finished" rollouts (< 5 min old) get
// pulled into the panel as Done rows. we don't render Done rows so the
// recently-finished pass is optional, but the constant matches abtop.
const RECENT_FINISH_MS = 5 * 60 * 1000;

export type CodexSession = {
  pid: number;          // 0 when the rollout is recently finished but no PID owns it
  sessionId: string;
  cwd: string;
  startedAt: number;    // ms since epoch
  version?: string;
  gitBranch?: string;
  rolloutPath: string;
  isExec: boolean;      // one-shot `codex exec` vs interactive
  isRecent: boolean;    // pid==0 + rolloutMtime within RECENT_FINISH_MS
};

// ── PID filter ────────────────────────────────────────────────────────────────
// abtop codex.rs:299-316. is_exec from `cmd.contains(" exec")` separates one-
// shot runs from interactive sessions; kept on the result so consumers can
// hide them like abtop does (mirrors our cc `--print` filter).
//
// we also drop `app-server` and `mcp-server` PIDs — those are the codex
// daemon/MCP layers, not user-facing sessions.
export function findCodexPids(procs: Map<number, ProcInfo>): { pid: number; isExec: boolean }[] {
  const out: { pid: number; isExec: boolean }[] = [];
  for (const p of procs.values()) {
    if (!cmdHasBinary(p.command, "codex")) continue;
    if (p.command.includes("app-server")) continue;
    if (p.command.includes("mcp-server")) continue;
    if (p.command.includes("grep")) continue; // matches abtop codex.rs:311
    out.push({ pid: p.pid, isExec: p.command.includes(" exec") });
  }
  return out;
}

// ── PID → open rollout-*.jsonl via lsof ──────────────────────────────────────
// abtop codex.rs:391-417 (macOS/lsof arm). `-F pn` prints one record per
// open file as alternating `pPID` and `nPATH` lines. we filter for paths
// matching `rollout-*.jsonl`. one rollout per PID; first match wins.
//
// running lsof in one batched invocation (`-p pid1,pid2,...`) is much
// cheaper than per-PID, especially with a few codex sessions live.
export async function mapPidToRollout(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (pids.length === 0) return map;

  const args: string[] = ["-F", "pn", ...pids.map((p) => `-p${p}`)];
  const proc = Bun.spawn(["lsof", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  let currentPid: number | undefined;
  for (const rawLine of out.split("\n")) {
    if (rawLine.length === 0) continue;
    const tag = rawLine[0];
    const value = rawLine.slice(1);
    if (tag === "p") {
      const pid = Number(value);
      currentPid = Number.isFinite(pid) ? pid : undefined;
    } else if (tag === "n" && currentPid !== undefined) {
      // already mapped this PID — wait for the next p-line.
      if (map.has(currentPid)) continue;
      const base = value.split("/").pop() ?? "";
      if (base.startsWith("rollout-") && base.endsWith(".jsonl")) {
        map.set(currentPid, value);
      }
    }
  }
  return map;
}

// ── today's sessions dir ──────────────────────────────────────────────────────
// codex writes rollouts under `~/.codex/sessions/YYYY/MM/DD/`. we also probe
// yesterday's dir for the timezone-rollover edge: a session started before
// midnight UTC writes to yesterday's dir even when 'today' has changed.
// returns most-recent-first.
export function recentSessionDirs(sessionsDir: string = DEFAULT_SESSIONS_DIR): string[] {
  const out: string[] = [];
  const now = new Date();
  const candidates: Date[] = [now, new Date(now.getTime() - 24 * 60 * 60 * 1000)];
  for (const d of candidates) {
    const yyyy = String(d.getFullYear()).padStart(4, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dir = join(sessionsDir, yyyy, mm, dd);
    if (existsSync(dir)) out.push(dir);
  }
  return out;
}

// ── session_meta-only parser ─────────────────────────────────────────────────
// abtop codex.rs:591-688 parses every event type. for the inbox card we only
// need session_meta, which is always the FIRST line. read just enough bytes
// to cover that line (~64KB upper bound — codex 0.125 includes a base
// instructions blob in the payload that can hit ~50KB).
type ParsedMeta = {
  sessionId: string;
  cwd: string;
  startedAt: number;
  version?: string;
  gitBranch?: string;
} | undefined;

export function parseSessionMeta(rolloutPath: string): ParsedMeta {
  let text: string;
  try {
    // read the first 256KB — covers any sane session_meta payload, including
    // codex's giant base_instructions blob. faster than streaming.
    const buf = readFileSync(rolloutPath);
    text = buf.toString("utf-8", 0, Math.min(buf.length, 256 * 1024));
  } catch {
    return undefined;
  }

  const nl = text.indexOf("\n");
  const firstLine = nl >= 0 ? text.slice(0, nl) : text;
  if (!firstLine.trim()) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(firstLine);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (o.type !== "session_meta") return undefined;
  const payload = o.payload as Record<string, unknown> | undefined;
  if (!payload) return undefined;

  const sessionId = typeof payload.id === "string" ? payload.id : "";
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const ts = typeof payload.timestamp === "string" ? payload.timestamp : "";
  if (!sessionId || !cwd || !ts) return undefined;

  const startedAt = Date.parse(ts);
  if (!Number.isFinite(startedAt)) return undefined;

  const version =
    typeof payload.cli_version === "string" ? payload.cli_version : undefined;
  const gitObj = payload.git as Record<string, unknown> | undefined;
  const gitBranch =
    gitObj && typeof gitObj.branch === "string" ? gitObj.branch : undefined;

  return { sessionId, cwd, startedAt, version, gitBranch };
}

// ── top-level discovery pass ──────────────────────────────────────────────────
// abtop codex.rs:38-148. one call per tick: live PIDs → rollout paths →
// parsed session_meta. recently-finished rollouts (< 5min old, no PID owner)
// are returned with pid=0 and isRecent=true so consumers can grey them out.
export async function discoverCodexSessions(
  procs: Map<number, ProcInfo>,
  opts: { sessionsDir?: string; includeRecent?: boolean } = {},
): Promise<CodexSession[]> {
  const sessionsDir = opts.sessionsDir ?? DEFAULT_SESSIONS_DIR;

  const codexPids = findCodexPids(procs);
  const justPids = codexPids.map((p) => p.pid);
  const isExecMap = new Map(codexPids.map((p) => [p.pid, p.isExec]));
  const pidToRollout = await mapPidToRollout(justPids);

  const out: CodexSession[] = [];
  const seenRollouts = new Set<string>();

  for (const [pid, rolloutPath] of pidToRollout) {
    const meta = parseSessionMeta(rolloutPath);
    if (!meta) continue;
    seenRollouts.add(rolloutPath);
    out.push({
      pid,
      sessionId: meta.sessionId,
      cwd: meta.cwd,
      startedAt: meta.startedAt,
      version: meta.version,
      gitBranch: meta.gitBranch,
      rolloutPath,
      isExec: isExecMap.get(pid) ?? false,
      isRecent: false,
    });
  }

  if (opts.includeRecent !== false) {
    const cutoff = Date.now() - RECENT_FINISH_MS;
    for (const dir of recentSessionDirs(sessionsDir)) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
        const path = join(dir, name);
        if (seenRollouts.has(path)) continue;
        let mtime = 0;
        try {
          mtime = statSync(path).mtimeMs;
        } catch {
          continue;
        }
        if (mtime < cutoff) continue;
        const meta = parseSessionMeta(path);
        if (!meta) continue;
        out.push({
          pid: 0,
          sessionId: meta.sessionId,
          cwd: meta.cwd,
          startedAt: meta.startedAt,
          version: meta.version,
          gitBranch: meta.gitBranch,
          rolloutPath: path,
          isExec: false,
          isRecent: true,
        });
      }
    }
  }

  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}
