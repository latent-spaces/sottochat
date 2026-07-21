// Informational logging, silenced when META_QUIET=1 (set by cli.ts for the
// packaged `sottochat` entry point). Errors always print — use console.error
// directly for those.
export function logInfo(...args: unknown[]): void {
  if (Bun.env.META_QUIET === "1") return;
  console.log(...args);
}
