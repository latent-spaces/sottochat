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
  // the CLI relocates its config (and credentials file) under CLAUDE_CONFIG_DIR
  const configDir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  if (existsSync(join(configDir, ".credentials.json"))) {
    return { configured: true, method: "claude-code" };
  }
  if (process.platform === "darwin") {
    try {
      const proc = Bun.spawn(
        ["security", "find-generic-password", "-s", "Claude Code-credentials"],
        { stdout: "ignore", stderr: "ignore" },
      );
      const timedOut = Symbol("timed-out");
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<typeof timedOut>((resolve) => {
        timeoutId = setTimeout(() => resolve(timedOut), 2_000);
      });
      const code = await Promise.race([proc.exited, timeout]);
      if (timeoutId) clearTimeout(timeoutId);
      if (code === 0) return { configured: true, method: "claude-code" };
      if (code === timedOut) proc.kill();
    } catch {
      // `security` unavailable — fall through
    }
  }
  return { configured: false, method: "none" };
}

// Env for SDK subprocesses. In headless mode the CLI always prefers an env
// ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN over the stored subscription login,
// so a stale key exported in the user's shell turns a working "Claude
// subscription" setup into "API Error: 401 API key is invalid". When login
// credentials exist, hand the subprocess an env without those overrides so the
// subscription wins; with no login they are the only way to authenticate and
// are kept. CLAUDE_CODE_OAUTH_TOKEN and Bedrock/Vertex flags are deliberate
// choices, not ambient leftovers — always kept.
export async function sdkSubprocessEnv(
  env: Record<string, string | undefined> = Bun.env,
): Promise<Record<string, string | undefined>> {
  const clean = { ...env };
  delete clean.ANTHROPIC_API_KEY;
  delete clean.ANTHROPIC_AUTH_TOKEN;
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) return clean;
  const withoutOverrides = await claudeAuthState(clean);
  const hasLogin =
    withoutOverrides.method === "claude-code" || withoutOverrides.method === "oauth-token";
  return hasLogin ? clean : { ...env };
}

export async function hasClaudeCredentials(
  env: Record<string, string | undefined> = Bun.env,
): Promise<boolean> {
  return (await claudeAuthState(env)).configured;
}
