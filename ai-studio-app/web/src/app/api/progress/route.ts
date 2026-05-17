import { NextRequest } from "next/server";
import { getAuthContext, errorResponse } from "@/lib/api-utils";
import { progressBus, BACKPRESSURE_LIMIT } from "@ais-app/agent-runtime/src/progress-bus";
import { textDeltaBus } from "@ais-app/agent-runtime/src/text-delta-bus";
import type { ProgressSpan } from "@ais-app/agent-runtime/src/progress-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEEPALIVE_INTERVAL_MS = 15_000;
const CF_FLUSH_PADDING = ": " + "x".repeat(4096) + "\n\n";

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return errorResponse("Authentication required", "UNAUTHENTICATED", 401);
  }

  const traceId = request.nextUrl.searchParams.get("traceId");
  if (!traceId) {
    return errorResponse("traceId parameter is required", "VALIDATION_ERROR", 400);
  }

  const lastEventId = request.headers.get("Last-Event-ID");
  const afterSeq = lastEventId ? parseInt(lastEventId, 10) : undefined;

  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeDelta: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let buffered = 0;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function write(data: string): boolean {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(data));
          return true;
        } catch {
          cleanup();
          return false;
        }
      }

      function cleanup() {
        if (closed) return;
        closed = true;
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (unsubscribeDelta) { unsubscribeDelta(); unsubscribeDelta = null; }
        if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
        try { controller.close(); } catch { /* already closed */ }
      }

      write(CF_FLUSH_PADDING);

      let maxReplayedSeq = afterSeq ?? 0;
      const earlyBuffer: ProgressSpan[] = [];
      let live = false;

      const onSpan = (span: ProgressSpan) => {
        if (closed) return;
        if (span.tenantId !== auth.tenantId) return;

        if (!live) {
          earlyBuffer.push(span);
          return;
        }

        buffered++;
        if (buffered > BACKPRESSURE_LIMIT) {
          cleanup();
          return;
        }

        const ok = write(`id: ${span.seq}\nevent: span\ndata: ${JSON.stringify(span)}\n\n`);
        if (ok) buffered = 0;
      };

      unsubscribe = progressBus.subscribe(traceId, auth.tenantId, onSpan);

      unsubscribeDelta = textDeltaBus.subscribe(traceId, auth.tenantId, (delta: string) => {
        if (closed) return;
        write(`event: text_delta\ndata: ${JSON.stringify({ delta })}\n\n`);
      });

      const history = progressBus.getHistory(traceId, afterSeq);
      if (history.length > 0) {
        write(`event: replay.start\ndata: ${JSON.stringify({ count: history.length })}\n\n`);
        for (const span of history) {
          write(`id: ${span.seq}\nevent: span\ndata: ${JSON.stringify(span)}\n\n`);
          if (span.seq > maxReplayedSeq) maxReplayedSeq = span.seq;
        }
        write(`event: replay.end\ndata: {}\n\n`);
      }

      live = true;
      for (const span of earlyBuffer) {
        if (span.seq <= maxReplayedSeq) continue;
        write(`id: ${span.seq}\nevent: span\ndata: ${JSON.stringify(span)}\n\n`);
      }
      earlyBuffer.length = 0;

      keepaliveTimer = setInterval(() => {
        if (!write(": keepalive\n\n")) {
          cleanup();
        }
      }, KEEPALIVE_INTERVAL_MS);

      write(`retry: 3000\n\n`);

      request.signal.addEventListener("abort", cleanup);
    },

    cancel() {
      closed = true;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (unsubscribeDelta) { unsubscribeDelta(); unsubscribeDelta = null; }
      if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
