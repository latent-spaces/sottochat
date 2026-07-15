import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// the chat companion the user talks to. one persistent sdk subprocess per upstream
// session — lazily spawned on the user's first send, reused for follow-ups.
// streams assistant text out via callback. tools disabled: it talks, doesn't
// touch files. cwd is sandboxed under ~/.sottochat/chat/<hash>/ per session
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

const CHAT_ROOT = join(homedir(), ".sottochat", "chat");

function systemIntro(answerLanguage: string): string {
  return `Discuss the watched coding-agent session with the developer.

Language:
- Answers to the developer: ${answerLanguage}
- Suggested replies to the coding agent: the agent's own language, usually English

Rules:
- Keep answers plain and brief.
- Use the supplied session context, especially the latest exchange.
- When asked what to send, write, or reply, prepare a targeted message for the original session. Include exactly one fenced block tagged \`to-agent\`.
- Otherwise do not include a \`to-agent\` block.
- Text outside a \`to-agent\` block stays in ${answerLanguage}.`;
}

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
  /** prepended to the first prompt of a session as context (alongside the system
   *  intro). ignored on follow-up sends. used by the server to seed the chat with
   *  the latest exchange so the assistant can answer questions about it. */
  seed?: string;
  /** tag for the echoed user chunk. "auto" = server-fired, "user" = typed. */
  userKind?: "auto" | "user";
  /** language (english name, e.g. "Hebrew") the assistant should answer in. */
  language?: string;
};

type AgentHandle = {
  push: (text: string, seed?: string, language?: string) => void;
  stop: () => void;
};

export function startChatHost(opts: ChatAgentOptions): {
  send: (sessionKey: string, text: string, sendOpts?: ChatSendOptions) => void;
  stop: (sessionKey?: string) => void;
} {
  const model = opts.model ?? "claude-sonnet-5";
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

    let lastLanguage: string | null = null;
    function push(text: string, seed?: string, language?: string) {
      const lang = language && language.trim() ? language.trim() : "Chinese";
      let content: string;
      if (firstPrompt) {
        const intro = systemIntro(lang);
        const seedBlock = seed && seed.trim()
          ? `${intro}\n\n---\nSession context:\n${seed.trim()}\n---\n\n`
          : `${intro}\n\n---\n\n`;
        content = `${seedBlock}${text}`;
      } else if (lang !== lastLanguage) {
        // language changed mid-conversation. a parenthetical aside loses to the
        // spawn-time intro, so restate the Language section with the same
        // authority and mark it as superseding the earlier setting.
        content = `Language settings changed by the developer — this supersedes the earlier Language section:
- Answers to the developer: ${lang}
- Text outside a \`to-agent\` block stays in ${lang}.
- Suggested replies to the coding agent: unchanged (the agent's own language, usually English)

${text}`;
      } else {
        content = text;
      }
      lastLanguage = lang;
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
        // a respawned subprocess has no memory of the prior conversation — re-send
        // the persona + language on the next message (mirrors the observer loop).
        firstPrompt = true;
        lastLanguage = null;
        const ac = new AbortController();
        abort = ac;
        try {
          const result = query({
            prompt: makeGen(),
            options: {
              model,
              cwd,
              pathToClaudeCodeExecutable: claudePath,
              // empty allowlist: no built-in tools at all — a deny-list would
              // silently admit tools added in future sdk releases.
              tools: [],
              settingSources: [],
              mcpServers: {},
              strictMcpConfig: true,
              abortController: ac,
            },
          });

          for await (const m of result as AsyncIterable<unknown>) {
            // if the session was cleared/stopped mid-response, drop any buffered
            // message the aborted iterator still delivers — otherwise a late
            // onChunk would resurrect the just-wiped thread (broadcast after chat:cleared).
            if (stopped) break;
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
      h.push(trimmed, sendOpts?.seed, sendOpts?.language);
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
