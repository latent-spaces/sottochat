import { describe, expect, test } from "bun:test";
import {
  applySettingsPatch,
  buildSettingsCatalog,
  readStartupSetting,
  SettingsValidationError,
  type EffectiveSettings,
} from "../src/settings";

const values: EffectiveSettings = {
  port: 3737,
  pollMs: 500,
  projectSlug: "",
  inboxMinutes: 1_440,
  processDiscovery: true,
  discoveryGraceMinutes: 30,
  observerEnabled: true,
  observerModel: "claude-sonnet-5",
  chatModel: "claude-sonnet-5",
  observerBatchMs: 30_000,
  observerFreshMs: 300_000,
  explainLanguage: "zh",
  magnitudeTokens: 1500,
  magnitudeToolCalls: 5,
  magnitudeChars: 6000,
};

const languages = { en: "English", zh: "Chinese" };

// empty snapshots isolate the suite from the live ~/.sottochat/settings.json
const noSaved = { startup: {}, current: {} };

describe("settings catalog", () => {
  test("lists every public environment knob exactly once", () => {
    const catalog = buildSettingsCatalog(values, languages, {}, noSaved);
    const settings = catalog.groups.flatMap((group) => group.settings);
    const keys = settings.map((item) => item.key);

    expect(settings).toHaveLength(15);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("META_DISCOVERY_GRACE_MINUTES");
    expect(keys).toContain("META_OBSERVER_FRESH_MS");
    expect(keys.some((key) => key.includes("ANTHROPIC"))).toBe(false);
    expect(settings.find((item) => item.key === "META_INBOX_MINUTES")?.defaultValue).toBe(1_440);
  });

  test("reports the source of effective values", () => {
    const catalog = buildSettingsCatalog(
      { ...values, port: 4400, explainLanguage: "en" },
      languages,
      { PORT: "4400" },
      noSaved,
    );
    const settings = catalog.groups.flatMap((group) => group.settings);

    expect(settings.find((item) => item.key === "META_PORT")?.source).toBe("PORT");
    expect(settings.find((item) => item.key === "META_PORT")?.editable).toBe(false);
    expect(settings.find((item) => item.key === "META_EXPLAIN_LANG")?.source).toBe("runtime");
  });

  test("validates and normalizes editable values", () => {
    const next = applySettingsPatch({}, {
      META_PORT: "4400",
      META_USE_PROCESS_DISCOVERY: false,
      META_PROJECT_SLUG: "  my-project  ",
    }, languages);

    expect(next.META_PORT).toBe(4400);
    expect(next.META_USE_PROCESS_DISCOVERY).toBe(false);
    expect(next.META_PROJECT_SLUG).toBe("my-project");
    expect(applySettingsPatch(next, { META_PORT: null }, languages).META_PORT).toBeUndefined();
  });

  test("rejects invalid or unknown edits", () => {
    expect(() => applySettingsPatch({}, { META_PORT: 70_000 }, languages)).toThrow(SettingsValidationError);
    expect(() => applySettingsPatch({}, { META_EXPLAIN_LANG: "xx" }, languages)).toThrow("unknown language");
    expect(() => applySettingsPatch({}, { NPM_TOKEN: "secret" }, languages)).toThrow("unknown setting");
  });

  test("environment values still win at startup", () => {
    expect(readStartupSetting("META_PORT", 3737, { META_PORT: "4400" }, [], {})).toBe(4400);
    expect(readStartupSetting("META_USE_PROCESS_DISCOVERY", true, { META_USE_PROCESS_DISCOVERY: "0" }, [], {})).toBe(false);
  });

  test("injected snapshots drive nextValue and pendingRestart, not the live file", () => {
    const catalog = buildSettingsCatalog(values, languages, {}, {
      startup: {},
      current: { META_PORT: 4500 },
    });
    const port = catalog.groups.flatMap((g) => g.settings).find((s) => s.key === "META_PORT");

    expect(port?.savedValue).toBe(4500);
    expect(port?.nextValue).toBe(4500);
    expect(port?.pendingRestart).toBe(true);
  });

  test("saved settings fall back below the environment", () => {
    expect(readStartupSetting("META_PORT", 3737, {}, [], { META_PORT: 4500 })).toBe(4500);
    expect(readStartupSetting("META_PORT", 3737, { META_PORT: "4400" }, [], { META_PORT: 4500 })).toBe(4400);
  });
});
