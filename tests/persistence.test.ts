import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startPersister } from "../src/persistence";

let testDir: string | null = null;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = null;
});

function isolatedStateFile(): string {
  testDir = mkdtempSync(join(tmpdir(), "sottochat-persistence-"));
  return join(testDir, "state.json");
}

describe("persistence", () => {
  test("flush writes a complete state snapshot outside the live state directory", () => {
    const stateFile = isolatedStateFile();
    const persister = startPersister(
      () => new Map([["session-a", { summary: "ready", closedTurnCount: 3 }]]),
      { stateFile },
    );

    persister.flush();

    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toEqual({
      sessions: {
        "session-a": { summary: "ready", closedTurnCount: 3 },
      },
    });
  });

  test("concurrent processes do not race on one temporary file", async () => {
    const stateFile = isolatedStateFile();
    const persistenceUrl = pathToFileURL(resolve(import.meta.dir, "../src/persistence.ts")).href;

    const runWriter = async (sessionKey: string) => {
      const source = `
        import { startPersister } from ${JSON.stringify(persistenceUrl)};
        const persister = startPersister(
          () => new Map([[${JSON.stringify(sessionKey)}, { summary: ${JSON.stringify(sessionKey)} }]]),
          { stateFile: ${JSON.stringify(stateFile)} },
        );
        for (let i = 0; i < 100; i++) persister.flush();
      `;
      const proc = Bun.spawn([process.execPath, "--eval", source], {
        stdout: "ignore",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);
      return { exitCode, stderr };
    };

    const results = await Promise.all([runWriter("session-a"), runWriter("session-b")]);

    expect(results).toEqual([
      { exitCode: 0, stderr: "" },
      { exitCode: 0, stderr: "" },
    ]);
    expect(() => JSON.parse(readFileSync(stateFile, "utf8"))).not.toThrow();
    expect(readdirSync(testDir!).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
