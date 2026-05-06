import { startTailer, type SessionInfo } from "./tailer";
import type { MetaEvent } from "./jsonl";
import { createTurnsState, ingestEvent, type Turn, type TurnsState } from "./turns";
import { evaluateTurn, type Trigger } from "./triggers";
import { buildTurnFeed, startObserver } from "./observer";
import { startChatHost, type ChatChunk } from "./chat-agent";

const PORT = Number(Bun.env.META_PORT ?? Bun.env.PORT ?? 3737);
const POLL_MS = Number(Bun.env.META_POLL_MS ?? 500);
const PROJECT_SLUG = Bun.env.META_PROJECT_SLUG;
const RECENT_MS = Number(Bun.env.META_INBOX_MINUTES ?? 240) * 60 * 1000;
const MAX_EVENTS_PER_SESSION = 5000;
// observer is on by default; set META_OBSERVER_ENABLED=0 to opt out
// (e.g. when iterating in `bun run dev` to avoid orphaning the sdk subprocess
// on every hot reload — see state.md issue #4).
const OBSERVER_ENABLED = Bun.env.META_OBSERVER_ENABLED !== "0";
// META_OBSERVER_MODEL: per-turn decisions subprocess (sonnet by default — needs judgment).
// META_NAMER_MODEL:    session-naming subprocess    (haiku  by default — short label task).
const OBSERVER_MODEL = Bun.env.META_OBSERVER_MODEL ?? "claude-sonnet-4-6";
const NAMER_MODEL = Bun.env.META_NAMER_MODEL ?? "claude-haiku-4-5";
const CHAT_MODEL = Bun.env.META_CHAT_MODEL ?? "claude-sonnet-4-6";
const OBSERVER_BATCH_MS = Number(Bun.env.META_OBSERVER_BATCH_MS ?? 30_000);
// max chat chunks kept per session (in-memory only — lost on server restart).
const MAX_CHAT_CHUNKS = 200;
// when the observer flags a turn open=true with a prefill, the server fires
// that prefill into the chat agent automatically — no waiting on user input.
// these guards keep auto-fires from spamming a chatty session:
//   - per-session cooldown after each auto-send (default 5min)
//   - skip if the chat thread already has activity within the cooldown window
//     (no point opening a second front while the first is unread)
const AUTO_SEND_COOLDOWN_MS = Number(Bun.env.META_AUTO_SEND_COOLDOWN_MS ?? 5 * 60 * 1000);
// global on/off for auto-send, runtime-mutable via POST /chat/auto-send.
// initial value comes from META_AUTO_SEND_ENABLED (default "1" / on).
let autoSendEnabled = Bun.env.META_AUTO_SEND_ENABLED !== "0";
// last N closed turns we keep per session, used to seed the auto-fired chat.
const RECENT_CLOSED_TURNS = 5;
// only feed the observer turns whose close ts is within the last
// OBSERVER_FRESH_MS — backfill of historical turns at startup is skipped.
const OBSERVER_FRESH_MS = Number(Bun.env.META_OBSERVER_FRESH_MS ?? 5 * 60 * 1000);

export type Thread = {
  id: string;
  turnId: string;
  trigger: Trigger;
  status: "open";
  hint?: string;
  createdTs: number;
};

type ObserverInsight = {
  turnId: string;
  open: boolean;
  insight?: string;
  tags?: string[];
  prefill?: string;
  ts: number;
};

type SessionState = {
  info: SessionInfo;
  events: MetaEvent[];
  turns: TurnsState;
  threads: Thread[];
  threadByTurn: Map<string, Thread>;
  lastEventTs: number;
  model?: string;
  contextTokens: number;       // latest assistant message's input total (= current conversation size)
  totalOutputTokens: number;   // cumulative output across all assistant messages
  observerDecisions: ObserverInsight[];
  observerByTurn: Map<string, number>;
  sessionName?: string;             // observer-given 2-3 word display name
  recentClosedTurns: Turn[];        // ring buffer (RECENT_CLOSED_TURNS) used to seed auto-fired chats
};

const sessions = new Map<string, SessionState>();
const sockets = new Set<Bun.ServerWebSocket<unknown>>();
// chat threads live alongside SessionState but are keyed off the same sessionKey.
// kept separate so observed-data state stays focused on tailer-sourced facts.
const chatThreads = new Map<string, ChatChunk[]>();
const chatStatuses = new Map<string, { status: string; message?: string; ts: number }>();
// per-session cooldown for observer-driven auto-sends; see AUTO_SEND_COOLDOWN_MS.
const lastAutoSendTs = new Map<string, number>();

function pushChatChunk(c: ChatChunk) {
  let arr = chatThreads.get(c.sessionKey);
  if (!arr) {
    arr = [];
    chatThreads.set(c.sessionKey, arr);
  }
  arr.push(c);
  if (arr.length > MAX_CHAT_CHUNKS) arr.splice(0, arr.length - MAX_CHAT_CHUNKS);
}

function keyFor(info: SessionInfo): string {
  return `${info.source}:${info.path}`;
}

function getOrCreate(info: SessionInfo): SessionState {
  const k = keyFor(info);
  let s = sessions.get(k);
  if (!s) {
    s = {
      info,
      events: [],
      turns: createTurnsState(),
      threads: [],
      threadByTurn: new Map(),
      lastEventTs: 0,
      contextTokens: 0,
      totalOutputTokens: 0,
      observerDecisions: [],
      observerByTurn: new Map(),
      recentClosedTurns: [],
    };
    sessions.set(k, s);
  } else {
    s.info = info;
  }
  return s;
}

function snapshot(s: SessionState) {
  const k = keyFor(s.info);
  const chat = chatThreads.get(k);
  const status = chatStatuses.get(k);
  return {
    key: k,
    info: s.info,
    events: s.events,
    threads: s.threads,
    lastEventTs: s.lastEventTs,
    model: s.model,
    contextTokens: s.contextTokens,
    totalOutputTokens: s.totalOutputTokens,
    observerDecisions: s.observerDecisions,
    ...(s.sessionName ? { sessionName: s.sessionName } : {}),
    ...(chat && chat.length ? { chatThread: chat } : {}),
    ...(status ? { chatStatus: status } : {}),
  };
}

function isInWindow(s: SessionState): boolean {
  return s.lastEventTs > 0 && Date.now() - s.lastEventTs <= RECENT_MS;
}

// claude code spawns ephemeral helper subprocesses (title generators, /code-review
// runners, etc.) with cwd under macOS temp-folder paths like
// /private/var/folders/<...>/T/. they share the cc jsonl schema so the tailer
// picks them up, but they are noise — short-lived, never the user's real session.
// hide them from the inbox; the tailer still reads them (cheap) so we don't lose
// the option to surface them later behind a flag if needed.
function isEphemeralHelper(info: SessionInfo): boolean {
  return info.slug.startsWith("-private-var-folders-");
}

function isVisible(s: SessionState): boolean {
  return isInWindow(s) && !isEphemeralHelper(s.info);
}

function recentSessions() {
  return Array.from(sessions.values())
    .filter(isVisible)
    .sort((a, b) => b.lastEventTs - a.lastEventTs)
    .map(snapshot);
}

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of sockets) ws.send(data);
}

function maybeOpenThread(s: SessionState, turn: Turn) {
  if (s.threadByTurn.has(turn.id)) return;
  const trigger = evaluateTurn(turn);
  if (!trigger) return;
  const thread: Thread = {
    id: turn.id,
    turnId: turn.id,
    trigger,
    status: "open",
    createdTs: Date.now(),
  };
  if (turn.userPromptText) thread.hint = clip(turn.userPromptText, 80);
  s.threads.push(thread);
  s.threadByTurn.set(turn.id, thread);
  if (isVisible(s)) {
    broadcast({ kind: "thread:new", sessionKey: keyFor(s.info), thread });
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// build the seed block for an auto-fired chat: the observer's insight + tags +
// the last RECENT_CLOSED_TURNS turn excerpts. fed once into the chat-agent so
// the model has real context for its first reply, without us doing a session fork.
function buildAutoSendSeed(s: SessionState, decision: ObserverInsight): string {
  const k = keyFor(s.info);
  const lines: string[] = [];
  lines.push(`The user just watched session "${s.sessionName ?? s.info.slug}" finish a turn.`);
  if (decision.insight) lines.push(`Observer flagged: ${decision.insight}`);
  if (decision.tags?.length) lines.push(`Tags: ${decision.tags.join(", ")}`);
  if (s.recentClosedTurns.length) {
    lines.push("");
    lines.push(`Recent ${s.recentClosedTurns.length} closed turn(s) (oldest first):`);
    for (const turn of s.recentClosedTurns) {
      const feed = buildTurnFeed(k, s.info, turn);
      lines.push("");
      lines.push("---");
      lines.push(
        `metrics: ${feed.outputTokens} tok · ${feed.toolUseCount} tools · +${feed.linesAdded}/-${feed.linesRemoved} lines`
      );
      if (feed.userPrompt) lines.push(`user: ${feed.userPrompt}`);
      if (feed.assistantExcerpt) lines.push(`assistant: ${feed.assistantExcerpt}`);
    }
  }
  return lines.join("\n");
}

// fired from onDecision when the observer flags open=true with a prefill.
// guards against spamming chatty sessions: per-session cooldown + skip if the
// chat thread already has activity within that window.
function maybeAutoSendChat(s: SessionState, decision: ObserverInsight) {
  if (!autoSendEnabled) return;
  if (!decision.open || !decision.prefill) return;
  if (!isVisible(s)) return; // never auto-fire for ephemeral helpers / our own subprocesses
  const key = keyFor(s.info);
  const now = Date.now();
  const last = lastAutoSendTs.get(key) ?? 0;
  if (now - last < AUTO_SEND_COOLDOWN_MS) return;
  const thread = chatThreads.get(key);
  if (thread && thread.length > 0) {
    const lastChatTs = thread[thread.length - 1]!.ts;
    if (now - lastChatTs < AUTO_SEND_COOLDOWN_MS) return;
  }
  lastAutoSendTs.set(key, now);
  const seed = buildAutoSendSeed(s, decision);
  console.log(
    `[auto-send] ${s.sessionName ?? s.info.slug} · prefill="${clip(decision.prefill, 80)}"`
  );
  chatHost.send(key, decision.prefill, { seed, userKind: "auto" });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("public/index.html"));
    }

    // static assets — anything under /assets/ serves from public/assets/.
    // basic path-traversal guard: refuse `..` segments before resolving.
    if (url.pathname.startsWith("/assets/") && req.method === "GET") {
      if (url.pathname.includes("..")) {
        return new Response("not found", { status: 404 });
      }
      const file = Bun.file(`public${url.pathname}`);
      if (await file.exists()) return new Response(file);
      return new Response("not found", { status: 404 });
    }

    if (url.pathname === "/state" && req.method === "GET") {
      return Response.json({ sessions: recentSessions() });
    }

    if (url.pathname === "/sessions" && req.method === "GET") {
      const list = Array.from(sessions.values()).map((s) => ({
        info: s.info,
        eventCount: s.events.length,
        threadCount: s.threads.length,
        lastEventTs: s.lastEventTs,
        inWindow: isInWindow(s),
      }));
      return Response.json({ sessions: list, recentMs: RECENT_MS });
    }

    if (url.pathname === "/chat/send" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const sessionKey = typeof o.sessionKey === "string" ? o.sessionKey : null;
      const text = typeof o.text === "string" ? o.text : null;
      if (!sessionKey || !text || !text.trim()) {
        return Response.json({ error: "sessionKey and text required" }, { status: 400 });
      }
      if (!sessions.has(sessionKey)) {
        return Response.json({ error: "unknown sessionKey" }, { status: 404 });
      }
      chatHost.send(sessionKey, text);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/chat/auto-send" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      if (typeof o.enabled !== "boolean") {
        return Response.json({ error: "enabled boolean required" }, { status: 400 });
      }
      autoSendEnabled = o.enabled;
      console.log(`[auto-send] runtime toggle → ${autoSendEnabled ? "enabled" : "disabled"}`);
      broadcast({ kind: "autosend:setting", enabled: autoSendEnabled });
      return Response.json({ ok: true, enabled: autoSendEnabled });
    }

    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(
        JSON.stringify({
          kind: "hello",
          sessions: recentSessions(),
          autoSendEnabled,
        })
      );
    },
    message() {
      // no client → server messages yet
    },
    close(ws) {
      sockets.delete(ws);
    },
  },
});

console.log(`chunk-to-chat · listening on http://localhost:${server.port}`);

// chat host is initialized before the observer because the observer's onDecision
// callback dispatches into chatHost.send for auto-sends.
const chatHost = startChatHost({
  model: CHAT_MODEL,
  onChunk(c) {
    pushChatChunk(c);
    broadcast({ kind: "chat:chunk", sessionKey: c.sessionKey, chunk: c });
  },
  onStatus(u) {
    const s = { status: u.status, ts: Date.now(), ...(u.message ? { message: u.message } : {}) };
    chatStatuses.set(u.sessionKey, s);
    broadcast({ kind: "chat:status", sessionKey: u.sessionKey, ...s });
  },
});
console.log(`[chat] enabled · model=${CHAT_MODEL}`);

const observer = OBSERVER_ENABLED
  ? startObserver({
      decisionsModel: OBSERVER_MODEL,
      namerModel: NAMER_MODEL,
      batchMs: OBSERVER_BATCH_MS,
      onDecision(d) {
        const s = sessions.get(d.sessionKey);
        if (!s) return;
        const decision: ObserverInsight = {
          turnId: d.turnId,
          open: d.open,
          ts: Date.now(),
          ...(d.insight ? { insight: d.insight } : {}),
          ...(d.tags && d.tags.length ? { tags: d.tags } : {}),
          ...(d.prefill ? { prefill: d.prefill } : {}),
        };
        const existingIdx = s.observerByTurn.get(d.turnId);
        if (existingIdx !== undefined) {
          s.observerDecisions[existingIdx] = decision;
        } else {
          s.observerByTurn.set(d.turnId, s.observerDecisions.length);
          s.observerDecisions.push(decision);
        }
        if (isVisible(s)) {
          broadcast({
            kind: "observer:decision",
            sessionKey: d.sessionKey,
            decision,
          });
        }
        // fire-and-forget auto-send: when the observer flags the turn open with a
        // prefill, kick off a chat-agent conversation so the user opens the
        // session to a primed thread instead of an empty input.
        maybeAutoSendChat(s, decision);
      },
      onName(u) {
        const s = sessions.get(u.sessionKey);
        if (!s) return;
        if (!u.name) return;
        s.sessionName = u.name;
        if (isVisible(s)) {
          broadcast({
            kind: "observer:name",
            sessionKey: u.sessionKey,
            name: u.name,
          });
        }
      },
    })
  : null;
if (observer) {
  console.log(
    `[observer] enabled · decisions=${OBSERVER_MODEL} · namer=${NAMER_MODEL} · batch=${OBSERVER_BATCH_MS}ms`
  );
}
// graceful shutdown — give abort signals a moment to terminate sdk subprocesses
// before the server process exits, otherwise claude subprocesses can be orphaned.
{
  const onSignal = (sig: string) => {
    console.log(`[server] received ${sig} — stopping observer + chat host`);
    observer?.stop();
    chatHost.stop();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

startTailer({
  ...(PROJECT_SLUG ? { projectSlug: PROJECT_SLUG } : {}),
  pollMs: POLL_MS,
  recentMs: RECENT_MS,
  onSession(info) {
    console.log(`[tailer] new session ${info.source}/${info.sessionId.slice(0, 8)} (${info.slug})`);
  },
  onEvent(info, ev) {
    // our own sdk subprocesses (observer decisions: ~/.chunk-to-chat/observer/,
    // namer: ~/.cut-the-cake/namer/, chat hosts: ~/.cut-the-cake/chat/<hash>/)
    // are themselves cc subprocesses whose jsonls get tailed. surface them as
    // session cards so the user can see they're alive, but never feed their
    // own turns back (would be an infinite mirror).
    const isObserverSelf =
      info.slug.includes("chunk-to-chat-observer") ||
      info.slug.includes("cut-the-cake-namer") ||
      info.slug.includes("cut-the-cake-chat");
    const s = getOrCreate(info);
    const wasVisible = isVisible(s);
    s.events.push(ev);
    if (s.events.length > MAX_EVENTS_PER_SESSION) {
      s.events.splice(0, s.events.length - MAX_EVENTS_PER_SESSION);
    }
    s.lastEventTs = Math.max(s.lastEventTs, ev.ts);
    if (ev.kind === "assistant_text") {
      if (ev.model) s.model = ev.model;
      // each assistant message's input total reports the full context up to
      // that point (cache + new). overwrite — don't sum (would N-count cached prefix).
      if (typeof ev.inputTokens === "number") s.contextTokens = ev.inputTokens;
      if (typeof ev.tokens === "number") s.totalOutputTokens += ev.tokens;
    }

    const nowVisible = isVisible(s);

    if (!wasVisible && nowVisible) {
      // first time this session crosses into visibility — send full snapshot
      broadcast({ kind: "session:upsert", session: snapshot(s) });
    } else if (nowVisible) {
      broadcast({ kind: "event", sessionKey: keyFor(s.info), event: ev });
    }

    const result = ingestEvent(s.turns, ev);
    if (result.closed) {
      // ring buffer for the auto-send seed builder.
      s.recentClosedTurns.push(result.closed);
      if (s.recentClosedTurns.length > RECENT_CLOSED_TURNS) {
        s.recentClosedTurns.splice(0, s.recentClosedTurns.length - RECENT_CLOSED_TURNS);
      }
      maybeOpenThread(s, result.closed);
      if (
        observer &&
        !isObserverSelf &&
        isVisible(s) &&
        Date.now() - result.closed.endTs <= OBSERVER_FRESH_MS
      ) {
        observer.feed(buildTurnFeed(keyFor(s.info), s.info, result.closed));
      }
    }
  },
});
