import { describe, expect, test } from "bun:test";
import { CURRENT_VERSION, isNewerVersion, versionState } from "../src/version";

describe("isNewerVersion", () => {
  test("orders semver triples numerically, not lexically", () => {
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.1.4", "0.1.5")).toBe(false);
    expect(isNewerVersion("0.1.5", "0.1.5")).toBe(false);
  });

  test("tolerates a v prefix and never treats malformed input as newer", () => {
    expect(isNewerVersion("v0.2.0", "0.1.5")).toBe(true);
    expect(isNewerVersion("not-a-version", "0.1.5")).toBe(false);
    expect(isNewerVersion("", "0.1.5")).toBe(false);
    expect(isNewerVersion("1.2", "0.1.5")).toBe(false);
  });
});

describe("versionState", () => {
  test("reports no update until the registry has answered", () => {
    expect(versionState(null)).toEqual({
      current: CURRENT_VERSION,
      latest: null,
      updateAvailable: false,
    });
  });

  test("flags an update only when latest is strictly newer", () => {
    expect(versionState("999.0.0").updateAvailable).toBe(true);
    expect(versionState(CURRENT_VERSION).updateAvailable).toBe(false);
  });
});
