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

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type DailyUsage = TokenUsage & {
  date: string;
  requests: number;
  chatTokens: number;
  observerTokens: number;
  totalTokens: number;
};

export type UsageSnapshot = {
  today: string;
  days: DailyUsage[];
};

type StoredUsage = {
  version: 1;
  days: Record<string, Omit<DailyUsage, "date" | "totalTokens">>;
};

const USAGE_FILE = join(homedir(), ".sottochat", "usage.json");
const MAX_HISTORY_DAYS = 90;

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function tokenUsageFromSdkMessage(message: unknown): TokenUsage | null {
  if (!message || typeof message !== "object") return null;
  const result = message as Record<string, unknown>;
  if (result.type !== "result" || !result.usage || typeof result.usage !== "object") return null;
  const usage = result.usage as Record<string, unknown>;
  const normalized: TokenUsage = {
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    cacheReadTokens: nonNegativeInt(usage.cache_read_input_tokens),
    cacheCreationTokens: nonNegativeInt(usage.cache_creation_input_tokens),
  };
  return totalTokens(normalized) > 0 ? normalized : null;
}

export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function localDateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function blankDay(): Omit<DailyUsage, "date" | "totalTokens"> {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requests: 0,
    chatTokens: 0,
    observerTokens: 0,
  };
}

function loadUsage(filePath: string): StoredUsage {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<StoredUsage>;
    if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") {
      return { version: 1, days: {} };
    }
    const days: StoredUsage["days"] = {};
    for (const [date, value] of Object.entries(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      days[date] = {
        inputTokens: nonNegativeInt(entry.inputTokens),
        outputTokens: nonNegativeInt(entry.outputTokens),
        cacheReadTokens: nonNegativeInt(entry.cacheReadTokens),
        cacheCreationTokens: nonNegativeInt(entry.cacheCreationTokens),
        requests: nonNegativeInt(entry.requests),
        chatTokens: nonNegativeInt(entry.chatTokens),
        observerTokens: nonNegativeInt(entry.observerTokens),
      };
    }
    return { version: 1, days };
  } catch {
    return { version: 1, days: {} };
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
      .map(([date, day]) => ({ ...day, date, totalTokens: totalTokens(day) }));
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
      day.inputTokens += nonNegativeInt(usage.inputTokens);
      day.outputTokens += nonNegativeInt(usage.outputTokens);
      day.cacheReadTokens += nonNegativeInt(usage.cacheReadTokens);
      day.cacheCreationTokens += nonNegativeInt(usage.cacheCreationTokens);
      day.requests += 1;
      if (source === "chat") day.chatTokens += added;
      else day.observerTokens += added;
      state.days[date] = day;
      flush();
      return snapshot();
    },
    snapshot,
    flush,
  };
}
