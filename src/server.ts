import { createHash } from "node:crypto";
import { startTailer, type SessionInfo } from "./tailer";
import type { MetaEvent } from "./jsonl";
import { createTurnsState, ingestEvent, type Turn, type TurnsState } from "./turns";
import { evaluateTurn, type Trigger } from "./triggers";
import { buildTurnFeed, startObserver } from "./observer";
import { startScriptifier, SCRIPT_STYLES, type ScriptBeat, type ScriptStyle } from "./scriptifier";
import { generateTts, ttsAudioPath, type WordTiming } from "./tts";
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
const OBSERVER_MODEL = Bun.env.META_OBSERVER_MODEL ?? "claude-sonnet-4-6";
const CHAT_MODEL = Bun.env.META_CHAT_MODEL ?? "claude-sonnet-4-6";
const OBSERVER_BATCH_MS = Number(Bun.env.META_OBSERVER_BATCH_MS ?? 30_000);
// scriptifier: parallel sonnet subprocess that turns each closed turn into a
// karaoke-style script for the video pane. shorter batch ceiling than the
// observer (we want video to populate fast, not on a 30s heartbeat).
const SCRIPTIFIER_ENABLED = Bun.env.META_SCRIPTIFIER_ENABLED !== "0";
const SCRIPTIFIER_MODEL = Bun.env.META_SCRIPTIFIER_MODEL ?? "claude-sonnet-4-6";
const SCRIPTIFIER_BATCH_MS = Number(Bun.env.META_SCRIPTIFIER_BATCH_MS ?? 2_000);
const TTS_VOICE = Bun.env.META_TTS_VOICE ?? "af_heart";
// max chat chunks kept per session (in-memory only — lost on server restart).
const MAX_CHAT_CHUNKS = 200;
// per-session ring buffer for ScriptPayloads — keeps a meaningful history
// without ballooning state. oldest by closedTs is pruned when a new one lands.
const MAX_SCRIPTS_PER_SESSION = 12;
// when the observer flags a turn open=true with a prefill, the server fires
// that prefill into the chat agent automatically — no waiting on user input.
// these guards keep auto-fires from spamming a chatty session:
//   - per-session cooldown after each auto-send (default 5min)
//   - skip if the chat thread already has activity within the cooldown window
//     (no point opening a second front while the first is unread)
const AUTO_SEND_COOLDOWN_MS = Number(Bun.env.META_AUTO_SEND_COOLDOWN_MS ?? 5 * 60 * 1000);
// global on/off for auto-send, runtime-mutable via POST /chat/auto-send.
// default off — opt in by setting META_AUTO_SEND_ENABLED=1 or by clicking
// the top-nav toggle. off-by-default keeps a fresh server quiet until the
// user explicitly turns it on.
let autoSendEnabled = Bun.env.META_AUTO_SEND_ENABLED === "1";
// active scriptifier prompt preset. one of SCRIPT_STYLES; runtime-mutable via
// POST /debug/script-style. seeded from META_SCRIPT_STYLE if set, else
// "default". the picker in the video pane writes here; on each closed turn
// we pass this to scriptifier.feed so the right per-style subprocess handles
// the prompt. previous turns are NOT re-scripted on style change.
let activeScriptStyle: ScriptStyle = (() => {
  const env = Bun.env.META_SCRIPT_STYLE as ScriptStyle | undefined;
  if (env && SCRIPT_STYLES.includes(env)) return env;
  return "default";
})();
// last N closed turns we keep per session, used to seed the auto-fired chat.
const RECENT_CLOSED_TURNS = 5;
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

type ObserverInsight = {
  turnId: string;
  open: boolean;
  insight?: string;
  tags?: string[];
  prefill?: string;
  ts: number;
};

// per-turn karaoke script + tts payload. lifecycle:
//   drafting → (model emits beats) → rendering → (tts done) → ready
//                                  → (tts fails) → error
type ScriptPayload = {
  turnId: string;
  beats: ScriptBeat[];
  audioUrl?: string;       // /tts/<hash>.wav — set once tts is ready
  durationS?: number;
  words?: WordTiming[];
  status: "drafting" | "rendering" | "ready" | "error";
  errorMessage?: string;
  ts: number;             // last ui mutation — used for status pill freshness
  closedTs: number;       // turn end ts at scriptifier-feed time — used for active-script ordering
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
  recentClosedTurns: Turn[];        // ring buffer (RECENT_CLOSED_TURNS) used to seed auto-fired chats
  scripts: Map<string, ScriptPayload>;  // turnId → karaoke script + tts state
};

const sessions = new Map<string, SessionState>();
const sockets = new Set<Bun.ServerWebSocket<unknown>>();
// chat threads live alongside SessionState but are keyed off the same sessionKey.
// kept separate so observed-data state stays focused on tailer-sourced facts.
const chatThreads = new Map<string, ChatChunk[]>();
const chatStatuses = new Map<string, { status: string; message?: string; ts: number }>();
// per-session cooldown for observer-driven auto-sends; see AUTO_SEND_COOLDOWN_MS.
const lastAutoSendTs = new Map<string, number>();

// drop oldest scripts (by closedTs) when a session's ring exceeds the cap.
function pruneScripts(s: SessionState) {
  if (s.scripts.size <= MAX_SCRIPTS_PER_SESSION) return;
  const entries = Array.from(s.scripts.entries()).sort(
    (a, b) => (a[1].closedTs || 0) - (b[1].closedTs || 0)
  );
  const drop = entries.length - MAX_SCRIPTS_PER_SESSION;
  for (let i = 0; i < drop; i++) s.scripts.delete(entries[i]![0]);
}

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
      scripts: new Map(),
    };
    sessions.set(k, s);
  } else {
    s.info = info;
  }
  return s;
}

// chat-agent sessions live under ~/.cut-the-cake/chat/<sha1(upstream-key, 12)>/
// so their slug ends with that hash. resolve back to the upstream session by
// scanning the live session map for a key whose hash matches — gives us the
// upstream project name to use as a prefix on the chat session's display name.
function chatHashFor(sessionKey: string): string {
  return createHash("sha1").update(sessionKey).digest("hex").slice(0, 12);
}
function chatDisplayNameFor(info: SessionInfo): string | null {
  const m = info.slug.match(/cut-the-cake-chat-([a-f0-9]+)$/);
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
    observerDecisions: s.observerDecisions,
    scripts: Object.fromEntries(s.scripts),
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

// build the seed block for the chat-agent: a one-shot context envelope (session
// name + observer insight if any + last RECENT_CLOSED_TURNS turn excerpts).
// fed once into the chat-agent so the model has real context for its first
// reply, without us doing a session fork. shared by auto-fires and manual sends
// — the chat-agent ignores `seed` on follow-up prompts in the same session.
function buildChatSeed(s: SessionState, decision?: ObserverInsight | null): string {
  const k = keyFor(s.info);
  const lines: string[] = [];
  lines.push(`The user just watched session "${s.info.slug}" finish a turn.`);
  if (decision?.insight) lines.push(`Observer flagged: ${decision.insight}`);
  if (decision?.tags?.length) lines.push(`Tags: ${decision.tags.join(", ")}`);
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

// demo fixture used by /debug/inject-script — the same 9-beat / 2-marker
// script we generated during the e2e test. self-bootstrapping: the first call
// runs generateTts (15-25s), subsequent calls are instant cache hits. text +
// beats are kept aligned by hand — keep them in lockstep if either changes.
const DEMO_BEATS: ScriptBeat[] = [
  { text: "three sources watched: claude projects, claude.app agent, codex sessions", emphasis: ["three"] },
  { text: "per-file FileState tracks offset, partial line, and uuid dedupe", emphasis: ["FileState"] },
  { text: "fs.watch fires in milliseconds; 500ms poll catches anything it missed", emphasis: ["500ms"] },
  { text: "lines hit parseRecord or parseCodexRecord, emerge as unified MetaEvents", emphasis: ["MetaEvents"] },
  { text: "event shapes: user_message, assistant_text, tool_use, tool_result, stop" },
  { text: "turns.ts groups events at user_message boundaries and stop signals", emphasis: ["turns.ts"] },
  { text: "on turn close, observer and scriptifier both receive the same events" },
  { text: "both subprocesses fire concurrently — no shared queue between them", marker: "INSIGHT", emphasis: ["concurrently"] },
  { text: "tailer skips files with mtime beyond 4 hours — they go dormant", marker: "BE_CAREFUL", emphasis: ["4 hours"] },
];
const DEMO_VOICE = "af_heart";

async function injectDemoScript(s: SessionState): Promise<{ turnId: string; audioUrl: string } | null> {
  const turnId = "demo-" + Date.now().toString(36);
  const text = DEMO_BEATS.map((b) => b.text).join(" ");
  const now = Date.now();
  const payload: ScriptPayload = {
    turnId,
    beats: DEMO_BEATS,
    status: "rendering",
    ts: now,
    closedTs: now,
  };
  s.scripts.set(turnId, payload);
  pruneScripts(s);
  const sessionKey = keyFor(s.info);
  if (isVisible(s)) {
    broadcast({ kind: "script:beats", sessionKey, script: payload });
  }
  try {
    const tts = await generateTts({ text, voice: DEMO_VOICE });
    payload.audioUrl = `/tts/${tts.hash}.wav`;
    payload.durationS = tts.durationS;
    payload.words = tts.words;
    payload.status = "ready";
    payload.ts = Date.now();
    if (isVisible(s)) {
      broadcast({ kind: "script:ready", sessionKey, script: payload });
    }
    console.log(
      `[debug] inject-script · ${s.info.slug} · ${DEMO_BEATS.length} beats · audio=${payload.audioUrl}`
    );
    return { turnId, audioUrl: payload.audioUrl! };
  } catch (err) {
    payload.status = "error";
    payload.errorMessage = err instanceof Error ? err.message : String(err);
    payload.ts = Date.now();
    if (isVisible(s)) {
      broadcast({
        kind: "script:error",
        sessionKey,
        turnId,
        message: payload.errorMessage,
      });
    }
    return null;
  }
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
  const seed = buildChatSeed(s, decision);
  console.log(
    `[auto-send] ${s.info.slug} · prefill="${clip(decision.prefill, 80)}"`
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

    // /tts/<hash>.wav — serves cached tts audio from ~/.cut-the-cake/tts-cache/.
    // hash is sha256 (exactly 64 hex), and the .wav extension is required —
    // doubles as a path-traversal guard before we touch the filesystem.
    if (url.pathname.startsWith("/tts/") && req.method === "GET") {
      const tail = url.pathname.slice(5);
      const m = tail.match(/^([a-f0-9]{64})\.wav$/);
      if (!m) {
        return new Response("not found", { status: 404 });
      }
      const file = Bun.file(ttsAudioPath(m[1]!));
      if (await file.exists()) return new Response(file);
      return new Response("not found", { status: 404 });
    }

    // /debug/inject-script — inject a fully-formed demo ScriptPayload onto a
    // visible session so the video-pane UI can be inspected without waiting
    // for a real turn to close. dev affordance, gated behind META_DEBUG=1.
    // body: {sessionKey: string} required. csrf-guarded via Origin check.
    // uses the cached fixture from the e2e test (9 beats, 2 markers,
    // 41.4s wav, 98 word timings) — beats + audio + timings all match.
    if (url.pathname === "/debug/inject-script" && req.method === "POST") {
      if (Bun.env.META_DEBUG !== "1") {
        return Response.json({ error: "META_DEBUG=1 required" }, { status: 403 });
      }
      // csrf guard: a cross-site form post would carry an Origin header set by
      // the browser. block anything that's not localhost. same-origin fetch and
      // direct curl (no Origin) still work.
      const origin = req.headers.get("origin");
      if (origin) {
        try {
          const oh = new URL(origin).hostname;
          if (oh !== "localhost" && oh !== "127.0.0.1" && oh !== "::1") {
            return Response.json({ error: "forbidden origin" }, { status: 403 });
          }
        } catch {
          return Response.json({ error: "forbidden origin" }, { status: 403 });
        }
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const sessionKey = typeof o.sessionKey === "string" ? o.sessionKey : "";
      if (!sessionKey) {
        return Response.json({ error: "sessionKey required" }, { status: 400 });
      }
      const sess = sessions.get(sessionKey);
      if (!sess) {
        return Response.json({ error: "unknown sessionKey" }, { status: 404 });
      }
      const result = await injectDemoScript(sess);
      if (!result) {
        return Response.json({
          error:
            "demo fixture missing — run the e2e test once first or set META_DEBUG=1 then close any turn",
        }, { status: 503 });
      }
      return Response.json({ ok: true, sessionKey, turnId: result.turnId, audioUrl: result.audioUrl });
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
      // pass the same context envelope as auto-sends — the chat-agent uses it
      // on the first prompt of the subprocess, ignores it on follow-ups. include
      // the latest open observer insight (if any) so the model knows what was flagged.
      const latestOpen = [...sess.observerDecisions].reverse().find(d => d.open) ?? null;
      const seed = buildChatSeed(sess, latestOpen);
      chatHost.send(sessionKey, text, { seed });
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

    // POST /debug/script-style — set the global scriptifier prompt preset.
    // affects FUTURE closed turns only; existing scripts are not re-rendered.
    // body: { style: "default" | "cinematic" | "tldr" | "deep-dive" }
    if (url.pathname === "/debug/script-style" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const style = o.style;
      if (typeof style !== "string" || !SCRIPT_STYLES.includes(style as ScriptStyle)) {
        return Response.json(
          { error: `style must be one of ${SCRIPT_STYLES.join(", ")}` },
          { status: 400 }
        );
      }
      activeScriptStyle = style as ScriptStyle;
      console.log(`[scriptifier] runtime style → ${activeScriptStyle}`);
      broadcast({ kind: "scriptstyle:setting", style: activeScriptStyle });
      return Response.json({ ok: true, style: activeScriptStyle });
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
          scriptStyle: activeScriptStyle,
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
    })
  : null;
if (observer) {
  console.log(
    `[observer] enabled · decisions=${OBSERVER_MODEL} · batch=${OBSERVER_BATCH_MS}ms`
  );
}

// scriptifier: parallel sonnet subprocess that converts each closed turn into
// a karaoke-style script. tts is kicked off in the background as soon as the
// beats land — clients see beats first (status: rendering), then audio +
// timings once tts finishes (status: ready).
const scriptifier = SCRIPTIFIER_ENABLED
  ? startScriptifier({
      model: SCRIPTIFIER_MODEL,
      batchMs: SCRIPTIFIER_BATCH_MS,
      async onScript(r) {
        const s = sessions.get(r.sessionKey);
        if (!s) return;
        const payload: ScriptPayload = {
          turnId: r.turnId,
          beats: r.beats,
          status: "rendering",
          ts: Date.now(),
          closedTs: r.closedTs,
        };
        s.scripts.set(r.turnId, payload);
        pruneScripts(s);
        if (isVisible(s)) {
          broadcast({
            kind: "script:beats",
            sessionKey: r.sessionKey,
            script: payload,
          });
        }
        // background tts: full script → wav + per-word timings. errors don't
        // crash the loop — we surface them on the payload and broadcast.
        const fullText = r.beats.map((b) => b.text).join(" ");
        try {
          const tts = await generateTts({ text: fullText, voice: TTS_VOICE });
          payload.audioUrl = `/tts/${tts.hash}.wav`;
          payload.durationS = tts.durationS;
          payload.words = tts.words;
          payload.status = "ready";
          payload.ts = Date.now();
          if (isVisible(s)) {
            broadcast({
              kind: "script:ready",
              sessionKey: r.sessionKey,
              script: payload,
            });
          }
        } catch (err) {
          payload.status = "error";
          payload.errorMessage = err instanceof Error ? err.message : String(err);
          payload.ts = Date.now();
          console.error(`[scriptifier] tts failed for ${r.turnId.slice(0, 8)}: ${payload.errorMessage}`);
          if (isVisible(s)) {
            broadcast({
              kind: "script:error",
              sessionKey: r.sessionKey,
              turnId: r.turnId,
              message: payload.errorMessage,
            });
          }
        }
      },
    })
  : null;
if (scriptifier) {
  console.log(
    `[scriptifier] enabled · model=${SCRIPTIFIER_MODEL} · batch=${SCRIPTIFIER_BATCH_MS}ms · voice=${TTS_VOICE} · style=${activeScriptStyle}`
  );
}
// graceful shutdown — give abort signals a moment to terminate sdk subprocesses
// before the server process exits, otherwise claude subprocesses can be orphaned.
{
  const onSignal = (sig: string) => {
    console.log(`[server] received ${sig} — stopping observer + scriptifier + chat host + registry`);
    observer?.stop();
    scriptifier?.stop();
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
    // our own sdk subprocesses (observer decisions: ~/.chunk-to-chat/observer/,
    // chat hosts: ~/.cut-the-cake/chat/<hash>/) are themselves cc subprocesses
    // whose jsonls get tailed. surface them as session cards so the user can
    // see they're alive, but never feed their own turns back (would be an
    // infinite mirror).
    const isObserverSelf =
      info.slug.includes("chunk-to-chat-observer") ||
      info.slug.includes("cut-the-cake-chat") ||
      info.slug.includes("cut-the-cake-scriptifier");
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
      const fresh = Date.now() - result.closed.endTs <= OBSERVER_FRESH_MS;
      if (observer && !isObserverSelf && isVisible(s) && fresh) {
        observer.feed(buildTurnFeed(keyFor(s.info), s.info, result.closed));
      }
      if (scriptifier && !isObserverSelf && isVisible(s) && fresh) {
        scriptifier.feed(buildTurnFeed(keyFor(s.info), s.info, result.closed), activeScriptStyle);
      }
    }
  },
});
