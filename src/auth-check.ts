import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Best-effort detection of Claude credentials, used only to decide whether the
// startup banner and browser setup are shown. Must never throw: a false
// negative just means guidance the user can ignore. Only the method is exposed
// to the browser, never a token, key, email address, or account identifier.
export type ClaudeAuthMethod =
  | "api-key"
  | "oauth-token"
  | "bedrock"
  | "vertex"
  | "claude-code"
  | "none";

export type ClaudeAuthState = {
  configured: boolean;
  method: ClaudeAuthMethod;
};

export function flagEnabled(value: string | undefined): boolean {
  return !!value && value !== "0" && value.toLowerCase() !== "false";
}

export async function claudeAuthState(
  env: Record<string, string | undefined> = Bun.env,
): Promise<ClaudeAuthState> {
  if (env.ANTHROPIC_API_KEY) return { configured: true, method: "api-key" };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { configured: true, method: "oauth-token" };
  // Bedrock/Vertex setups authenticate outside Claude Code entirely.
  if (flagEnabled(env.CLAUDE_CODE_USE_BEDROCK)) return { configured: true, method: "bedrock" };
  if (flagEnabled(env.CLAUDE_CODE_USE_VERTEX)) return { configured: true, method: "vertex" };
  if (existsSync(join(homedir(), ".claude", ".credentials.json"))) {
    return { configured: true, method: "claude-code" };
  }
  if (process.platform === "darwin") {
    try {
      const proc = Bun.spawn(
        ["security", "find-generic-password", "-s", "Claude Code-credentials"],
        { stdout: "ignore", stderr: "ignore" },
      );
      const timeout = new Promise<number>((r) => setTimeout(() => r(1), 2_000));
      const code = await Promise.race([proc.exited, timeout]);
      if (code === 0) return { configured: true, method: "claude-code" };
      proc.kill();
    } catch {
      // `security` unavailable — fall through
    }
  }
  return { configured: false, method: "none" };
}

export async function hasClaudeCredentials(
  env: Record<string, string | undefined> = Bun.env,
): Promise<boolean> {
  return (await claudeAuthState(env)).configured;
}
