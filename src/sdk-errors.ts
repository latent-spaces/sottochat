// The claude-agent-sdk subprocess surfaces raw upstream auth failures (e.g.
// "invalid x-api-key") even when the real cause is simply "never logged in" —
// there's no key to be invalid, the CLI just phrases missing/expired
// credentials as an API-key error. Detect that class of failure so callers
// can show something actionable instead of retrying against an API call
// that can never succeed until the credentials change.
// "failed to authenticate[.:]" pins the CLI's own phrasing ("Failed to
// authenticate. API Error: …", "Failed to authenticate: OAuth session …") so
// unrelated failures like proxy auth don't read as Claude credential errors.
const AUTH_ERROR_PATTERN =
  /authentication_error|invalid (?:x-)?api[- ]?key|api[- ]?key is invalid|failed to authenticate[.:]|please run\s*\/login|authentication failed|oauth token.*(?:expired|revoked)|session (?:has )?expired|not logged in|login expired/i;

export function isAuthError(message: string): boolean {
  return AUTH_ERROR_PATTERN.test(message);
}

// The right remediation depends on how the user authenticates: with an
// ANTHROPIC_API_KEY configured, the key itself is being rejected and logging
// in won't help — without one, the missing/expired Claude Code login is the
// cause.
export function authErrorHint(env: Record<string, string | undefined> = Bun.env): string {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) {
    const name = env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN";
    return `Claude credential rejected — ${name} is set but invalid. Fix or unset it, then try again.`;
  }
  return "Not signed in to Claude Code — run `claude` in a terminal, log in, then try again.";
}
