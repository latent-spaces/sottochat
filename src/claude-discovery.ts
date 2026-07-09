// claude-side process-driven session discovery, ported methodically from
// vendor/abtop/src/collector/claude.rs. drives the inbox by asking "which
// claude PIDs are alive and what session metadata do they own?", instead of
// the legacy "what jsonl files have a recent mtime?" heuristic.
//
// scope: default config dir (~/.claude) only. CLAUDE_CONFIG_DIR discovery via
// /proc/<pid>/environ (linux) or libproc (mac) is deferred — none of our
// current users hit it. lsof-based open-fd discovery for non-default dirs
// can land later in a separate module if needed.
//
// reference map (rust → ts):
//   ConfigDir                   abtop claude.rs:20-41
//   findClaudePids              abtop claude.rs:228-237  (also filters --print)
//   findSessionFileForPid       abtop claude.rs:1079-1108
//   buildDiscoveryContext       abtop claude.rs:935-981
//   resolveProjectDir           abtop claude.rs:988-1024 (worktree fallback)
//   encodeCwdPath               abtop claude.rs:1543-1550 (exact rule: / \ : _ . → -)
//   findLiveSessionId           abtop claude.rs:1035-1077 (/clear repair)
//   loadSession                 abtop claude.rs:269-326
//
// Where the local schema is *richer* than abtop assumes (status, entrypoint,
// updatedAt, name fields written by cc 2.1.119+), we use it directly instead
// of inferring from the transcript. abtop has to derive liveness from FD/cpu;
// we read it from the SessionFile.

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  cmdHasBinary,
  type ProcInfo,
} from "./process-discovery";

const HOME = homedir();
const DEFAULT_BASE_DIR = join(HOME, ".claude");

// `/clear` minted-jsonl mtime can land slightly before sessions/{PID}.json's
// startedAt (FS granularity + cc flushing the first transcript line ≥1s after
// recording the start time). The 5s grace window matches abtop claude.rs:1043.
const STARTED_AT_GRACE_MS = 5_000;

// abtop's `--print` filter at claude.rs:322 hides one-shot summary spawns.
// our SDK loops set `entrypoint:"sdk-cli"` in sessions/{PID}.json and live
// under ~/.sottochat/, so we filter on those fields directly — cleaner than the
// slug-matching self-feed filter the legacy server.ts uses. we keep matching the
// two legacy roots (~/.cut-the-cake chat, ~/.chunk-to-chat observer) so older
// sessions still on disk stay classified internal instead of leaking to the inbox.
const SDK_CWD_PREFIXES = [
  join(HOME, ".sottochat"),
  join(HOME, ".cut-the-cake"),
  join(HOME, ".chunk-to-chat"),
];

export type ConfigDir = {
  baseDir: string;     // ~/.claude
  sessionsDir: string; // ~/.claude/sessions
  projectsDir: string; // ~/.claude/projects
};

// Mirrors the json on disk at sessions/<pid>.json. We accept the optional
// fields cc 2.1.119+ writes (status, entrypoint, updatedAt, name) but stay
// permissive — older versions only had pid/sessionId/cwd/startedAt.
export type SessionFile = {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  version?: string;
  entrypoint?: "cli" | "sdk-cli" | string;
  kind?: string;
  status?: "busy" | "idle" | string;
  updatedAt?: number;
  name?: string;
  procStart?: string;
};

// Result of a discovery pass — one entry per live, non-internal claude PID
// with its SessionFile + resolved transcript path. consumers (server.ts,
// the tailer) drive the inbox off this set.
export type ClaudeSession = {
  pid: number;
  sessionId: string;     // post-/clear-repair sid
  originalSessionId: string; // sid as written in sessions/{PID}.json (may be stale)
  cwd: string;
  startedAt: number;
  updatedAt?: number;
  status?: string;
  name?: string;
  version?: string;
  entrypoint?: string;
  transcriptPath?: string;
  projectDir?: string;
  configBaseDir: string;
  isInternal: boolean;   // entrypoint=sdk-cli && cwd under ~/.sottochat/ (or a legacy root)
};

export function defaultConfigDir(): ConfigDir {
  return makeConfigDir(DEFAULT_BASE_DIR);
}

export function makeConfigDir(baseDir: string): ConfigDir {
  return {
    baseDir,
    sessionsDir: join(baseDir, "sessions"),
    projectsDir: join(baseDir, "projects"),
  };
}

// ── PID filter ────────────────────────────────────────────────────────────────
// abtop claude.rs:228-237. `--print` is cc's one-shot summary mode — never
// a real session. We don't check `entrypoint:"sdk-cli"` here because that's
// in sessions/{PID}.json which we read later; it's marked `isInternal` on
// the resulting ClaudeSession so consumers can hide it but other tools (e.g.
// diagnostics) can still see it.
export function findClaudePids(procs: Map<number, ProcInfo>): number[] {
  const out: number[] = [];
  for (const p of procs.values()) {
    if (cmdHasBinary(p.command, "claude") && !p.command.includes("--print")) {
      out.push(p.pid);
    }
  }
  return out;
}

// ── sessions/{PID}.json lookup ────────────────────────────────────────────────
// abtop claude.rs:1079-1108. Direct path-by-PID is the fast path; the scan
// fallback handles the rare case where cc writes the file under a different
// name (we haven't seen this on 2.1.119, but abtop ships the fallback so we
// keep parity).
export function findSessionFileForPid(config: ConfigDir, pid: number): string | undefined {
  const direct = join(config.sessionsDir, `${pid}.json`);
  if (existsSync(direct) && !isSymlink(direct)) return direct;

  let entries: string[];
  try {
    entries = readdirSync(config.sessionsDir);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(config.sessionsDir, name);
    if (isSymlink(path)) continue;
    const sf = readSessionFile(path);
    if (sf?.pid === pid) return path;
  }
  return undefined;
}

export function readSessionFile(path: string): SessionFile | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  const pid = typeof o.pid === "number" ? o.pid : NaN;
  const sessionId = typeof o.sessionId === "string" ? o.sessionId : "";
  const cwd = typeof o.cwd === "string" ? o.cwd : "";
  const startedAt = typeof o.startedAt === "number" ? o.startedAt : 0;
  if (!Number.isFinite(pid) || !sessionId || !cwd || !startedAt) return undefined;
  return {
    pid,
    sessionId: truncate(sessionId, 256),
    cwd: truncate(cwd, 4096),
    startedAt,
    version: typeof o.version === "string" ? o.version : undefined,
    entrypoint: typeof o.entrypoint === "string" ? o.entrypoint : undefined,
    kind: typeof o.kind === "string" ? o.kind : undefined,
    status: typeof o.status === "string" ? o.status : undefined,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : undefined,
    name: typeof o.name === "string" ? o.name : undefined,
    procStart: typeof o.procStart === "string" ? o.procStart : undefined,
  };
}

// ── per-tick discovery context ────────────────────────────────────────────────
// abtop claude.rs:935-981. Two derived maps used to gate /clear repair:
//   - pids_per_cwd: when >1 active cc PIDs share a cwd, we don't repair the
//     stale sid because we can't tell which PID owns a freshly-created jsonl.
//   - claimed_sids_by_pid: when repairing, exclude sids already claimed by
//     ANOTHER PID — otherwise we'd hijack a sibling's transcript.
type DiscoveryContext = {
  claimedSidsByPid: Map<number, string>;
  pidsPerCwd: Map<string, number>;
};

function buildDiscoveryContext(
  sessionPaths: string[],
  procs: Map<number, ProcInfo>,
): DiscoveryContext {
  const claimedSidsByPid = new Map<number, string>();
  const pidsPerCwd = new Map<string, number>();
  const seenPids = new Set<number>();

  for (const path of sessionPaths) {
    const sf = readSessionFile(path);
    if (!sf) continue;
    if (seenPids.has(sf.pid)) continue;
    seenPids.add(sf.pid);

    // Same gate abtop applies (claude.rs:960-973): only count PIDs that are
    // alive AND actually claude AND not --print. Stale {PID}.json files from
    // crashed sessions would otherwise inflate pids_per_cwd and silently
    // suppress the /clear sid override for the real session sharing that cwd.
    const info = procs.get(sf.pid);
    if (!info) continue;
    if (!cmdHasBinary(info.command, "claude")) continue;
    if (info.command.includes("--print")) continue;

    pidsPerCwd.set(sf.cwd, (pidsPerCwd.get(sf.cwd) ?? 0) + 1);
    claimedSidsByPid.set(sf.pid, sf.sessionId);
  }

  return { claimedSidsByPid, pidsPerCwd };
}

// ── path encoding ─────────────────────────────────────────────────────────────
// abtop claude.rs:1543-1550. cc encodes the cwd into the project-dir slug by
// replacing /, \, :, _, . with `-`. Our prior naive `cwd.replace('/','-')` was
// wrong — it leaves underscores and dots intact, which silently mismatches
// project dirs for any path containing them (e.g. `/Users/me/foo.bar`).
export function encodeCwdPath(cwd: string): string {
  let out = "";
  for (const ch of cwd) {
    if (ch === "/" || ch === "\\" || ch === ":" || ch === "_" || ch === ".") {
      out += "-";
    } else {
      out += ch;
    }
  }
  return out;
}

// ── project-dir resolution (with worktree fallback) ──────────────────────────
// abtop claude.rs:988-1024. Worktree sessions live under a dir keyed by the
// branch name, NOT the encoded cwd, so the encoded path may not contain the
// transcript. Fallback scans every projects/ subdir for one containing the
// original sid's .jsonl.
export function resolveProjectDir(
  config: ConfigDir,
  cwd: string,
  originalSid: string,
): string | undefined {
  const encoded = encodeCwdPath(cwd);
  const primary = join(config.projectsDir, encoded);
  const jsonlName = `${originalSid}.jsonl`;

  const primaryHasOriginal = (() => {
    const p = join(primary, jsonlName);
    return existsSync(p) && !isSymlink(p);
  })();
  if (primaryHasOriginal) return primary;

  let entries: string[];
  try {
    entries = readdirSync(config.projectsDir);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    const path = join(config.projectsDir, name);
    if (isSymlink(path)) continue;
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const candidate = join(path, jsonlName);
    if (existsSync(candidate) && !isSymlink(candidate)) {
      return path;
    }
  }

  // original transcript is missing (deleted, or never flushed yet). fall back
  // to the encoded-cwd dir if it exists so live-sid lookup still has a place
  // to scan.
  try {
    if (statSync(primary).isDirectory()) return primary;
  } catch {
    /* not a dir */
  }
  return undefined;
}

// ── /clear repair ─────────────────────────────────────────────────────────────
// abtop claude.rs:1035-1077. /clear mints a new sessionId + new {sid}.jsonl
// without rewriting sessions/{PID}.json. The fresh transcript is always
// present in the same project dir, so we pick the most recently modified
// jsonl whose mtime is within (startedAt - 5s). `excluded` blocks sibling
// PIDs' sids from being adopted as our own.
export function findLiveSessionId(
  projectDir: string | undefined,
  startedAtMs: number,
  excluded: Set<string>,
): string | undefined {
  if (!projectDir) return undefined;
  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch {
    return undefined;
  }

  const minMtimeMs = Math.max(0, startedAtMs - STARTED_AT_GRACE_MS);

  let bestMtimeMs = -1;
  let bestStem: string | undefined;

  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const stem = name.slice(0, -".jsonl".length);
    if (excluded.has(stem)) continue;
    const path = join(projectDir, name);
    if (isSymlink(path)) continue;
    let mtimeMs = 0;
    try {
      const s = statSync(path);
      mtimeMs = s.mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < minMtimeMs) continue;
    if (mtimeMs > bestMtimeMs) {
      bestMtimeMs = mtimeMs;
      bestStem = stem;
    }
  }

  return bestStem;
}

// ── per-PID load (with /clear repair gated by sibling count) ─────────────────
// abtop claude.rs:269-326. Returns one ClaudeSession per PID, with a
// post-repair sessionId and resolved transcript path.
export function loadSession(
  config: ConfigDir,
  procs: Map<number, ProcInfo>,
  ctx: DiscoveryContext,
  sessionFilePath: string,
): ClaudeSession | undefined {
  const sf = readSessionFile(sessionFilePath);
  if (!sf) return undefined;

  const procCmd = procs.get(sf.pid)?.command;
  const pidAlive = procCmd ? cmdHasBinary(procCmd, "claude") : false;
  if (!pidAlive) return undefined;
  if (procCmd?.includes("--print")) return undefined;

  const projectDir = resolveProjectDir(config, sf.cwd, sf.sessionId);

  // /clear repair — gated by single-PID-per-cwd (claude.rs:297-312). When
  // multiple cc PIDs share a cwd, we can't tell which one owns a freshly-
  // created jsonl, so we leave the sid alone.
  let sessionId = sf.sessionId;
  const siblings = ctx.pidsPerCwd.get(sf.cwd) ?? 1;
  if (siblings <= 1) {
    const excluded = new Set<string>();
    for (const [otherPid, sid] of ctx.claimedSidsByPid) {
      if (otherPid !== sf.pid) excluded.add(sid);
    }
    const liveSid = findLiveSessionId(projectDir, sf.startedAt, excluded);
    if (liveSid && liveSid !== sf.sessionId) {
      sessionId = liveSid;
    }
  }

  const transcriptPath = (() => {
    if (!projectDir) return undefined;
    const p = join(projectDir, `${sessionId}.jsonl`);
    if (existsSync(p) && !isSymlink(p)) return p;
    return undefined;
  })();

  const isInternal =
    sf.entrypoint === "sdk-cli" &&
    SDK_CWD_PREFIXES.some((p) => sf.cwd.startsWith(p));

  return {
    pid: sf.pid,
    sessionId,
    originalSessionId: sf.sessionId,
    cwd: sf.cwd,
    startedAt: sf.startedAt,
    updatedAt: sf.updatedAt,
    status: sf.status,
    name: sf.name,
    version: sf.version,
    entrypoint: sf.entrypoint,
    transcriptPath,
    projectDir,
    configBaseDir: config.baseDir,
    isInternal,
  };
}

// ── top-level discovery pass ──────────────────────────────────────────────────
// One call per tick. abtop claude.rs:100-149 collect_sessions + the
// session_paths assembly. We skip the active-config-dir scanning step (only
// the default ~/.claude); CLAUDE_CONFIG_DIR support can land later.
export function discoverClaudeSessions(
  procs: Map<number, ProcInfo>,
  configs: ConfigDir[] = [defaultConfigDir()],
): ClaudeSession[] {
  // Build the candidate session-file path list. abtop claude.rs:108-133 also
  // includes "active session paths" derived from open-FDs, but for the
  // default config dir, scanning sessions/ is the same set.
  const sessionPaths: { path: string; config: ConfigDir }[] = [];
  for (const config of configs) {
    let entries: string[];
    try {
      entries = readdirSync(config.sessionsDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const path = join(config.sessionsDir, name);
      if (isSymlink(path)) continue;
      sessionPaths.push({ path, config });
    }
  }

  const ctx = buildDiscoveryContext(
    sessionPaths.map((s) => s.path),
    procs,
  );

  const out: ClaudeSession[] = [];
  const seenSids = new Set<string>();
  for (const { path, config } of sessionPaths) {
    const sess = loadSession(config, procs, ctx, path);
    if (!sess) continue;
    if (seenSids.has(sess.sessionId)) continue;
    seenSids.add(sess.sessionId);
    out.push(sess);
  }

  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return true; // fail-closed (matches abtop is_symlink default)
  }
}

function truncate(s: string, maxBytes: number): string {
  if (s.length <= maxBytes) return s;
  return s.slice(0, maxBytes);
}
