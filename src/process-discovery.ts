// pure process-table utilities, ported from abtop's vendor/abtop/src/collector/process.rs.
// no I/O bigger than a single ps shell-out per call. consumers (claude-discovery,
// codex-discovery) call getProcessInfo() once per tick and pass the result around so
// every collector sees the same point-in-time snapshot.
//
// reference: abtop process.rs:170-205 (ps path), :208-214 (children map),
// :216-241 (has_active_descendant), :365-370 (last_path_segment),
// :381-392 (cmd_has_binary).

export type ProcInfo = {
  pid: number;
  ppid: number;
  cpuPct: number;
  command: string;
};

// Run `ps -axo pid,ppid,%cpu,command` once and parse the table. Bun.spawn here
// is faster than Node's child_process and lets us avoid pulling in a dep just
// for parsing. Output line shape on macOS:
//   "  PID  PPID  %CPU COMMAND"  (header)
//   "    1     0   0.0 /sbin/launchd"
// command field can contain whitespace, so we take the first 3 numeric columns
// and treat the rest as command (matches abtop's parts[4..].join(" ")).
export async function getProcessInfo(): Promise<Map<number, ProcInfo>> {
  const proc = Bun.spawn(["ps", "-axo", "pid,ppid,%cpu,command"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  const map = new Map<number, ProcInfo>();
  const lines = out.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // split into at most 4 chunks: pid, ppid, %cpu, rest-as-command.
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const cpuPct = Number(m[3]);
    const command = m[4] ?? "";
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    map.set(pid, { pid, ppid, cpuPct, command });
  }
  return map;
}

// ppid → [pid, ...] index, built from a ProcInfo map. Kept separate so
// callers that already have the map don't pay the spawn cost twice.
export function getChildrenMap(procs: Map<number, ProcInfo>): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const p of procs.values()) {
    let list = children.get(p.ppid);
    if (!list) {
      list = [];
      children.set(p.ppid, list);
    }
    list.push(p.pid);
  }
  return children;
}

// Recursive descendant walk. Returns true if any descendant has CPU% above
// the threshold. Used for "is this session running a tool right now?" — fast
// shells (e.g. `Bash rm ...`) finish between samples and miss this, so callers
// also check transcript-level pending-tool flags.
//
// abtop process.rs:216-241. Default threshold there is the caller's choice
// (they pass 5.0 for status detection). We expose the same knob.
export function hasActiveDescendant(
  pid: number,
  childrenMap: Map<number, number[]>,
  procs: Map<number, ProcInfo>,
  cpuThreshold: number = 5.0,
): boolean {
  const stack: number[] = [pid];
  const visited = new Set<number>();
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (visited.has(p)) continue;
    visited.add(p);
    const kids = childrenMap.get(p);
    if (!kids) continue;
    for (const kid of kids) {
      const info = procs.get(kid);
      if (info && info.cpuPct > cpuThreshold) return true;
      stack.push(kid);
    }
  }
  return false;
}

// Match `claude` or `codex` in argv[0..1], handling the autoupdater layout
// where the actual binary is named after its version (e.g. `<...>/claude/versions/2.1.121`).
// Basename equality alone misses that path.
//
// abtop process.rs:381-392 + tests :459-485. Unix variant only — we're Bun-on-mac.
export function cmdHasBinary(cmd: string, name: string): boolean {
  const tokens = cmd.split(/\s+/).slice(0, 2);
  for (const tok of tokens) {
    const parts = tok.split("/");
    const base = parts[parts.length - 1] ?? tok;
    if (base === name) return true;
    // <...>/<name>/versions/<file>
    if (parts.length >= 3) {
      const nm1 = parts[parts.length - 2];
      const nm2 = parts[parts.length - 3];
      if (nm1 === "versions" && nm2 === name) return true;
    }
  }
  return false;
}

// Last path segment (basename) for paths that may use `/` only. Mirrors
// abtop process.rs:365-370 unix variant.
export function lastPathSegment(s: string): string | undefined {
  const idx = s.lastIndexOf("/");
  if (idx < 0) return s || undefined;
  const seg = s.slice(idx + 1);
  return seg || undefined;
}
