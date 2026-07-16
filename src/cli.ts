#!/usr/bin/env bun

import packageJson from "../package.json" with { type: "json" };

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

await import("./server");
