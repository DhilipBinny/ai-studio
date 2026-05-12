import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentSessions, agentSessionMessages, agentSessionToolCalls } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";

export const GET = withRBAC("RUNS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Session ID required", "MISSING_ID", 400);

  const db = getDb();
  const [session] = await db.select().from(agentSessions).where(and(eq(agentSessions.id, id), eq(agentSessions.tenantId, auth.tenantId))).limit(1);
  if (!session) return errorResponse("Session not found", "NOT_FOUND", 404);

  const messages = await db.select().from(agentSessionMessages).where(eq(agentSessionMessages.agentSessionId, id)).orderBy(asc(agentSessionMessages.createdAt));
  const toolCalls = await db.select().from(agentSessionToolCalls).where(eq(agentSessionToolCalls.agentSessionId, id)).orderBy(asc(agentSessionToolCalls.createdAt));

  return NextResponse.json({ ...session, messages, toolCalls });
});
