// The claude-agent-sdk subprocess surfaces raw upstream auth failures (e.g.
// "invalid x-api-key") even when the real cause is simply "never logged in" —
// there's no key to be invalid, the CLI just phrases missing/expired
// credentials as an API-key error. Detect that class of failure so callers
// can show something actionable instead of retrying against an API call
// that can never succeed until the user signs in.
const AUTH_ERROR_PATTERN =
  /authentication_error|invalid x-api-key|please run\s*\/login|oauth token.*(?:expired|revoked)|session (?:has )?expired|not logged in/i;

export function isAuthError(message: string): boolean {
  return AUTH_ERROR_PATTERN.test(message);
}

export const AUTH_ERROR_MESSAGE =
  "Not signed in to Claude Code — run `claude` in a terminal, log in, then try again.";
