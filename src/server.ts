import { startTailer, type SessionInfo } from "./tailer";
import type { MetaEvent } from "./jsonl";
import { createTurnsState, ingestEvent, type Turn, type TurnsState } from "./turns";
import { evaluateTurn, type Trigger } from "./triggers";
import { buildTurnFeed, startObserver } from "./observer";

const PORT = Number(Bun.env.META_PORT ?? Bun.env.PORT ?? 3737);
const POLL_MS = Number(Bun.env.META_POLL_MS ?? 500);
const PROJECT_SLUG = Bun.env.META_PROJECT_SLUG;
const RECENT_MS = Number(Bun.env.META_INBOX_MINUTES ?? 60) * 60 * 1000;
const MAX_EVENTS_PER_SESSION = 5000;
// observer is on by default; set META_OBSERVER_ENABLED=0 to opt out
// (e.g. when iterating in `bun run dev` to avoid orphaning the sdk subprocess
// on every hot reload — see state.md issue #4).
const OBSERVER_ENABLED = Bun.env.META_OBSERVER_ENABLED !== "0";
const OBSERVER_MODEL = Bun.env.META_OBSERVER_MODEL ?? "claude-sonnet-4-6";
const OBSERVER_BATCH_MS = Number(Bun.env.META_OBSERVER_BATCH_MS ?? 30_000);
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
};

const sessions = new Map<string, SessionState>();
const sockets = new Set<Bun.ServerWebSocket<unknown>>();

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
    };
    sessions.set(k, s);
  } else {
    s.info = info;
  }
  return s;
}

function snapshot(s: SessionState) {
  return {
    key: keyFor(s.info),
    info: s.info,
    events: s.events,
    threads: s.threads,
    lastEventTs: s.lastEventTs,
    model: s.model,
    contextTokens: s.contextTokens,
    totalOutputTokens: s.totalOutputTokens,
    observerDecisions: s.observerDecisions,
    ...(s.sessionName ? { sessionName: s.sessionName } : {}),
  };
}

function isInWindow(s: SessionState): boolean {
  return s.lastEventTs > 0 && Date.now() - s.lastEventTs <= RECENT_MS;
}

function recentSessions() {
  return Array.from(sessions.values())
    .filter(isInWindow)
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
  if (isInWindow(s)) {
    broadcast({ kind: "thread:new", sessionKey: keyFor(s.info), thread });
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
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

    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ kind: "hello", sessions: recentSessions() }));
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

const observer = OBSERVER_ENABLED
  ? startObserver({
      model: OBSERVER_MODEL,
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
        if (isInWindow(s)) {
          broadcast({
            kind: "observer:decision",
            sessionKey: d.sessionKey,
            decision,
          });
        }
      },
      onName(u) {
        const s = sessions.get(u.sessionKey);
        if (!s) return;
        if (!u.name) return;
        s.sessionName = u.name;
        if (isInWindow(s)) {
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
  console.log(`[observer] enabled · model=${OBSERVER_MODEL} · batch=${OBSERVER_BATCH_MS}ms`);
  // graceful shutdown — give the abort signal a moment to terminate the sdk subprocess
  // before the server process exits, otherwise the claude subprocess can be orphaned.
  const onSignal = (sig: string) => {
    console.log(`[server] received ${sig} — stopping observer`);
    observer.stop();
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
    // the observer is itself a cc subprocess (cwd ~/.chunk-to-chat/observer/),
    // so its own jsonl gets tailed too. surface it as a session card so the
    // user can see it's alive and what model it's running, but never feed its
    // own turns back to it (would be infinite mirror).
    const isObserverSelf = info.slug.includes("chunk-to-chat-observer");
    const s = getOrCreate(info);
    const wasInWindow = isInWindow(s);
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

    const nowInWindow = isInWindow(s);

    if (!wasInWindow && nowInWindow) {
      // first time this session crosses into the inbox window — send full snapshot
      broadcast({ kind: "session:upsert", session: snapshot(s) });
    } else if (nowInWindow) {
      broadcast({ kind: "event", sessionKey: keyFor(s.info), event: ev });
    }

    const result = ingestEvent(s.turns, ev);
    if (result.closed) {
      maybeOpenThread(s, result.closed);
      if (
        observer &&
        !isObserverSelf &&
        isInWindow(s) &&
        Date.now() - result.closed.endTs <= OBSERVER_FRESH_MS
      ) {
        observer.feed(buildTurnFeed(keyFor(s.info), s.info, result.closed));
      }
    }
  },
});
