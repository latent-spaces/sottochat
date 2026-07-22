// Disk-backed accounting for model calls made by sottochat itself. Upstream
// coding-agent transcript usage is deliberately excluded: only the chat and
// observer SDK subprocesses report into this ledger.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type UsageSource = "chat" | "observer";

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type ModelTokenUsage = TokenCounts & {
  model: string;
};

export type TokenUsage = TokenCounts & {
  models: ModelTokenUsage[];
};

export type DailyModelUsage = ModelTokenUsage & {
  requests: number;
  chatTokens: number;
  observerTokens: number;
  totalTokens: number;
};

export type DailyUsage = TokenCounts & {
  date: string;
  requests: number;
  chatTokens: number;
  observerTokens: number;
  totalTokens: number;
  models: DailyModelUsage[];
};

export type UsageSnapshot = {
  today: string;
  days: DailyUsage[];
};

type StoredModelUsage = TokenCounts & {
  requests: number;
  chatTokens: number;
  observerTokens: number;
};

type StoredDay = TokenCounts & {
  requests: number;
  chatTokens: number;
  observerTokens: number;
  models: Record<string, StoredModelUsage>;
};

type StoredUsage = {
  version: 2;
  days: Record<string, StoredDay>;
};

const USAGE_FILE = join(homedir(), ".sottochat", "usage.json");
const MAX_HISTORY_DAYS = 90;

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function countsFrom(value: Record<string, unknown>, style: "snake" | "camel"): TokenCounts {
  return style === "snake"
    ? {
        inputTokens: nonNegativeInt(value.input_tokens),
        outputTokens: nonNegativeInt(value.output_tokens),
        cacheReadTokens: nonNegativeInt(value.cache_read_input_tokens),
        cacheCreationTokens: nonNegativeInt(value.cache_creation_input_tokens),
      }
    : {
        inputTokens: nonNegativeInt(value.inputTokens),
        outputTokens: nonNegativeInt(value.outputTokens),
        cacheReadTokens: nonNegativeInt(value.cacheReadTokens ?? value.cacheReadInputTokens),
        cacheCreationTokens: nonNegativeInt(value.cacheCreationTokens ?? value.cacheCreationInputTokens),
      };
}

function addCounts(target: TokenCounts, added: TokenCounts): void {
  target.inputTokens += nonNegativeInt(added.inputTokens);
  target.outputTokens += nonNegativeInt(added.outputTokens);
  target.cacheReadTokens += nonNegativeInt(added.cacheReadTokens);
  target.cacheCreationTokens += nonNegativeInt(added.cacheCreationTokens);
}

function blankCounts(): TokenCounts {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

export function tokenUsageFromSdkMessage(message: unknown, fallbackModel = "unknown"): TokenUsage | null {
  if (!message || typeof message !== "object") return null;
  const result = message as Record<string, unknown>;
  if (result.type !== "result" || !result.usage || typeof result.usage !== "object") return null;

  const models: ModelTokenUsage[] = [];
  if (result.modelUsage && typeof result.modelUsage === "object") {
    for (const [model, raw] of Object.entries(result.modelUsage as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const counts = countsFrom(raw as Record<string, unknown>, "camel");
      if (totalTokens(counts) > 0) models.push({ model, ...counts });
    }
  }

  const aggregate = blankCounts();
  if (models.length > 0) {
    for (const model of models) addCounts(aggregate, model);
  } else {
    addCounts(aggregate, countsFrom(result.usage as Record<string, unknown>, "snake"));
    if (totalTokens(aggregate) > 0) {
      models.push({ model: fallbackModel.trim() || "unknown", ...aggregate });
    }
  }

  return totalTokens(aggregate) > 0 ? { ...aggregate, models } : null;
}

export function totalTokens(usage: TokenCounts): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function localDateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function blankStoredModel(): StoredModelUsage {
  return { ...blankCounts(), requests: 0, chatTokens: 0, observerTokens: 0 };
}

function blankDay(): StoredDay {
  return { ...blankCounts(), requests: 0, chatTokens: 0, observerTokens: 0, models: {} };
}

function loadUsage(filePath: string): StoredUsage {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") {
      return { version: 2, days: {} };
    }
    const days: StoredUsage["days"] = {};
    for (const [date, value] of Object.entries(raw.days as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const day: StoredDay = {
        ...countsFrom(entry, "camel"),
        requests: nonNegativeInt(entry.requests),
        chatTokens: nonNegativeInt(entry.chatTokens),
        observerTokens: nonNegativeInt(entry.observerTokens),
        models: {},
      };
      if (entry.models && typeof entry.models === "object") {
        for (const [model, rawModel] of Object.entries(entry.models as Record<string, unknown>)) {
          if (!rawModel || typeof rawModel !== "object") continue;
          const stored = rawModel as Record<string, unknown>;
          day.models[model] = {
            ...countsFrom(stored, "camel"),
            requests: nonNegativeInt(stored.requests),
            chatTokens: nonNegativeInt(stored.chatTokens),
            observerTokens: nonNegativeInt(stored.observerTokens),
          };
        }
      }
      // Version 1 did not retain model names. Keep those totals intact and
      // label them honestly instead of attributing them to the current model.
      if (Object.keys(day.models).length === 0 && totalTokens(day) > 0) {
        day.models.unattributed = {
          ...countsFrom(entry, "camel"),
          requests: day.requests,
          chatTokens: day.chatTokens,
          observerTokens: day.observerTokens,
        };
      }
      days[date] = day;
    }
    return { version: 2, days };
  } catch {
    return { version: 2, days: {} };
  }
}

export function startUsageLedger(
  options: { filePath?: string; now?: () => number; maxHistoryDays?: number } = {},
): {
  record: (source: UsageSource, usage: TokenUsage) => UsageSnapshot;
  snapshot: () => UsageSnapshot;
  flush: () => void;
} {
  const filePath = options.filePath ?? USAGE_FILE;
  const now = options.now ?? Date.now;
  const maxHistoryDays = Math.max(1, options.maxHistoryDays ?? MAX_HISTORY_DAYS);
  const state = loadUsage(filePath);

  function prune(): void {
    const keys = Object.keys(state.days).sort().reverse();
    for (const key of keys.slice(maxHistoryDays)) delete state.days[key];
  }

  function snapshot(): UsageSnapshot {
    prune();
    const days = Object.entries(state.days)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, day]) => ({
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        cacheReadTokens: day.cacheReadTokens,
        cacheCreationTokens: day.cacheCreationTokens,
        requests: day.requests,
        chatTokens: day.chatTokens,
        observerTokens: day.observerTokens,
        date,
        totalTokens: totalTokens(day),
        models: Object.entries(day.models)
          .map(([model, usage]) => ({ ...usage, model, totalTokens: totalTokens(usage) }))
          .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model)),
      }));
    return { today: localDateKey(now()), days };
  }

  function flush(): void {
    const dir = dirname(filePath);
    let tmp: string | null = null;
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      prune();
      tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, filePath);
      tmp = null;
    } catch (error) {
      console.error("[usage] save failed:", error);
    } finally {
      if (tmp && existsSync(tmp)) {
        try {
          unlinkSync(tmp);
        } catch {
          // best-effort cleanup; the history file itself was never replaced
        }
      }
    }
  }

  return {
    record(source, usage) {
      const date = localDateKey(now());
      const day = state.days[date] ?? blankDay();
      const added = totalTokens(usage);
      addCounts(day, usage);
      day.requests += 1;
      if (source === "chat") day.chatTokens += added;
      else day.observerTokens += added;

      for (const modelUsage of usage.models) {
        const model = modelUsage.model.trim() || "unknown";
        const stored = day.models[model] ?? blankStoredModel();
        const modelAdded = totalTokens(modelUsage);
        addCounts(stored, modelUsage);
        stored.requests += 1;
        if (source === "chat") stored.chatTokens += modelAdded;
        else stored.observerTokens += modelAdded;
        day.models[model] = stored;
      }

      state.days[date] = day;
      flush();
      return snapshot();
    },
    snapshot,
    flush,
  };
}
