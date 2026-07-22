import { createHash } from "node:crypto";
import { logInfo } from "./log";
import { startTailer, type SessionInfo } from "./tailer";
import type { MetaEvent } from "./jsonl";
import { createTurnsState, ingestEvent, type Turn, type TurnsState } from "./turns";
import { evaluateTurn, MAGNITUDE_THRESHOLDS, type Trigger } from "./triggers";
import { buildTurnFeed, startObserver, type TurnFeed } from "./observer";
import { startChatHost, type ChatChunk } from "./chat-agent";
import { startRegistry, type RegistrySnapshot } from "./registry";
import { staticAsset } from "./static-assets";
import {
  buildSettingsCatalog,
  readNextSetting,
  readStartupSetting,
  saveSettingsPatch,
  SettingsValidationError,
} from "./settings";
import {
  loadPersistedSessions,
  startPersister,
  type ChatArchive,
  type PersistedSession,
} from "./persistence";
import { claudeAuthState, type ClaudeAuthState } from "./auth-check";
import { startUsageLedger, type UsageSnapshot, type UsageSource, type TokenUsage } from "./usage-ledger";

const PORT = readStartupSetting("META_PORT", 3737, Bun.env, ["PORT"]);
const POLL_MS = readStartupSetting("META_POLL_MS", 500);
const PROJECT_SLUG = readStartupSetting("META_PROJECT_SLUG", "") || undefined;
const RECENT_MS = readStartupSetting("META_INBOX_MINUTES", 240) * 60 * 1000;
const MAX_EVENTS_PER_SESSION = 5000;
// observer is on by default; set META_OBSERVER_ENABLED=0 to opt out
// (e.g. when iterating in `bun run dev` to avoid orphaning the sdk subprocess
// on every hot reload — see state.md issue #4).
const OBSERVER_ENABLED = readStartupSetting("META_OBSERVER_ENABLED", true);
// META_OBSERVER_MODEL: per-turn decisions subprocess (sonnet by default — needs judgment).
const OBSERVER_MODEL = readStartupSetting("META_OBSERVER_MODEL", "claude-sonnet-5");
const CHAT_MODEL = readStartupSetting("META_CHAT_MODEL", "claude-sonnet-5");
const OBSERVER_BATCH_MS = readStartupSetting("META_OBSERVER_BATCH_MS", 30_000);
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
  pt: "Portuguese",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  id: "Indonesian",
  vi: "Vietnamese",
  bn: "Bengali",
};
function isKnownLang(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, code);
}
const startupExplainLang = readStartupSetting("META_EXPLAIN_LANG", "zh");
let explainLang: string = isKnownLang(startupExplainLang) ? startupExplainLang : "zh";
function explainLanguageName(): string {
  return isKnownLang(explainLang) ? LANGUAGE_NAMES[explainLang]! : "Chinese";
}
// abtop-style PID-driven discovery (src/registry.ts) drives inbox visibility:
// a claude-code/codex session shows only while its process is alive, or for a
// grace window after its last event (so a just-finished run stays discussable).
// claude-app sessions aren't process-discoverable and keep the plain time
// window. set META_USE_PROCESS_DISCOVERY=0 to revert to the mtime-only view.
const USE_PROCESS_DISCOVERY = readStartupSetting("META_USE_PROCESS_DISCOVERY", true);
const DISCOVERY_GRACE_MS = readStartupSetting("META_DISCOVERY_GRACE_MINUTES", 30) * 60 * 1000;
// only feed the observer turns whose close ts is within the last
// OBSERVER_FRESH_MS — backfill of historical turns at startup is skipped.
const OBSERVER_FRESH_MS = readStartupSetting("META_OBSERVER_FRESH_MS", 5 * 60 * 1000);

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
  summaryLang?: string;        // explain-language code the summary was generated in — lets the
                               // card show a "stale/updating" tag while a newer language re-feed is in flight
  closedTurnCount: number;     // total closed turns — the summary regenerates every 4th
  recentClosedTurns: Turn[];   // ring buffer (RECENT_CLOSED_TURNS) — feeds the summary + chat seed
  chatContextTurns: number;    // how many recent turns the chat seed includes (user-tunable, 1..10)
  customName?: string;         // user-set override for the card/detail-header name
};

const sessions = new Map<string, SessionState>();
const sockets = new Set<Bun.ServerWebSocket<unknown>>();
const usageLedger = startUsageLedger();
// chat threads live alongside SessionState but are keyed off the same sessionKey.
// kept separate so observed-data state stays focused on tailer-sourced facts.
const chatThreads = new Map<string, ChatChunk[]>();
const chatStatuses = new Map<string, { status: string; message?: string; ts: number }>();
// Browser tabs can observe the same completed turn. Keep automatic quick
// actions idempotent across tabs without persisting browser preferences here.
const autoChatKeys = new Set<string>();
const MAX_AUTO_CHAT_KEYS = 2_000;
// past discussions, newest last. every clear (manual reset or the auto-clear
// on a fresh turn) archives the live thread here instead of discarding it;
// the UI lists them behind a per-session "history (N)" control and can
// restore one as the live thread again.
const chatArchives = new Map<string, ChatArchive[]>();
const MAX_CHAT_ARCHIVES = 10;

function archiveChatThread(sessionKey: string): boolean {
  const thread = chatThreads.get(sessionKey);
  if (!thread || thread.length === 0) return false;
  let arr = chatArchives.get(sessionKey);
  if (!arr) {
    arr = [];
    chatArchives.set(sessionKey, arr);
  }
  arr.push({ archivedTs: Date.now(), chunks: thread });
  if (arr.length > MAX_CHAT_ARCHIVES) arr.splice(0, arr.length - MAX_CHAT_ARCHIVES);
  return true;
}

// disk-backed state (~/.sottochat/state.json): chat threads, summaries, and
// token counters survive restarts. loaded once at boot; live sessions overlay
// their entries on save. entries idle for over a week are pruned on save.
const PERSIST_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const persistedSessions = loadPersistedSessions();
for (const [k, p] of persistedSessions) {
  if (p.chatThread?.length) chatThreads.set(k, p.chatThread.slice());
  if (p.chatArchives?.length) chatArchives.set(k, p.chatArchives.slice());
}
function collectPersisted(): Map<string, PersistedSession> {
  const out = new Map(persistedSessions);
  for (const [k, s] of sessions) {
    const p: PersistedSession = {
      lastEventTs: s.lastEventTs,
      chatContextTurns: s.chatContextTurns,
      closedTurnCount: s.closedTurnCount,
      ...(s.summary ? { summary: s.summary } : {}),
      ...(s.summaryTs ? { summaryTs: s.summaryTs } : {}),
      ...(s.summaryLang ? { summaryLang: s.summaryLang } : {}),
      ...(s.customName ? { customName: s.customName } : {}),
    };
    const chat = chatThreads.get(k);
    if (chat && chat.length) p.chatThread = chat;
    const archives = chatArchives.get(k);
    if (archives && archives.length) p.chatArchives = archives;
    out.set(k, p);
  }
  const cutoff = Date.now() - PERSIST_MAX_IDLE_MS;
  for (const [k, p] of out) {
    if ((p.lastEventTs ?? 0) < cutoff) out.delete(k);
  }
  return out;
}
const persister = startPersister(collectPersisted);

function pushChatChunk(c: ChatChunk) {
  let arr = chatThreads.get(c.sessionKey);
  if (!arr) {
    arr = [];
    chatThreads.set(c.sessionKey, arr);
  }
  arr.push(c);
  if (arr.length > MAX_CHAT_CHUNKS) arr.splice(0, arr.length - MAX_CHAT_CHUNKS);
  persister.schedule();
}

// reset a session's Q&A to pristine (as if the session was untouched): stop the
// chat subprocess so the assistant forgets, wipe the stored thread + status, and
// tell clients. used by the manual clear route and by the auto-clear that fires
// when a session advances to a new turn.
function clearChat(sessionKey: string): void {
  chatHost.stop(sessionKey);
  const archived = archiveChatThread(sessionKey);
  chatThreads.delete(sessionKey);
  chatStatuses.delete(sessionKey);
  // sync the persisted copy too — for a session not currently tailed, the
  // collect overlay wouldn't rebuild the entry.
  const p = persistedSessions.get(sessionKey);
  if (p) {
    delete p.chatThread;
    const arr = chatArchives.get(sessionKey);
    if (arr?.length) p.chatArchives = arr;
  }
  persister.schedule();
  broadcast({ kind: "chat:cleared", sessionKey });
  if (archived) {
    broadcast({ kind: "chat:archived", sessionKey, archives: chatArchives.get(sessionKey) ?? [] });
  }
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
    // restore what a previous server run knew about this session. events/turns
    // are re-derived from the jsonl on disk; only derived-by-model or
    // user-tuned state needs the disk copy.
    const p = persistedSessions.get(k);
    if (p) {
      if (typeof p.chatContextTurns === "number") s.chatContextTurns = p.chatContextTurns;
      if (typeof p.closedTurnCount === "number") s.closedTurnCount = p.closedTurnCount;
      if (typeof p.summary === "string") s.summary = p.summary;
      if (typeof p.summaryTs === "number") s.summaryTs = p.summaryTs;
      if (typeof p.summaryLang === "string") s.summaryLang = p.summaryLang;
      if (typeof p.customName === "string") s.customName = p.customName;
    }
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

// the hello/upsert snapshot used to ship the whole event buffer (up to 5000
// events, full assistant texts — megabytes per connect). the frontend only
// derives the last CHART_TURNS(5) turns + the latest exchange from it, so send
// just the events of the last few turns. live "event" messages keep appending
// client-side after hydration.
const SNAPSHOT_TURNS = 8;
function snapshotEvents(s: SessionState): MetaEvent[] {
  const turns = s.turns.turns.slice(-SNAPSHOT_TURNS);
  if (turns.length === 0) return s.events.slice(-200);
  const out: MetaEvent[] = [];
  for (const t of turns) out.push(...t.events);
  return out;
}

function snapshot(s: SessionState) {
  const k = keyFor(s.info);
  const chat = chatThreads.get(k);
  const status = chatStatuses.get(k);
  const displayName = chatDisplayNameFor(s.info);
  return {
    key: k,
    info: s.info,
    events: snapshotEvents(s),
    threads: s.threads,
    lastEventTs: s.lastEventTs,
    model: s.model,
    contextTokens: s.contextTokens,
    totalOutputTokens: s.totalOutputTokens,
    chatContextTurns: s.chatContextTurns,
    ...(s.summary ? { summary: s.summary } : {}),
    ...(s.summaryTs ? { summaryTs: s.summaryTs } : {}),
    ...(s.summaryLang ? { summaryLang: s.summaryLang } : {}),
    ...(s.customName ? { customName: s.customName } : {}),
    ...(displayName ? { displayName } : {}),
    ...(chat && chat.length ? { chatThread: chat } : {}),
    ...(status ? { chatStatus: status } : {}),
    ...((chatArchives.get(k)?.length ?? 0) > 0 ? { chatArchives: chatArchives.get(k) } : {}),
  };
}

function isInWindow(s: SessionState): boolean {
  return s.lastEventTs > 0 && Date.now() - s.lastEventTs <= RECENT_MS;
}

// sessionIds the registry saw attached to a live PID on its latest tick.
// null until the first tick lands (fail open — show everything).
let liveSids: Set<string> | null = null;

function isDiscoveryAlive(s: SessionState): boolean {
  if (!USE_PROCESS_DISCOVERY || !liveSids) return true;
  const src = s.info.source;
  // the registry only discovers claude-code + codex processes; claude-app
  // local-agent-mode has no discoverable PID, so it keeps the time window.
  if (src !== "claude-code" && src !== "codex") return true;
  if (liveSids.has(s.info.sessionId)) return true;
  // dead PID — keep the session discussable for a grace window after its
  // last event, then let it drop out of the inbox.
  return Date.now() - s.lastEventTs <= DISCOVERY_GRACE_MS;
}

// which session keys clients currently see. registry ticks + incoming events
// both reconcile against this so visibility flips fan out exactly once.
const visibleKeys = new Set<string>();
function syncVisibility(): void {
  for (const [k, s] of sessions) {
    const vis = isVisible(s);
    const was = visibleKeys.has(k);
    if (vis && !was) {
      visibleKeys.add(k);
      broadcast({ kind: "session:upsert", session: snapshot(s) });
    } else if (!vis && was) {
      visibleKeys.delete(k);
      broadcast({ kind: "session:remove", sessionKey: k });
    }
  }
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
  return isInWindow(s) && !isEphemeralHelper(s.info) && isDiscoveryAlive(s);
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

function recordSottochatUsage(source: UsageSource, usage: TokenUsage): UsageSnapshot {
  const snapshot = usageLedger.record(source, usage);
  broadcast({ kind: "usage:state", usage: snapshot });
  return snapshot;
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

function currentSettingsCatalog() {
  return buildSettingsCatalog({
    port: PORT,
    pollMs: POLL_MS,
    projectSlug: PROJECT_SLUG ?? "",
    inboxMinutes: RECENT_MS / 60_000,
    processDiscovery: USE_PROCESS_DISCOVERY,
    discoveryGraceMinutes: DISCOVERY_GRACE_MS / 60_000,
    observerEnabled: OBSERVER_ENABLED,
    observerModel: OBSERVER_MODEL,
    chatModel: CHAT_MODEL,
    observerBatchMs: OBSERVER_BATCH_MS,
    observerFreshMs: OBSERVER_FRESH_MS,
    explainLanguage: explainLang,
    magnitudeTokens: MAGNITUDE_THRESHOLDS.tokens,
    magnitudeToolCalls: MAGNITUDE_THRESHOLDS.toolCalls,
    magnitudeChars: MAGNITUDE_THRESHOLDS.characters,
  }, LANGUAGE_NAMES);
}

let observer: ReturnType<typeof startObserver> | null = null;

function applyExplainLanguage(lang: string): void {
  if (explainLang === lang) return;
  explainLang = lang;
  logInfo(`[settings] explain language → ${lang} (${LANGUAGE_NAMES[lang]})`);
  broadcast({ kind: "settings:language", language: explainLang });
  if (!observer) return;
  let refed = 0;
  for (const s of sessions.values()) {
    if (!isVisible(s) || !s.summary || s.recentClosedTurns.length === 0) continue;
    observer.feed(buildSummaryFeed(s));
    refed++;
  }
  if (refed > 0) {
    logInfo(`[settings] re-queued ${refed} card summaries in ${LANGUAGE_NAMES[lang]}`);
  }
}

type PublicClaudeAuthState = {
  status: "ready" | "missing" | "failed";
  method: ClaudeAuthState["method"];
};

// The browser receives only capability metadata. Credentials remain in Claude
// Code, the process environment, or the selected cloud provider.
let detectedClaudeAuth: ClaudeAuthState = { configured: false, method: "none" };
let claudeAuthFailed = false;

function publicClaudeAuthState(): PublicClaudeAuthState {
  return {
    status: claudeAuthFailed ? "failed" : detectedClaudeAuth.configured ? "ready" : "missing",
    method: detectedClaudeAuth.method,
  };
}

function broadcastClaudeAuthState(): void {
  broadcast({ kind: "auth:state", auth: publicClaudeAuthState() });
}

async function refreshClaudeAuthState(): Promise<PublicClaudeAuthState> {
  detectedClaudeAuth = await claudeAuthState();
  claudeAuthFailed = false;
  if (detectedClaudeAuth.configured) observer?.retry();
  broadcastClaudeAuthState();
  return publicClaudeAuthState();
}

function markClaudeAuthFailed(): void {
  if (claudeAuthFailed) return;
  claudeAuthFailed = true;
  broadcastClaudeAuthState();
}

function markClaudeAuthWorking(): void {
  if (!claudeAuthFailed && detectedClaudeAuth.configured) return;
  void refreshClaudeAuthState();
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    }

    if (req.method === "GET") {
      const asset = staticAsset(url.pathname);
      if (asset) return new Response(asset);
    }

    if (url.pathname === "/state" && req.method === "GET") {
      return Response.json({ sessions: recentSessions(), auth: publicClaudeAuthState() });
    }

    if (url.pathname === "/api/auth/status" && req.method === "GET") {
      return Response.json({ auth: await refreshClaudeAuthState() });
    }

    if (url.pathname === "/api/usage" && req.method === "GET") {
      return Response.json({ usage: usageLedger.snapshot() });
    }

    if (url.pathname === "/api/settings" && req.method === "GET") {
      return Response.json(currentSettingsCatalog());
    }

    if (url.pathname === "/api/settings" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      if (!o.values || typeof o.values !== "object" || Array.isArray(o.values)) {
        return Response.json({ error: "values object required" }, { status: 400 });
      }
      const values = o.values as Record<string, unknown>;
      try {
        saveSettingsPatch(values, LANGUAGE_NAMES);
        if (Object.prototype.hasOwnProperty.call(values, "META_EXPLAIN_LANG")) {
          const requested = values.META_EXPLAIN_LANG;
          const lang = requested === null
            ? readNextSetting("META_EXPLAIN_LANG", "zh")
            : String(requested);
          if (isKnownLang(lang)) applyExplainLanguage(lang);
        }
      } catch (error) {
        if (error instanceof SettingsValidationError) {
          return Response.json({ error: error.message, key: error.key }, { status: 400 });
        }
        console.error("[settings] save failed:", error);
        return Response.json({ error: "settings could not be saved" }, { status: 500 });
      }
      return Response.json({ ok: true, settings: currentSettingsCatalog() });
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
          visible: isVisible(sess),
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
      const kind = o.kind === "auto" ? "auto" : "user";
      const sourceTurnId = typeof o.sourceTurnId === "string" ? o.sourceTurnId : null;
      if (!sessionKey || !text || !text.trim()) {
        return Response.json({ error: "sessionKey and text required" }, { status: 400 });
      }
      if (kind === "auto" && !sourceTurnId) {
        return Response.json({ error: "sourceTurnId required for automatic sends" }, { status: 400 });
      }
      const sess = sessions.get(sessionKey);
      if (!sess) {
        return Response.json({ error: "unknown sessionKey" }, { status: 404 });
      }
      const autoKey = kind === "auto" ? `${sessionKey}\u0000${sourceTurnId}` : null;
      if (autoKey && autoChatKeys.has(autoKey)) {
        return Response.json({ ok: true, deduped: true });
      }
      // the chat-agent uses this seed on the first prompt of the subprocess and
      // ignores it on follow-ups — it carries the working dir, the session
      // summary so far, and the recent turns (latest one in full).
      const seed = buildChatSeed(sess);
      if (autoKey) {
        if (autoChatKeys.size >= MAX_AUTO_CHAT_KEYS) {
          const oldest = autoChatKeys.values().next().value;
          if (oldest) autoChatKeys.delete(oldest);
        }
        autoChatKeys.add(autoKey);
      }
      chatHost.send(sessionKey, text, {
        seed,
        language: explainLanguageName(),
        userKind: kind,
      });
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

    if (url.pathname === "/chat/restore" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      const sessionKey = typeof o.sessionKey === "string" ? o.sessionKey : null;
      const archivedTs = typeof o.archivedTs === "number" ? o.archivedTs : null;
      if (!sessionKey || archivedTs === null) {
        return Response.json({ error: "sessionKey and archivedTs required" }, { status: 400 });
      }
      const arr = chatArchives.get(sessionKey);
      const idx = arr ? arr.findIndex((a) => a.archivedTs === archivedTs) : -1;
      if (!arr || idx === -1) {
        return Response.json({ error: "unknown archive" }, { status: 404 });
      }
      // the restored transcript becomes the live thread. the subprocess that
      // produced it is long gone — the next send spawns fresh and re-seeds from
      // the current turns, so the assistant won't remember the old exchange.
      chatHost.stop(sessionKey);
      const [entry] = arr.splice(idx, 1);
      // if a different discussion is currently live, archive it rather than
      // overwrite it.
      archiveChatThread(sessionKey);
      chatThreads.set(sessionKey, entry!.chunks.slice());
      chatStatuses.delete(sessionKey);
      const p = persistedSessions.get(sessionKey);
      if (p) {
        p.chatThread = chatThreads.get(sessionKey);
        p.chatArchives = arr.length ? arr : undefined;
        if (!arr.length) delete p.chatArchives;
      }
      persister.schedule();
      broadcast({
        kind: "chat:restored",
        sessionKey,
        thread: chatThreads.get(sessionKey),
        archives: arr,
      });
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
        persister.schedule();
        broadcast({ kind: "chat:context-turns", sessionKey, turns });
      }
      return Response.json({ ok: true, turns });
    }

    if (url.pathname === "/session/rename" && req.method === "POST") {
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
      if (typeof o.name !== "string") {
        return Response.json({ error: "name must be a string" }, { status: 400 });
      }
      const name = o.name.trim();
      const prev = sess.customName ?? null;
      if (name) sess.customName = name;
      else delete sess.customName;
      const next = sess.customName ?? null;
      if (prev !== next) {
        persister.schedule();
        broadcast({ kind: "session:rename", sessionKey, customName: next });
      }
      return Response.json({ ok: true, customName: next });
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
      try {
        saveSettingsPatch({ META_EXPLAIN_LANG: lang }, LANGUAGE_NAMES);
      } catch (error) {
        console.error("[settings] language save failed:", error);
        return Response.json({ error: "language could not be saved" }, { status: 500 });
      }
      applyExplainLanguage(lang);
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
          auth: publicClaudeAuthState(),
          usage: usageLedger.snapshot(),
          ...(publicClaudeAuthState().status !== "ready" ? { needsClaudeAuth: true } : {}),
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

const { formatStartupMessage, terminalSupportsColor } = await import("./startup-message");
detectedClaudeAuth = await claudeAuthState();
console.log(
  formatStartupMessage(`http://localhost:${server.port}/`, {
    color: terminalSupportsColor(),
    authHint: publicClaudeAuthState().status !== "ready",
  })
);

// the chat host — a per-session claude subprocess the user talks to (see chat-agent.ts).
const chatHost = startChatHost({
  model: CHAT_MODEL,
  onUsage(usage) {
    recordSottochatUsage("chat", usage);
  },
  onChunk(c) {
    pushChatChunk(c);
    broadcast({ kind: "chat:chunk", sessionKey: c.sessionKey, chunk: c });
  },
  onStatus(u) {
    const s = {
      status: u.status,
      ts: Date.now(),
      ...(u.message ? { message: u.message } : {}),
      ...(u.reason ? { reason: u.reason } : {}),
    };
    chatStatuses.set(u.sessionKey, s);
    if (u.reason === "auth") markClaudeAuthFailed();
    else if (u.status === "idle") markClaudeAuthWorking();
    broadcast({ kind: "chat:status", sessionKey: u.sessionKey, ...s });
  },
});
logInfo(`[chat] enabled · model=${CHAT_MODEL}`);

observer = OBSERVER_ENABLED
  ? startObserver({
      summaryModel: OBSERVER_MODEL,
      batchMs: OBSERVER_BATCH_MS,
      getLanguage: () => explainLanguageName(),
      onUsage(usage) {
        recordSottochatUsage("observer", usage);
      },
      onAuthError() {
        markClaudeAuthFailed();
      },
      onSummary(d) {
        markClaudeAuthWorking();
        const s = sessions.get(d.sessionKey);
        if (!s || !d.summary) return;
        if (s.summary === d.summary) return; // no change → no repaint/pulse
        s.summary = d.summary;
        s.summaryTs = Date.now();
        s.summaryLang = explainLang;
        persister.schedule();
        if (isVisible(s)) {
          broadcast({
            kind: "session:summary",
            sessionKey: d.sessionKey,
            summary: s.summary,
            summaryTs: s.summaryTs,
            summaryLang: s.summaryLang,
          });
        }
      },
    })
  : null;
if (observer) {
  logInfo(
    `[observer] enabled · summarizer=${OBSERVER_MODEL} · batch=${OBSERVER_BATCH_MS}ms`
  );
}

// graceful shutdown — give abort signals a moment to terminate sdk subprocesses
// before the server process exits, otherwise claude subprocesses can be orphaned.
{
  const onSignal = async (sig: string) => {
    logInfo(`[server] received ${sig} — stopping observer + chat host + registry`);
    persister.flush();
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
  onSnapshot: (snap: RegistrySnapshot) => {
    if (!USE_PROCESS_DISCOVERY) return;
    const next = new Set<string>();
    for (const rs of snap.sessions) next.add(rs.sessionId);
    liveSids = next;
    // a PID died or (re)appeared, or a grace window expired — reconcile what
    // clients see. no-ops when nothing changed.
    syncVisibility();
  },
});
logInfo(
  `[registry] enabled · use-as-driver=${USE_PROCESS_DISCOVERY} · grace=${Math.round(DISCOVERY_GRACE_MS / 60000)}m · diag at /diag/discovery`,
);

startTailer({
  ...(PROJECT_SLUG ? { projectSlug: PROJECT_SLUG } : {}),
  pollMs: POLL_MS,
  recentMs: RECENT_MS,
  onSession(info) {
    logInfo(`[tailer] new session ${info.source}/${info.sessionId.slice(0, 8)} (${info.slug})`);
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
    const key = keyFor(s.info);
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

    if (nowVisible && !visibleKeys.has(key)) {
      // first time this session crosses into visibility — send full snapshot
      visibleKeys.add(key);
      broadcast({ kind: "session:upsert", session: snapshot(s) });
    } else if (nowVisible) {
      broadcast({ kind: "event", sessionKey: key, event: ev });
    } else if (visibleKeys.has(key)) {
      visibleKeys.delete(key);
      broadcast({ kind: "session:remove", sessionKey: key });
    }

    const result = ingestEvent(s.turns, ev);
    // turns.ts keeps every turn forever; only the recent tail is ever read
    // (snapshotEvents, recentClosedTurns). cap it so long sessions don't leak.
    if (s.turns.turns.length > 50) {
      s.turns.turns.splice(0, s.turns.turns.length - 50);
    }
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
      persister.schedule();
    }
  },
});
