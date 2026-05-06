import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// the "break it down" companion. one persistent sdk subprocess per upstream
// session — lazily spawned on the user's first send, reused for follow-ups.
// streams assistant text out via callback. tools disabled: it talks, doesn't
// touch files. cwd is sandboxed under ~/.cut-the-cake/chat/<hash>/ per session
// so any side-effects (which there shouldn't be any of) stay scoped.

export type ChatChunk = {
  sessionKey: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  /** "auto" tags messages auto-sent by the server in response to an observer open=true
   *  flag (used by the UI to badge them). default: "user". assistant chunks omit this. */
  kind?: "auto" | "user";
};

export type ChatStatus =
  | "spawned"
  | "thinking"
  | "idle"
  | "respawning"
  | "error";

export type ChatStatusUpdate = {
  sessionKey: string;
  status: ChatStatus;
  message?: string;
};

export type ChatAgentOptions = {
  model?: string;
  onChunk?: (c: ChatChunk) => void;
  onStatus?: (s: ChatStatusUpdate) => void;
};

const DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
  "AskUserQuestion",
  "TodoWrite",
];

const CHAT_ROOT = join(homedir(), ".cut-the-cake", "chat");

const SYSTEM_INTRO = `You are the "break it down" companion in cut-the-cake. The user just watched another agent finish a long, multi-piece run; they want to walk through what was done one piece at a time, with space to react after each. Reply concisely. Pause for the user's reply between pieces — never race ahead. Match their tone (lowercase, terminal-flavoured, dry). When you don't know what they're referring to, ask one clarifying question rather than guessing.`;

function findClaudeExecutable(): string {
  try {
    const p = execSync("which claude", { encoding: "utf8" }).trim().split("\n")[0]?.trim();
    if (p) return p;
  } catch {
    // fallthrough
  }
  throw new Error("`claude` not found on PATH — install Claude Code or set its path");
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sandboxFor(sessionKey: string): string {
  const hash = createHash("sha1").update(sessionKey).digest("hex").slice(0, 12);
  return join(CHAT_ROOT, hash);
}

export type ChatSendOptions = {
  /** prepended to the first prompt of a session as context (alongside SYSTEM_INTRO).
   *  ignored on follow-up sends. used by the server to pre-seed auto-fired chats
   *  with the observer's insight + recent turn excerpts. */
  seed?: string;
  /** tag for the echoed user chunk. "auto" = server-fired, "user" = typed. */
  userKind?: "auto" | "user";
};

type AgentHandle = {
  push: (text: string, seed?: string) => void;
  stop: () => void;
};

export function startChatHost(opts: ChatAgentOptions): {
  send: (sessionKey: string, text: string, sendOpts?: ChatSendOptions) => void;
  stop: (sessionKey?: string) => void;
} {
  const model = opts.model ?? "claude-sonnet-4-6";
  if (!existsSync(CHAT_ROOT)) mkdirSync(CHAT_ROOT, { recursive: true });
  const claudePath = findClaudeExecutable();
  const agents = new Map<string, AgentHandle>();

  function spawnAgent(sessionKey: string): AgentHandle {
    const cwd = sandboxFor(sessionKey);
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });

    const pendingMsgs: SDKUserMessage[] = [];
    let resolvePending: ((m: SDKUserMessage | null) => void) | null = null;
    let stopped = false;
    let firstPrompt = true;
    let abort: AbortController | null = null;

    function pushRaw(content: string) {
      const msg: SDKUserMessage = {
        type: "user",
        message: { role: "user", content },
        session_id: `chat-${sessionKey.replace(/[^a-z0-9]/gi, "-").slice(0, 32)}`,
        parent_tool_use_id: null,
      };
      if (resolvePending) {
        const r = resolvePending;
        resolvePending = null;
        r(msg);
      } else {
        pendingMsgs.push(msg);
      }
    }

    function push(text: string, seed?: string) {
      let content: string;
      if (firstPrompt) {
        const seedBlock = seed && seed.trim()
          ? `${SYSTEM_INTRO}\n\n---\nSession context:\n${seed.trim()}\n---\n\n`
          : `${SYSTEM_INTRO}\n\n---\n\n`;
        content = `${seedBlock}${text}`;
      } else {
        content = text;
      }
      firstPrompt = false;
      pushRaw(content);
      opts.onStatus?.({ sessionKey, status: "thinking" });
    }

    function stop() {
      stopped = true;
      if (abort) abort.abort();
      if (resolvePending) {
        const r = resolvePending;
        resolvePending = null;
        r(null);
      }
      agents.delete(sessionKey);
    }

    function makeGen(): AsyncIterableIterator<SDKUserMessage> {
      return (async function* () {
        while (!stopped) {
          if (pendingMsgs.length > 0) {
            yield pendingMsgs.shift()!;
            continue;
          }
          const msg = await new Promise<SDKUserMessage | null>((r) => {
            resolvePending = r;
          });
          if (!msg) return;
          yield msg;
        }
      })();
    }

    void (async () => {
      let consecutiveFailures = 0;
      while (!stopped && consecutiveFailures < 5) {
        const ac = new AbortController();
        abort = ac;
        try {
          const result = query({
            prompt: makeGen(),
            options: {
              model,
              cwd,
              pathToClaudeCodeExecutable: claudePath,
              disallowedTools: DISALLOWED_TOOLS,
              settingSources: [],
              mcpServers: {},
              strictMcpConfig: true,
              abortController: ac,
            },
          });

          for await (const m of result as AsyncIterable<unknown>) {
            const msg = m as { type?: string; message?: { content?: unknown } };
            if (msg.type !== "assistant") continue;
            const content = msg.message?.content;
            let text = "";
            if (Array.isArray(content)) {
              for (const b of content as Array<{ type?: string; text?: string }>) {
                if (b?.type === "text" && typeof b.text === "string") text += b.text;
              }
            } else if (typeof content === "string") {
              text = content;
            }
            if (!text.trim()) continue;
            opts.onChunk?.({ sessionKey, role: "assistant", text, ts: Date.now() });
            opts.onStatus?.({ sessionKey, status: "idle" });
            console.log(`[chat] ${sessionKey.slice(0, 24)} ← ${clip(text, 120)}`);
          }
          consecutiveFailures = 0;
        } catch (err) {
          if (stopped) return;
          consecutiveFailures++;
          const message = err instanceof Error ? err.message : String(err);
          console.log(`[chat] error in ${sessionKey.slice(0, 24)} (${consecutiveFailures}/5): ${message}`);
          opts.onStatus?.({ sessionKey, status: "respawning", message });
          await new Promise((r) => setTimeout(r, 5_000));
        } finally {
          if (resolvePending) {
            const r = resolvePending;
            resolvePending = null;
            r(null);
          }
          abort = null;
        }
      }
      if (consecutiveFailures >= 5) {
        opts.onStatus?.({ sessionKey, status: "error", message: "too many consecutive failures" });
      }
      agents.delete(sessionKey);
    })();

    opts.onStatus?.({ sessionKey, status: "spawned" });
    console.log(`[chat] spawned for ${sessionKey.slice(0, 32)} (cwd ${cwd})`);
    return { push, stop };
  }

  function ensureAgent(sessionKey: string): AgentHandle {
    let h = agents.get(sessionKey);
    if (!h) {
      h = spawnAgent(sessionKey);
      agents.set(sessionKey, h);
    }
    return h;
  }

  return {
    send(sessionKey, text, sendOpts) {
      const trimmed = (text || "").trim();
      if (!trimmed) return;
      const h = ensureAgent(sessionKey);
      const kind: "auto" | "user" = sendOpts?.userKind ?? "user";
      opts.onChunk?.({ sessionKey, role: "user", text: trimmed, ts: Date.now(), kind });
      h.push(trimmed, sendOpts?.seed);
    },
    stop(sessionKey) {
      if (sessionKey) {
        agents.get(sessionKey)?.stop();
      } else {
        for (const h of agents.values()) h.stop();
        agents.clear();
      }
    },
  };
}
