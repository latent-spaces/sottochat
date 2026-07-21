import { describe, expect, test } from "bun:test";
import { isAuthError } from "../src/sdk-errors";

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
