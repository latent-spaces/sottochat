import { startTailer, type SessionInfo } from "./tailer";
import type { MetaEvent } from "./jsonl";

const PORT = Number(Bun.env.META_PORT ?? Bun.env.PORT ?? 3737);
const POLL_MS = Number(Bun.env.META_POLL_MS ?? 500);
const PROJECT_SLUG = Bun.env.META_PROJECT_SLUG;
const MAX_EVENTS = 5000;

const events: MetaEvent[] = [];
let session: SessionInfo | null = null;
const sockets = new Set<Bun.ServerWebSocket<unknown>>();

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of sockets) ws.send(data);
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

    if (url.pathname === "/state" && req.method === "GET") {
      return Response.json({ session, events });
    }

    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ kind: "hello", session, events }));
    },
    message() {
      // no client → server messages yet
    },
    close(ws) {
      sockets.delete(ws);
    },
  },
});

console.log(`meta · listening on http://localhost:${server.port}`);

startTailer({
  ...(PROJECT_SLUG ? { projectSlug: PROJECT_SLUG } : {}),
  pollMs: POLL_MS,
  onSession(info) {
    session = info;
    broadcast({ kind: "session", session: info });
    console.log(`[tailer] tailing ${info.path}`);
  },
  onEvent(ev) {
    events.push(ev);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    broadcast({ kind: "event", event: ev });
  },
});
