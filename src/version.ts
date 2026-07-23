import packageJson from "../package.json" with { type: "json" };

// Version awareness: what build is running and whether npm has a newer one.
// The check is best-effort — offline or slow registry just means "no answer",
// never an error surfaced to the user.
export const CURRENT_VERSION: string = packageJson.version;

export type VersionState = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
};

export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.trim().replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
  const a = parse(candidate);
  const b = parse(current);
  if (a.length < 3 || b.length < 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

export async function fetchLatestVersion(timeoutMs = 3_000): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/sottochat/latest", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

export function versionState(latest: string | null): VersionState {
  return {
    current: CURRENT_VERSION,
    latest,
    updateAvailable: latest !== null && isNewerVersion(latest, CURRENT_VERSION),
  };
}
