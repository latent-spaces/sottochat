import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      cacheReadTokens: 100,
      cacheCreationTokens: 20,
    });
  });

  test("persists daily totals with chat and observer breakdowns", () => {
    const filePath = usageFile();
    const now = new Date(2026, 6, 22, 15, 30).getTime();
    const ledger = startUsageLedger({ filePath, now: () => now });
    ledger.record("chat", { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheCreationTokens: 0 });
    const snapshot = ledger.record("observer", { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 5 });

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
      }],
    });
    expect(JSON.parse(readFileSync(filePath, "utf8")).version).toBe(1);

    const restored = startUsageLedger({ filePath, now: () => now });
    expect(restored.snapshot()).toEqual(snapshot);
  });

  test("keeps only the configured number of calendar days", () => {
    const filePath = usageFile();
    let now = new Date(2026, 6, 20, 12).getTime();
    const ledger = startUsageLedger({ filePath, now: () => now, maxHistoryDays: 2 });
    const usage = { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
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
});
