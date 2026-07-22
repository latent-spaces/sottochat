import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAuthError, authErrorHint } from "../src/sdk-errors";
import { claudeAuthState, flagEnabled, sdkSubprocessEnv } from "../src/auth-check";

describe("isAuthError", () => {
  test("matches the real not-signed-in error from the SDK subprocess", () => {
    // captured from a live run with no valid credentials (diagnostics/auth-repro.ts)
    expect(
      isAuthError("Claude Code returned an error result: Invalid API key · Fix external API key")
    ).toBe(true);
    expect(
      isAuthError("Claude Code returned an error result: Not logged in · Please run /login")
    ).toBe(true);
  });

  test("matches the rejected-env-key error fresh installs hit", () => {
    // captured live: stale ANTHROPIC_API_KEY in the shell overrides the
    // subscription login and the CLI phrases the 401 with this word order
    expect(
      isAuthError(
        "Claude Code returned an error result: Failed to authenticate. API Error: 401 API key is invalid."
      )
    ).toBe(true);
    expect(
      isAuthError("Failed to authenticate: OAuth session expired and could not be refreshed")
    ).toBe(true);
    expect(isAuthError("Login expired · Please run /login")).toBe(true);
  });

  test("matches raw upstream authentication errors", () => {
    expect(
      isAuthError('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')
    ).toBe(true);
    expect(isAuthError("OAuth token has been revoked · Please run /login")).toBe(true);
    expect(isAuthError("Your session has expired. Please run /login to sign in again.")).toBe(true);
  });

  test("does not match transient or unrelated errors", () => {
    expect(isAuthError("fetch failed")).toBe(false);
    expect(isAuthError("Claude Code process exited with code 1")).toBe(false);
    expect(isAuthError("rate limit exceeded, retry after 60s")).toBe(false);
    expect(isAuthError("Overloaded")).toBe(false);
    expect(isAuthError("failed to authenticate with proxy server")).toBe(false);
  });
});

describe("authErrorHint", () => {
  test("blames the API key when one is configured — logging in would not fix it", () => {
    expect(authErrorHint({ ANTHROPIC_API_KEY: "sk-ant-bogus" })).toContain("ANTHROPIC_API_KEY");
  });

  test("blames the auth token when that is what is configured", () => {
    expect(authErrorHint({ ANTHROPIC_AUTH_TOKEN: "tok-bogus" })).toContain("ANTHROPIC_AUTH_TOKEN");
  });

  test("points to Claude Code login when no key is configured", () => {
    expect(authErrorHint({})).toContain("run `claude`");
  });
});

describe("flagEnabled", () => {
  test("treats 0 and false as disabled, not as configured credentials", () => {
    expect(flagEnabled("0")).toBe(false);
    expect(flagEnabled("false")).toBe(false);
    expect(flagEnabled("")).toBe(false);
    expect(flagEnabled(undefined)).toBe(false);
    expect(flagEnabled("1")).toBe(true);
    expect(flagEnabled("true")).toBe(true);
  });
});

describe("sdkSubprocessEnv", () => {
  test("passes the env through untouched when no key overrides are set", async () => {
    const env = { PATH: "/usr/bin", HOME: "/home/u" };
    expect(await sdkSubprocessEnv(env)).toEqual(env);
  });

  test("drops a stray ANTHROPIC_API_KEY when subscription credentials exist", async () => {
    // CLAUDE_CODE_OAUTH_TOKEN stands in for the login here because keychain /
    // credentials-file detection depends on the machine running the tests.
    const out = await sdkSubprocessEnv({
      ANTHROPIC_API_KEY: "sk-ant-stale",
      ANTHROPIC_AUTH_TOKEN: "tok-stale",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-good",
      PATH: "/usr/bin",
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-good");
    expect(out.PATH).toBe("/usr/bin");
  });

  test("keeps the key for bedrock/vertex setups — it is not what authenticates them", async () => {
    const out = await sdkSubprocessEnv({
      ANTHROPIC_API_KEY: "sk-ant-x",
      CLAUDE_CODE_USE_BEDROCK: "1",
    });
    expect(out.ANTHROPIC_API_KEY).toBe("sk-ant-x");
  });
});

describe("claudeAuthState", () => {
  test("reports the configured method without exposing its value", async () => {
    const state = await claudeAuthState({ ANTHROPIC_API_KEY: "sk-ant-secret" });

    expect(state).toEqual({ configured: true, method: "api-key" });
    expect(JSON.stringify(state)).not.toContain("sk-ant-secret");
  });

  test("finds login credentials under a custom CLAUDE_CONFIG_DIR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-config-"));
    writeFileSync(join(dir, ".credentials.json"), "{}");
    expect(await claudeAuthState({ CLAUDE_CONFIG_DIR: dir })).toEqual({
      configured: true,
      method: "claude-code",
    });
  });

  test("distinguishes externally authenticated cloud providers", async () => {
    expect(await claudeAuthState({ CLAUDE_CODE_USE_BEDROCK: "1" })).toEqual({
      configured: true,
      method: "bedrock",
    });
    expect(await claudeAuthState({ CLAUDE_CODE_USE_VERTEX: "true" })).toEqual({
      configured: true,
      method: "vertex",
    });
  });
});
