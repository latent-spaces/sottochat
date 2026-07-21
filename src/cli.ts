#!/usr/bin/env bun

import packageJson from "../package.json" with { type: "json" };
import { formatStartupMessage, terminalSupportsColor } from "./startup-message";

const HELP = `sottochat ${packageJson.version}

A quiet back-channel for Claude Code and Codex sessions.

Usage:
  sottochat [options]

Options:
  -p, --port <port>   HTTP port (default: 3737)
      --no-observer   Disable background session summaries
  -h, --help          Show this help
  -v, --version       Show the version

Configuration can also be supplied through META_* environment variables.
`;

function fail(message: string): never {
  console.error(`sottochat: ${message}\nRun 'sottochat --help' for usage.`);
  process.exit(1);
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "-h" || arg === "--help") {
    console.log(HELP);
    process.exit(0);
  }
  if (arg === "-v" || arg === "--version") {
    console.log(packageJson.version);
    process.exit(0);
  }
  if (arg === "--no-observer") {
    process.env.META_OBSERVER_ENABLED = "0";
    continue;
  }
  if (arg === "-p" || arg === "--port") {
    const value = args[++i];
    const port = Number(value);
    if (!value || !Number.isInteger(port) || port < 1 || port > 65_535) {
      fail("--port must be an integer between 1 and 65535");
    }
    process.env.META_PORT = String(port);
    continue;
  }
  if (arg.startsWith("--port=")) {
    const port = Number(arg.slice("--port=".length));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      fail("--port must be an integer between 1 and 65535");
    }
    process.env.META_PORT = String(port);
    continue;
  }
  fail(`unknown option '${arg}'`);
}

async function sottochatRunningAt(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/state`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { sessions?: unknown };
    return Array.isArray(body?.sessions);
  } catch {
    return false;
  }
}

function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // best-effort; the URL is already printed
  }
}

// quiet by default: the packaged `sottochat` entry only prints the startup
// box, nothing else. `bun src/server.ts` (scratch/dev instances) stays verbose.
process.env.META_QUIET ??= "1";

// Env flags parsed above must land before settings loads its startup snapshot.
const { readStartupSetting } = await import("./settings");
const port = readStartupSetting("META_PORT", 3737, Bun.env, ["PORT"]);
if (await sottochatRunningAt(port)) {
  const url = `http://localhost:${port}/`;
  console.log(formatStartupMessage(url, {
    alreadyRunning: true,
    color: terminalSupportsColor(),
  }));
  openInBrowser(url);
  process.exit(0);
}

await import("./server");
openInBrowser(`http://localhost:${port}/`);
