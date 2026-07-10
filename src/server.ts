import { createHash } from "node:crypto";
import { startTailer, type SessionInfo } from "./tailer";
import type { MetaEvent } from "./jsonl";
import { createTurnsState, ingestEvent, type Turn, type TurnsState } from "./turns";
import { evaluateTurn, type Trigger } from "./triggers";
import { buildTurnFeed, startObserver, type TurnFeed } from "./observer";
import { startChatHost, type ChatChunk } from "./chat-agent";
import { startRegistry, type RegistrySnapshot } from "./registry";

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
const OBSERVER_MODEL = Bun.env.META_OBSERVER_MODEL ?? "claude-sonnet-5";
const CHAT_MODEL = Bun.env.META_CHAT_MODEL ?? "claude-sonnet-5";
const OBSERVER_BATCH_MS = Number(Bun.env.META_OBSERVER_BATCH_MS ?? 30_000);
// max chat chunks kept per session (in-memory only — lost on server restart).
const MAX_CHAT_CHUNKS = 200;
// last N closed turns we keep per session, used to seed the chat with the
// latest exchange(s) so the assistant can answer questions about them. the
// chat seed slices this to a per-session, user-tunable depth (chatContextTurns,
// clamped to CHAT_CONTEXT_TURNS_{MIN,MAX}); the summary digest keeps its own
// fixed depth so widening the chat context never widens summaries.
const RECENT_CLOSED_TURNS = 10;
const SUMMARY_DIGEST_TURNS = 5;
const CHAT_CONTEXT_TURNS_MIN = 1;
const CHAT_CONTEXT_TURNS_MAX = 10;
const CHAT_CONTEXT_TURNS_DEFAULT = 1;
// the user-facing explanation language. everything the app says TO the user —
// the assistant's answers and the observer's glance-insight — is written in this
// language. the suggested reply back to the coding agent stays in the agent's
// own language. runtime-mutable via POST /settings/language.
const LANGUAGE_NAMES: Record<string, string> = {
  he: "Hebrew",
  en: "English",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
  ru: "Russian",
  de: "German",
  zh: "Chinese",
};
function isKnownLang(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, code);
}
let explainLang = isKnownLang(Bun.env.META_EXPLAIN_LANG ?? "") ? Bun.env.META_EXPLAIN_LANG! : "he";
function explainLanguageName(): string {
  return isKnownLang(explainLang) ? LANGUAGE_NAMES[explainLang]! : "Hebrew";
}
// shadow mode for the abtop-style PID-driven discovery (src/registry.ts).
// when off (default), the registry still runs every 2s and is exposed at
// /diag/discovery for parity verification — it just doesn't drive the inbox
// yet. flipping to "1" will replace the legacy mtime-driven tailer view as
// the source-of-truth for which sessions to show; that lands in a follow-up
// commit once the diag has been compared against real usage.
const USE_PROCESS_DISCOVERY = Bun.env.META_USE_PROCESS_DISCOVERY === "1";
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
  summary?: string;            // one-sentence session summary, refreshed every few closed turns
  summaryTs?: number;          // when the summary last changed (drives the card update pulse)
  closedTurnCount: number;     // total closed turns — the summary regenerates every 4th
  recentClosedTurns: Turn[];   // ring buffer (RECENT_CLOSED_TURNS) — feeds the summary + chat seed
  chatContextTurns: number;    // how many recent turns the chat seed includes (user-tunable, 1..10)
};

const sessions = new Map<string, SessionState>();
const sockets = new Set<Bun.ServerWebSocket<unknown>>();
// chat threads live alongside SessionState but are keyed off the same sessionKey.
// kept separate so observed-data state stays focused on tailer-sourced facts.
const chatThreads = new Map<string, ChatChunk[]>();
const chatStatuses = new Map<string, { status: string; message?: string; ts: number }>();

function pushChatChunk(c: ChatChunk) {
  let arr = chatThreads.get(c.sessionKey);
  if (!arr) {
    arr = [];
    chatThreads.set(c.sessionKey, arr);
  }
  arr.push(c);
  if (arr.length > MAX_CHAT_CHUNKS) arr.splice(0, arr.length - MAX_CHAT_CHUNKS);
}

// reset a session's Q&A to pristine (as if the session was untouched): stop the
// chat subprocess so the assistant forgets, wipe the stored thread + status, and
// tell clients. used by the manual clear route and by the auto-clear that fires
// when a session advances to a new turn.
function clearChat(sessionKey: string): void {
  chatHost.stop(sessionKey);
  chatThreads.delete(sessionKey);
  chatStatuses.delete(sessionKey);
  broadcast({ kind: "chat:cleared", sessionKey });
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
      closedTurnCount: 0,
      recentClosedTurns: [],
      chatContextTurns: CHAT_CONTEXT_TURNS_DEFAULT,
    };
    sessions.set(k, s);
  } else {
    s.info = info;
  }
  return s;
}

// chat-agent sessions live under ~/.sottochat/chat/<sha1(upstream-key, 12)>/
// so their slug ends with that hash. resolve back to the upstream session by
// scanning the live session map for a key whose hash matches — gives us the
// upstream project name to use as a prefix on the chat session's display name.
function chatHashFor(sessionKey: string): string {
  return createHash("sha1").update(sessionKey).digest("hex").slice(0, 12);
}
function chatDisplayNameFor(info: SessionInfo): string | null {
  const m = info.slug.match(/(?:sottochat|cut-the-cake)-chat-([a-f0-9]+)$/);
  if (!m) return null;
  const hash = m[1];
  for (const k of sessions.keys()) {
    if (chatHashFor(k) !== hash) continue;
    const upstream = sessions.get(k);
    const slug = upstream?.info.slug ?? "";
    const project = slug.replace(/^-+/, "").split("-").pop() ?? "";
    if (project) return `${project} · chat`;
  }
  return null;
}

function snapshot(s: SessionState) {
  const k = keyFor(s.info);
  const chat = chatThreads.get(k);
  const status = chatStatuses.get(k);
  const displayName = chatDisplayNameFor(s.info);
  return {
    key: k,
    info: s.info,
    events: s.events,
    threads: s.threads,
    lastEventTs: s.lastEventTs,
    model: s.model,
    contextTokens: s.contextTokens,
    totalOutputTokens: s.totalOutputTokens,
    chatContextTurns: s.chatContextTurns,
    ...(s.summary ? { summary: s.summary } : {}),
    ...(s.summaryTs ? { summaryTs: s.summaryTs } : {}),
    ...(displayName ? { displayName } : {}),
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

function assistantTextOf(turn: Turn): string {
  const parts: string[] = [];
  for (const ev of turn.events) {
    if (ev.kind === "assistant_text") parts.push(ev.text);
  }
  return parts.join("\n\n");
}

// build the seed block for the chat-agent: a one-shot context envelope fed once
// into the chat subprocess so the model has the real latest exchange to answer
// about, without a session fork. the chat-agent ignores `seed` on follow-ups.
// the most recent turn is included generously (so "what does it say at the end"
// works); earlier turns are brief context.
function buildChatSeed(s: SessionState): string {
  const lines: string[] = [];
  lines.push(`The user is watching the coding-agent session "${s.info.slug}".`);
  if (s.info.cwd) lines.push(`Working directory: ${s.info.cwd}`);
  if (s.summary) lines.push(`Session summary so far: ${s.summary}`);
  // include only the last N turns the user asked for (the latest one in full,
  // earlier ones brief). the ring buffer may hold more than that.
  const turns = s.recentClosedTurns.slice(-s.chatContextTurns);
  if (turns.length) {
    const prior = turns.slice(0, -1);
    const latest = turns[turns.length - 1]!;
    if (prior.length) {
      lines.push("");
      lines.push(`Earlier turns in this session (oldest first, brief):`);
      for (const turn of prior) {
        const txt = clip(assistantTextOf(turn), 400);
        if (!txt) continue;
        lines.push("---");
        lines.push(txt);
      }
    }
    lines.push("");
    lines.push(`THE LATEST AGENT OUTPUT (this is what "it" / "this" refers to):`);
    lines.push("---");
    const up = clip(latest.userPromptText ?? "", 1000);
    if (up) lines.push(`[the user's request that opened this turn]: ${up}`);
    lines.push(clip(assistantTextOf(latest), 8000) || "(no assistant text in the latest turn)");
    lines.push("---");
  }
  return lines.join("\n");
}

// build the observer feed for a session summary: the latest turn's ids/metrics
// (buildTurnFeed) with the assistantExcerpt swapped for a digest of the recent
// closed turns, so the summarizer sees the session's arc, not one snippet.
let summaryFeedSeq = 0;
function buildSummaryFeed(s: SessionState): TurnFeed {
  // the summarizer keeps a fixed look-back independent of the chat's tunable
  // depth, so raising chatContextTurns never widens the summary.
  const turns = s.recentClosedTurns.slice(-SUMMARY_DIGEST_TURNS);
  const latest = turns[turns.length - 1]!;
  const digest = turns
    .map((t) => clip(assistantTextOf(t), 600))
    .filter(Boolean)
    .join("\n\n· · ·\n\n");
  const base = buildTurnFeed(keyFor(s.info), s.info, latest);
  // give each request a globally-unique echo id: codex per-session turn ids
  // (cx-<seq>) can collide across sessions batched together, which would map a
  // summary back to the wrong session. this id is opaque — only used to re-pair
  // the model's reply with its request.
  return { ...base, turnId: `sum-${summaryFeedSeq++}`, assistantExcerpt: clip(digest, 4000) };
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

    // shadow-mode diagnostic: what abtop-style PID-driven discovery sees this
    // tick. once compared against /sessions, the next commit flips the flag
    // and starts driving the inbox from this view instead of the tailer.
    if (url.pathname === "/diag/discovery" && req.method === "GET") {
      const snap = registry.current();
      if (!snap) {
        return Response.json({ ready: false });
      }
      return Response.json({
        ready: true,
        fetchedAt: snap.fetchedAt,
        tickCount: snap.tickCount,
        tookMs: Math.round(snap.tookMs * 10) / 10,
        sessions: snap.sessions.map((s) => ({
          agent: s.agent,
          pid: s.pid,
          sessionId: s.sessionId,
          cwd: s.cwd,
          startedAt: s.startedAt,
          ...(s.agent === "claude"
            ? {
                originalSessionId: s.originalSessionId,
                repaired: s.sessionId !== s.originalSessionId,
                isInternal: s.isInternal,
                status: s.status,
                name: s.name,
                version: s.version,
                entrypoint: s.entrypoint,
                transcriptPath: s.transcriptPath,
              }
            : {
                rolloutPath: s.rolloutPath,
                isExec: s.isExec,
                isRecent: s.isRecent,
                version: s.version,
                gitBranch: s.gitBranch,
              }),
        })),
      });
    }

    // diff: which sids does each view (process-discovery vs legacy tailer)
    // see that the other doesn't? expected steady-state once the new view
    // takes over: onlyInTailer = dead-PID ghosts, onlyInDiscovery = empty
    // (or only contains brand-new sessions whose first event hasn't landed).
    if (url.pathname === "/diag/discovery-vs-tailer" && req.method === "GET") {
      const snap = registry.current();
      const discoverySids = new Set<string>();
      if (snap) {
        for (const s of snap.sessions) {
          if (s.agent === "claude" && !s.isInternal) discoverySids.add(s.sessionId);
        }
      }
      const tailerSids = new Set<string>();
      const tailerEntries: { sid: string; lastEventTs: number; visible: boolean }[] = [];
      for (const sess of sessions.values()) {
        const sid = sess.info.sessionId;
        tailerSids.add(sid);
        tailerEntries.push({
          sid,
          lastEventTs: sess.lastEventTs,
          visible: isInWindow(sess) && !isEphemeralHelper(sess.info),
        });
      }
      const onlyInDiscovery = [...discoverySids].filter((s) => !tailerSids.has(s));
      const onlyInTailer = tailerEntries.filter((e) => !discoverySids.has(e.sid));
      return Response.json({
        ready: !!snap,
        discoveryCount: discoverySids.size,
        tailerCount: tailerEntries.length,
        onlyInDiscovery,
        onlyInTailer,
      });
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
      const sess = sessions.get(sessionKey);
      if (!sess) {
        return Response.json({ error: "unknown sessionKey" }, { status: 404 });
      }
      // the chat-agent uses this seed on the first prompt of the subprocess and
      // ignores it on follow-ups — it carries the working dir, the session
      // summary so far, and the recent turns (latest one in full).
      const seed = buildChatSeed(sess);
      chatHost.send(sessionKey, text, { seed, language: explainLanguageName() });
      return Response.json({ ok: true });
    }

    if (url.pathname === "/chat/clear" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const sessionKey = typeof o.sessionKey === "string" ? o.sessionKey : null;
      if (!sessionKey) {
        return Response.json({ error: "sessionKey required" }, { status: 400 });
      }
      // drop the chat subprocess so the assistant forgets, and wipe the stored
      // thread + status. the next send spawns a fresh subprocess, re-seeded with
      // the latest exchange.
      clearChat(sessionKey);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/chat/context-turns" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const sessionKey = typeof o.sessionKey === "string" ? o.sessionKey : null;
      if (!sessionKey) {
        return Response.json({ error: "sessionKey required" }, { status: 400 });
      }
      const sess = sessions.get(sessionKey);
      if (!sess) {
        return Response.json({ error: "unknown sessionKey" }, { status: 404 });
      }
      if (typeof o.turns !== "number" || !Number.isFinite(o.turns)) {
        return Response.json({ error: "turns must be a number" }, { status: 400 });
      }
      const turns = Math.min(
        CHAT_CONTEXT_TURNS_MAX,
        Math.max(CHAT_CONTEXT_TURNS_MIN, Math.floor(o.turns))
      );
      if (sess.chatContextTurns !== turns) {
        sess.chatContextTurns = turns;
        broadcast({ kind: "chat:context-turns", sessionKey, turns });
      }
      return Response.json({ ok: true, turns });
    }

    if (url.pathname === "/settings/language" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const lang = typeof o.language === "string" ? o.language : "";
      if (!isKnownLang(lang)) {
        return Response.json({ error: "unknown language" }, { status: 400 });
      }
      // no-op guard: only mutate + broadcast on an actual change, so a client
      // syncing its (matching) saved choice on load doesn't clobber other clients.
      if (explainLang !== lang) {
        explainLang = lang;
        console.log(`[settings] explain language → ${lang} (${LANGUAGE_NAMES[lang]})`);
        broadcast({ kind: "settings:language", language: explainLang });
      }
      return Response.json({ ok: true, language: explainLang });
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
          language: explainLang,
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

console.log(`sottochat · listening on http://localhost:${server.port}`);

// the chat host — a per-session claude subprocess the user talks to (see chat-agent.ts).
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
      summaryModel: OBSERVER_MODEL,
      batchMs: OBSERVER_BATCH_MS,
      getLanguage: () => explainLanguageName(),
      onSummary(d) {
        const s = sessions.get(d.sessionKey);
        if (!s || !d.summary) return;
        if (s.summary === d.summary) return; // no change → no repaint/pulse
        s.summary = d.summary;
        s.summaryTs = Date.now();
        if (isVisible(s)) {
          broadcast({
            kind: "session:summary",
            sessionKey: d.sessionKey,
            summary: s.summary,
            summaryTs: s.summaryTs,
          });
        }
      },
    })
  : null;
if (observer) {
  console.log(
    `[observer] enabled · summarizer=${OBSERVER_MODEL} · batch=${OBSERVER_BATCH_MS}ms`
  );
}

// graceful shutdown — give abort signals a moment to terminate sdk subprocesses
// before the server process exits, otherwise claude subprocesses can be orphaned.
{
  const onSignal = async (sig: string) => {
    console.log(`[server] received ${sig} — stopping observer + chat host + registry`);
    observer?.stop();
    chatHost.stop();
    registry.stop();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

// abtop-style PID-driven discovery — runs every 2s in shadow mode regardless
// of META_USE_PROCESS_DISCOVERY (so /diag/discovery is always live for
// comparison). when USE_PROCESS_DISCOVERY=1 in a follow-up, this snapshot
// becomes the source-of-truth for which sessions to surface in the inbox.
const registry = startRegistry({
  onSnapshot: (_snap: RegistrySnapshot) => {
    // intentionally quiet — full snapshots fan out only via /diag/discovery
    // for now. a future commit will broadcast deltas over ws to drive the UI.
  },
});
console.log(
  `[registry] enabled · use-as-driver=${USE_PROCESS_DISCOVERY} · diag at /diag/discovery`,
);

startTailer({
  ...(PROJECT_SLUG ? { projectSlug: PROJECT_SLUG } : {}),
  pollMs: POLL_MS,
  recentMs: RECENT_MS,
  onSession(info) {
    console.log(`[tailer] new session ${info.source}/${info.sessionId.slice(0, 8)} (${info.slug})`);
  },
  onEvent(info, ev) {
    // our own sdk subprocesses (observer + chat hosts, now under ~/.sottochat/)
    // are themselves cc subprocesses whose jsonls get tailed. surface them as
    // session cards so the user can see they're alive, but never feed their own
    // turns back (would be an infinite mirror). the two legacy roots
    // (~/.cut-the-cake chat, ~/.chunk-to-chat observer) still have sessions on
    // disk, so we keep matching their slugs too.
    const isObserverSelf =
      info.slug.includes("sottochat-chat") ||
      info.slug.includes("sottochat-observer") ||
      info.slug.includes("chunk-to-chat-observer") ||
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
      // ring buffer feeding the summary digest + the chat seed.
      s.recentClosedTurns.push(result.closed);
      if (s.recentClosedTurns.length > RECENT_CLOSED_TURNS) {
        s.recentClosedTurns.splice(0, s.recentClosedTurns.length - RECENT_CLOSED_TURNS);
      }
      maybeOpenThread(s, result.closed);
      const fresh = Date.now() - result.closed.endTs <= OBSERVER_FRESH_MS;
      // a fresh turn moved the session on — reset any open Q&A for it so the next
      // question re-seeds against the new turn (pristine, as if untouched). only
      // when there's actually a discussion to clear, and never for our own sdk
      // subprocesses (which carry no user chat).
      if (fresh && !isObserverSelf && chatThreads.has(keyFor(s.info))) {
        clearChat(keyFor(s.info));
      }
      // count only fresh (observed) turns — historical turns replayed from disk at
      // startup must NOT advance the cadence, or a resumed session would miss its
      // first/every-4th trigger. label regenerates on the first observed close,
      // then every 4th, so it stays current without a call per turn.
      if (observer && !isObserverSelf && isVisible(s) && fresh) {
        s.closedTurnCount += 1;
        const dueForSummary = s.closedTurnCount === 1 || s.closedTurnCount % 4 === 0;
        if (dueForSummary) observer.feed(buildSummaryFeed(s));
      }
    }
  },
});
