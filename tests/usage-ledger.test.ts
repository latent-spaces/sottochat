import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localDateKey,
  startUsageLedger,
  tokenUsageFromSdkMessage,
} from "../src/usage-ledger";

let testDir: string | null = null;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = null;
});

function usageFile(): string {
  testDir = mkdtempSync(join(tmpdir(), "sottochat-usage-"));
  return join(testDir, "usage.json");
}

describe("usage ledger", () => {
  test("normalizes SDK result usage and ignores other messages", () => {
    expect(tokenUsageFromSdkMessage({ type: "assistant", usage: {} })).toBeNull();
    expect(tokenUsageFromSdkMessage({
      type: "result",
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 20,
      },
    }, "claude-sonnet-5")).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      cacheReadTokens: 100,
      cacheCreationTokens: 20,
      models: [{
        model: "claude-sonnet-5",
        inputTokens: 12,
        outputTokens: 8,
        cacheReadTokens: 100,
        cacheCreationTokens: 20,
      }],
    });
  });

  test("uses the SDK per-model breakdown as the attributed total", () => {
    expect(tokenUsageFromSdkMessage({
      type: "result",
      usage: { input_tokens: 999, output_tokens: 999 },
      modelUsage: {
        "claude-sonnet-5-20260701": {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 20,
        },
        "claude-haiku-4-5-20251001": {
          inputTokens: 4,
          outputTokens: 2,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 0,
        },
      },
    })).toEqual({
      inputTokens: 14,
      outputTokens: 7,
      cacheReadTokens: 30,
      cacheCreationTokens: 20,
      models: [
        {
          model: "claude-sonnet-5-20260701",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 20,
        },
        {
          model: "claude-haiku-4-5-20251001",
          inputTokens: 4,
          outputTokens: 2,
          cacheReadTokens: 30,
          cacheCreationTokens: 0,
        },
      ],
    });
  });

  test("persists daily totals with chat and observer breakdowns", () => {
    const filePath = usageFile();
    const now = new Date(2026, 6, 22, 15, 30).getTime();
    const ledger = startUsageLedger({ filePath, now: () => now });
    ledger.record("chat", {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 20,
      cacheCreationTokens: 0,
      models: [{ model: "claude-sonnet-5", inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheCreationTokens: 0 }],
    });
    const snapshot = ledger.record("observer", {
      inputTokens: 7,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 5,
      models: [{ model: "claude-haiku-4-5", inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 5 }],
    });

    expect(snapshot).toEqual({
      today: localDateKey(now),
      days: [{
        date: localDateKey(now),
        inputTokens: 17,
        outputTokens: 8,
        cacheReadTokens: 20,
        cacheCreationTokens: 5,
        requests: 2,
        chatTokens: 35,
        observerTokens: 15,
        totalTokens: 50,
        models: [
          {
            model: "claude-sonnet-5",
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 20,
            cacheCreationTokens: 0,
            requests: 1,
            chatTokens: 35,
            observerTokens: 0,
            totalTokens: 35,
          },
          {
            model: "claude-haiku-4-5",
            inputTokens: 7,
            outputTokens: 3,
            cacheReadTokens: 0,
            cacheCreationTokens: 5,
            requests: 1,
            chatTokens: 0,
            observerTokens: 15,
            totalTokens: 15,
          },
        ],
      }],
    });
    expect(JSON.parse(readFileSync(filePath, "utf8")).version).toBe(2);

    const restored = startUsageLedger({ filePath, now: () => now });
    expect(restored.snapshot()).toEqual(snapshot);
  });

  test("keeps only the configured number of calendar days", () => {
    const filePath = usageFile();
    let now = new Date(2026, 6, 20, 12).getTime();
    const ledger = startUsageLedger({ filePath, now: () => now, maxHistoryDays: 2 });
    const usage = {
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      models: [{ model: "claude-sonnet-5", inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }],
    };
    ledger.record("chat", usage);
    now += 24 * 60 * 60 * 1000;
    ledger.record("chat", usage);
    now += 24 * 60 * 60 * 1000;
    ledger.record("chat", usage);

    expect(ledger.snapshot().days.map((day) => day.date)).toEqual([
      localDateKey(now),
      localDateKey(now - 24 * 60 * 60 * 1000),
    ]);
  });

  test("migrates version 1 history without inventing a model", () => {
    const filePath = usageFile();
    const now = new Date(2026, 6, 22, 12).getTime();
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      days: {
        [localDateKey(now)]: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 20,
          cacheCreationTokens: 0,
          requests: 1,
          chatTokens: 35,
          observerTokens: 0,
        },
      },
    }));

    const [day] = startUsageLedger({ filePath, now: () => now }).snapshot().days;
    expect(day?.models).toEqual([{
      model: "unattributed",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 20,
      cacheCreationTokens: 0,
      requests: 1,
      chatTokens: 35,
      observerTokens: 0,
      totalTokens: 35,
    }]);
  });
});
