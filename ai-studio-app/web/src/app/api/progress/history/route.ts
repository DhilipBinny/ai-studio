import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { progressSpans } from "@ais-app/database";
import { eq, and, asc, or } from "drizzle-orm";
import { withAuth, errorResponse } from "@/lib/api-utils";

export const GET = withAuth(async (request: NextRequest, auth) => {
  const traceId = request.nextUrl.searchParams.get("traceId");
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!traceId && !sessionId) {
    return errorResponse("traceId or sessionId parameter is required", "VALIDATION_ERROR", 400);
  }

  const db = getDb();

  const filter = traceId && sessionId
    ? or(eq(progressSpans.traceId, traceId), eq(progressSpans.sessionId, sessionId))
    : traceId
      ? eq(progressSpans.traceId, traceId)
      : eq(progressSpans.sessionId, sessionId!);

  const spans = await db
    .select()
    .from(progressSpans)
    .where(and(
      eq(progressSpans.tenantId, auth.tenantId),
      filter,
    ))
    .orderBy(asc(progressSpans.seq));

  const mapped = spans.map((s) => ({
    id: s.id,
    seq: s.seq,
    traceId: s.traceId,
    parentId: s.parentId,
    tenantId: s.tenantId,
    spanKind: s.spanKind,
    phase: s.phase,
    timestamp: s.timestampMs,
    durationMs: s.durationMs,
    name: s.name,
    message: s.message,
    tokens: s.tokens,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    costUsd: s.costUsd ? parseFloat(s.costUsd) : undefined,
    argsPreview: s.argsPreview,
    argsLen: s.argsLen,
    resultPreview: s.resultPreview,
    resultLen: s.resultLen,
    agentId: s.agentId,
    agentName: s.agentName,
    sessionId: s.sessionId,
    nodeId: s.nodeId,
    modelId: s.modelId,
    toolName: s.toolName,
  }));

  return NextResponse.json({ spans: mapped });
});
