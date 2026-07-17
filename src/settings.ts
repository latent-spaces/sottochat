import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SettingValue = string | number | boolean;

export type SettingOption = {
  value: string;
  label: string;
};

export type PublicSetting = {
  key: string;
  label: string;
  description: string;
  value: SettingValue;
  nextValue: SettingValue;
  defaultValue: SettingValue;
  savedValue?: SettingValue;
  kind: "boolean" | "number" | "string" | "select";
  unit?: "milliseconds" | "minutes" | "port" | "tokens" | "tool calls" | "characters";
  options?: SettingOption[];
  restartRequired: boolean;
  pendingRestart: boolean;
  source: string;
  editable: boolean;
  aliases?: string[];
  min?: number;
  max?: number;
  step?: number;
};

export type SettingsGroup = {
  id: string;
  label: string;
  description: string;
  settings: PublicSetting[];
};

export type EffectiveSettings = {
  port: number;
  pollMs: number;
  projectSlug: string;
  inboxMinutes: number;
  processDiscovery: boolean;
  discoveryGraceMinutes: number;
  observerEnabled: boolean;
  observerModel: string;
  chatModel: string;
  observerBatchMs: number;
  observerFreshMs: number;
  explainLanguage: string;
  magnitudeTokens: number;
  magnitudeToolCalls: number;
  magnitudeChars: number;
};

type Environment = Record<string, string | undefined>;
type SavedSettings = Record<string, SettingValue>;

type SettingRule = {
  kind: "boolean" | "number" | "string" | "select";
  min?: number;
  max?: number;
  integer?: boolean;
  maxLength?: number;
  allowEmpty?: boolean;
};

const SETTING_RULES: Record<string, SettingRule> = {
  META_PORT: { kind: "number", min: 1, max: 65_535, integer: true },
  META_POLL_MS: { kind: "number", min: 50, max: 60_000, integer: true },
  META_PROJECT_SLUG: { kind: "string", maxLength: 500, allowEmpty: true },
  META_INBOX_MINUTES: { kind: "number", min: 1, max: 525_600 },
  META_USE_PROCESS_DISCOVERY: { kind: "boolean" },
  META_DISCOVERY_GRACE_MINUTES: { kind: "number", min: 0, max: 10_080 },
  META_EXPLAIN_LANG: { kind: "select" },
  META_OBSERVER_ENABLED: { kind: "boolean" },
  META_OBSERVER_MODEL: { kind: "string", maxLength: 200 },
  META_CHAT_MODEL: { kind: "string", maxLength: 200 },
  META_OBSERVER_BATCH_MS: { kind: "number", min: 1_000, max: 600_000, integer: true },
  META_OBSERVER_FRESH_MS: { kind: "number", min: 0, max: 86_400_000, integer: true },
  META_MAGNITUDE_TOK: { kind: "number", min: 0, max: 10_000_000, integer: true },
  META_MAGNITUDE_TC: { kind: "number", min: 0, max: 100_000, integer: true },
  META_MAGNITUDE_CHARS: { kind: "number", min: 0, max: 100_000_000, integer: true },
};

const SETTINGS_DIR = join(homedir(), ".sottochat");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

function loadSettingsFile(path = SETTINGS_FILE): SavedSettings {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { settings?: unknown };
    if (!raw || typeof raw !== "object" || !raw.settings || typeof raw.settings !== "object") return {};
    const settings: SavedSettings = {};
    for (const [key, value] of Object.entries(raw.settings as Record<string, unknown>)) {
      if (!(key in SETTING_RULES)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        settings[key] = value;
      }
    }
    return settings;
  } catch {
    return {};
  }
}

const startupSavedSettings = loadSettingsFile();
let savedSettings: SavedSettings = { ...startupSavedSettings };

function environmentSource(key: string, env: Environment, aliases: string[] = []): string | null {
  for (const candidate of [key, ...aliases]) {
    if (env[candidate] !== undefined) return candidate;
  }
  return null;
}

function rawEnvironmentValue(key: string, env: Environment, aliases: string[] = []): unknown {
  const source = environmentSource(key, env, aliases);
  return source ? env[source] : undefined;
}

export class SettingsValidationError extends Error {
  constructor(public key: string, message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

function sanitizeSettingValue(
  key: string,
  value: unknown,
  languages?: Record<string, string>,
): SettingValue {
  const rule = SETTING_RULES[key];
  if (!rule) throw new SettingsValidationError(key, `unknown setting: ${key}`);

  if (rule.kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    throw new SettingsValidationError(key, `${key} must be on or off`);
  }

  if (rule.kind === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) throw new SettingsValidationError(key, `${key} must be a number`);
    if (rule.integer && !Number.isInteger(parsed)) {
      throw new SettingsValidationError(key, `${key} must be a whole number`);
    }
    if (rule.min !== undefined && parsed < rule.min) {
      throw new SettingsValidationError(key, `${key} must be at least ${rule.min}`);
    }
    if (rule.max !== undefined && parsed > rule.max) {
      throw new SettingsValidationError(key, `${key} must be at most ${rule.max}`);
    }
    return parsed;
  }

  if (typeof value !== "string") throw new SettingsValidationError(key, `${key} must be text`);
  const parsed = value.trim();
  if (!rule.allowEmpty && !parsed) throw new SettingsValidationError(key, `${key} cannot be empty`);
  if (rule.maxLength !== undefined && parsed.length > rule.maxLength) {
    throw new SettingsValidationError(key, `${key} is too long`);
  }
  if (rule.kind === "select" && languages && !languages[parsed]) {
    throw new SettingsValidationError(key, `unknown language: ${parsed}`);
  }
  return parsed;
}

function safeSettingValue<T extends SettingValue>(
  key: string,
  raw: unknown,
  fallback: T,
): T {
  try {
    return sanitizeSettingValue(key, raw) as T;
  } catch {
    return fallback;
  }
}

export function readStartupSetting<T extends SettingValue>(
  key: string,
  defaultValue: T,
  env: Environment = Bun.env,
  aliases: string[] = [],
): T {
  const environmentValue = rawEnvironmentValue(key, env, aliases);
  if (environmentValue !== undefined) return safeSettingValue(key, environmentValue, defaultValue);
  if (startupSavedSettings[key] !== undefined) {
    return safeSettingValue(key, startupSavedSettings[key], defaultValue);
  }
  return defaultValue;
}

function nextSettingValue<T extends SettingValue>(
  key: string,
  defaultValue: T,
  env: Environment,
  aliases: string[] = [],
): T {
  const environmentValue = rawEnvironmentValue(key, env, aliases);
  if (environmentValue !== undefined) return safeSettingValue(key, environmentValue, defaultValue);
  if (savedSettings[key] !== undefined) return safeSettingValue(key, savedSettings[key], defaultValue);
  return defaultValue;
}

export function readNextSetting<T extends SettingValue>(
  key: string,
  defaultValue: T,
  env: Environment = Bun.env,
  aliases: string[] = [],
): T {
  return nextSettingValue(key, defaultValue, env, aliases);
}

export function applySettingsPatch(
  current: SavedSettings,
  patch: Record<string, unknown>,
  languages: Record<string, string>,
): SavedSettings {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in SETTING_RULES)) throw new SettingsValidationError(key, `unknown setting: ${key}`);
    if (value === null) {
      delete next[key];
      continue;
    }
    next[key] = sanitizeSettingValue(key, value, languages);
  }
  return next;
}

export function saveSettingsPatch(
  patch: Record<string, unknown>,
  languages: Record<string, string>,
): SavedSettings {
  const next = applySettingsPatch(savedSettings, patch, languages);
  if (!existsSync(SETTINGS_DIR)) mkdirSync(SETTINGS_DIR, { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, settings: next }, null, 2), { mode: 0o600 });
  renameSync(tmp, SETTINGS_FILE);
  savedSettings = next;
  return { ...savedSettings };
}

type SettingInput = Omit<
  PublicSetting,
  "source" | "nextValue" | "savedValue" | "pendingRestart" | "editable"
> & {
  env: Environment;
  environmentAliases?: string[];
};

function setting(input: SettingInput): PublicSetting {
  const { env, environmentAliases = [], ...publicInput } = input;
  const externalSource = environmentSource(input.key, env, environmentAliases);
  const source = externalSource
    ?? (startupSavedSettings[input.key] !== undefined ? "saved" : "default");
  const nextValue = nextSettingValue(input.key, input.defaultValue, env, environmentAliases);
  const savedValue = savedSettings[input.key];
  return {
    ...publicInput,
    source,
    nextValue,
    ...(savedValue !== undefined ? { savedValue } : {}),
    pendingRestart: input.restartRequired && nextValue !== input.value,
    editable: !input.restartRequired || !externalSource,
  };
}

export function buildSettingsCatalog(
  values: EffectiveSettings,
  languages: Record<string, string>,
  env: Environment = Bun.env,
) {
  const languageDefault = "zh";
  const languageSetting = setting({
    env,
    key: "META_EXPLAIN_LANG",
    label: "explanation language",
    description: "Language used for summaries and the meta discussion. Prepared agent replies keep the agent's language.",
    value: values.explainLanguage,
    defaultValue: languageDefault,
    kind: "select",
    options: Object.entries(languages).map(([value, label]) => ({ value, label })),
    restartRequired: false,
  });
  const startupLanguage = readStartupSetting("META_EXPLAIN_LANG", languageDefault, env);
  if (values.explainLanguage !== startupLanguage) languageSetting.source = "runtime";
  languageSetting.nextValue = values.explainLanguage;

  const groups: SettingsGroup[] = [
    {
      id: "server",
      label: "server",
      description: "Network and transcript polling.",
      settings: [
        setting({
          env,
          key: "META_PORT",
          environmentAliases: ["PORT"],
          aliases: ["PORT", "--port"],
          label: "http port",
          description: "Port used by the local web app and websocket server.",
          value: values.port,
          defaultValue: 3737,
          kind: "number",
          unit: "port",
          restartRequired: true,
          min: 1,
          max: 65_535,
          step: 1,
        }),
        setting({
          env,
          key: "META_POLL_MS",
          label: "transcript poll interval",
          description: "How often transcript files are checked for new events.",
          value: values.pollMs,
          defaultValue: 500,
          kind: "number",
          unit: "milliseconds",
          restartRequired: true,
          min: 50,
          max: 60_000,
          step: 50,
        }),
        setting({
          env,
          key: "META_PROJECT_SLUG",
          label: "project filter",
          description: "Restrict Claude Code discovery to one project slug. Leave empty for all projects.",
          value: values.projectSlug,
          defaultValue: "",
          kind: "string",
          restartRequired: true,
        }),
      ],
    },
    {
      id: "discovery",
      label: "discovery and inbox",
      description: "Which sessions appear and how long they remain visible.",
      settings: [
        setting({
          env,
          key: "META_INBOX_MINUTES",
          label: "inbox window",
          description: "Hide sessions after this many minutes without a transcript event.",
          value: values.inboxMinutes,
          defaultValue: 240,
          kind: "number",
          unit: "minutes",
          restartRequired: true,
          min: 1,
          max: 525_600,
          step: 1,
        }),
        setting({
          env,
          key: "META_USE_PROCESS_DISCOVERY",
          label: "process discovery",
          description: "Use live Claude Code and Codex processes to decide which sessions belong in the inbox.",
          value: values.processDiscovery,
          defaultValue: true,
          kind: "boolean",
          restartRequired: true,
        }),
        setting({
          env,
          key: "META_DISCOVERY_GRACE_MINUTES",
          label: "finished-job grace",
          description: "Keep a Claude Code or Codex session visible after its process exits.",
          value: values.discoveryGraceMinutes,
          defaultValue: 30,
          kind: "number",
          unit: "minutes",
          restartRequired: true,
          min: 0,
          max: 10_080,
          step: 1,
        }),
      ],
    },
    {
      id: "discussion",
      label: "discussion and summaries",
      description: "Models, batching, and user-facing language.",
      settings: [
        languageSetting,
        setting({
          env,
          key: "META_OBSERVER_ENABLED",
          aliases: ["--no-observer"],
          label: "background observer",
          description: "Generate short summaries for active session cards.",
          value: values.observerEnabled,
          defaultValue: true,
          kind: "boolean",
          restartRequired: true,
        }),
        setting({
          env,
          key: "META_OBSERVER_MODEL",
          label: "observer model",
          description: "Claude model used by the background session summarizer.",
          value: values.observerModel,
          defaultValue: "claude-sonnet-5",
          kind: "string",
          restartRequired: true,
        }),
        setting({
          env,
          key: "META_CHAT_MODEL",
          label: "discussion model",
          description: "Claude model used for each session's meta discussion.",
          value: values.chatModel,
          defaultValue: "claude-sonnet-5",
          kind: "string",
          restartRequired: true,
        }),
        setting({
          env,
          key: "META_OBSERVER_BATCH_MS",
          label: "observer batch interval",
          description: "How long the observer waits to combine closed turns into one batch.",
          value: values.observerBatchMs,
          defaultValue: 30_000,
          kind: "number",
          unit: "milliseconds",
          restartRequired: true,
          min: 1_000,
          max: 600_000,
          step: 1_000,
        }),
        setting({
          env,
          key: "META_OBSERVER_FRESH_MS",
          label: "observer freshness window",
          description: "Ignore older turns during startup backfill so stale work is not summarized again.",
          value: values.observerFreshMs,
          defaultValue: 300_000,
          kind: "number",
          unit: "milliseconds",
          restartRequired: true,
          min: 0,
          max: 86_400_000,
          step: 1_000,
        }),
      ],
    },
    {
      id: "turns",
      label: "large-turn thresholds",
      description: "When a completed turn is large enough to open an inspection thread.",
      settings: [
        setting({
          env,
          key: "META_MAGNITUDE_TOK",
          label: "output token threshold",
          description: "Trigger when a turn produces more output tokens than this value.",
          value: values.magnitudeTokens,
          defaultValue: 1500,
          kind: "number",
          unit: "tokens",
          restartRequired: true,
          min: 0,
          max: 10_000_000,
          step: 100,
        }),
        setting({
          env,
          key: "META_MAGNITUDE_TC",
          label: "tool-call threshold",
          description: "Trigger when a turn performs more tool calls than this value.",
          value: values.magnitudeToolCalls,
          defaultValue: 5,
          kind: "number",
          unit: "tool calls",
          restartRequired: true,
          min: 0,
          max: 100_000,
          step: 1,
        }),
        setting({
          env,
          key: "META_MAGNITUDE_CHARS",
          label: "character fallback threshold",
          description: "Fallback trigger for transcripts without output-token usage.",
          value: values.magnitudeChars,
          defaultValue: 6000,
          kind: "number",
          unit: "characters",
          restartRequired: true,
          min: 0,
          max: 100_000_000,
          step: 100,
        }),
      ],
    },
  ];

  return {
    generatedAt: Date.now(),
    note: "Changes are saved locally. Language applies immediately; other changes apply after restarting sottochat.",
    storage: "~/.sottochat/settings.json",
    groups,
  };
}
