import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Best-effort detection of Claude Code credentials, used only to decide
// whether the startup banner shows a "sign in" hint. Must never block or
// throw — a false negative just means a hint the user can ignore (e.g.
// exotic auth setups this can't see).
export function flagEnabled(value: string | undefined): boolean {
  return !!value && value !== "0" && value.toLowerCase() !== "false";
}

export async function hasClaudeCredentials(
  env: Record<string, string | undefined> = Bun.env,
): Promise<boolean> {
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  // Bedrock/Vertex setups authenticate outside Claude Code entirely.
  if (flagEnabled(env.CLAUDE_CODE_USE_BEDROCK) || flagEnabled(env.CLAUDE_CODE_USE_VERTEX)) return true;
  if (existsSync(join(homedir(), ".claude", ".credentials.json"))) return true;
  if (process.platform === "darwin") {
    try {
      const proc = Bun.spawn(
        ["security", "find-generic-password", "-s", "Claude Code-credentials"],
        { stdout: "ignore", stderr: "ignore" },
      );
      const timeout = new Promise<number>((r) => setTimeout(() => r(1), 2_000));
      const code = await Promise.race([proc.exited, timeout]);
      if (code === 0) return true;
      proc.kill();
    } catch {
      // `security` unavailable — fall through
    }
  }
  return false;
}
