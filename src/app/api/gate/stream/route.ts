import { db } from "@/lib/db";
import { requireOperator } from "@/lib/gate/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gate/stream — the command bridge's LIVE channel (SSE).
 *
 * Replaces blind 5s polling with push: the client opens ONE connection and
 * receives only what is new (message deltas + heartbeat comments). Rails:
 * server closes after ~55s and the browser's EventSource reconnects by
 * itself; on ANY error the client falls back to its old poller. Auth: the
 * same operator session as every other gate endpoint.
 */
export async function GET(req: Request) {
  try {
    await requireOperator();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const started = Date.now();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(iv);
        clearInterval(hb);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      let cursor = new URL(req.url).searchParams.get("cursor") || "";
      // baseline: the client already rendered via REST — start streaming AFTER the newest row
      void (async () => {
        try {
          if (!cursor) {
            const last = await db.gateMessage.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
            cursor = last?.id ?? "";
          }
          send("hello", { cursor, at: new Date().toISOString() });
        } catch {
          send("hello", { cursor: "", at: new Date().toISOString() });
        }
      })();

      const iv = setInterval(() => {
        void (async () => {
          if (closed) return;
          try {
            const since = cursor
              ? await db.gateMessage.findFirst({ where: { id: cursor }, select: { createdAt: true } })
              : null;
            const msgs = since
              ? await db.gateMessage.findMany({
                  where: { createdAt: { gt: since.createdAt } },
                  orderBy: { createdAt: "asc" },
                  take: 30,
                })
              : [];
            if (msgs.length) {
              cursor = msgs[msgs.length - 1].id;
              send("messages", msgs);
            }
            if (Date.now() - started > 55_000) {
              send("bye", { at: new Date().toISOString() }); // EventSource reconnects by itself
              cleanup();
            }
          } catch {
            /* one failed probe must not kill the stream — next tick retries */
          }
        })();
      }, 3_000);
      const hb = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": hb\n\n"));
          } catch {
            cleanup();
          }
        }
      }, 15_000);
      req.signal.addEventListener("abort", cleanup);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
