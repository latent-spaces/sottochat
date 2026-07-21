import { describe, expect, test } from "bun:test";
import { isAuthError, authErrorHint } from "../src/sdk-errors";
import { flagEnabled } from "../src/auth-check";

describe("isAuthError", () => {
  test("matches the real not-signed-in error from the SDK subprocess", () => {
    // captured from a live run with no valid credentials (diagnostics/auth-repro.ts)
    expect(
      isAuthError("Claude Code returned an error result: Invalid API key · Fix external API key")
    ).toBe(true);
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
  });
});

describe("authErrorHint", () => {
  test("blames the API key when one is configured — logging in would not fix it", () => {
    expect(authErrorHint({ ANTHROPIC_API_KEY: "sk-ant-bogus" })).toContain("ANTHROPIC_API_KEY");
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
