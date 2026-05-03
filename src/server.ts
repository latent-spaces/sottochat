const PORT = Number(Bun.env.PORT ?? 3737);

type MetaEvent = {
  type: "post_tool_use" | "stop" | "user_prompt_submit";
  ts: number;
  payload: unknown;
};

const events: MetaEvent[] = [];
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

    if (url.pathname === "/event" && req.method === "POST") {
      const payload = await req.json();
      const ev: MetaEvent = { type: payload.type, ts: Date.now(), payload };
      events.push(ev);
      broadcast({ kind: "event", event: ev });
      return Response.json({ ok: true });
    }

    if (url.pathname === "/state" && req.method === "GET") {
      return Response.json({ events });
    }

    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ kind: "hello", events }));
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
