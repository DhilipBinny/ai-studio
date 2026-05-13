import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentSessions, agentSessionMessages, agentSessionToolCalls, agents } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";

export const GET = withRBAC("RUNS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Session ID required", "MISSING_ID", 400);

  const db = getDb();
  const [row] = await db
    .select({
      id: agentSessions.id,
      agentId: agentSessions.agentId,
      agentName: agents.name,
      agentSlug: agents.slug,
      status: agentSessions.status,
      channel: agentSessions.channel,
      triggerType: agentSessions.triggerType,
      totalInputTokens: agentSessions.totalInputTokens,
      totalOutputTokens: agentSessions.totalOutputTokens,
      totalCostUsd: agentSessions.totalCostUsd,
      totalToolCalls: agentSessions.totalToolCalls,
      totalTurns: agentSessions.totalTurns,
      modelUsed: agentSessions.modelUsed,
      providerUsed: agentSessions.providerUsed,
      errorMessage: agentSessions.errorMessage,
      startedAt: agentSessions.startedAt,
      completedAt: agentSessions.completedAt,
      createdAt: agentSessions.createdAt,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(and(eq(agentSessions.id, id), eq(agentSessions.tenantId, auth.tenantId)))
    .limit(1);

  if (!row) return errorResponse("Session not found", "NOT_FOUND", 404);

  const [messages, toolCalls] = await Promise.all([
    db.select().from(agentSessionMessages).where(eq(agentSessionMessages.agentSessionId, id)).orderBy(asc(agentSessionMessages.createdAt)),
    db.select().from(agentSessionToolCalls).where(eq(agentSessionToolCalls.agentSessionId, id)).orderBy(asc(agentSessionToolCalls.createdAt)),
  ]);

  return NextResponse.json({ ...row, messages, toolCalls });
});
