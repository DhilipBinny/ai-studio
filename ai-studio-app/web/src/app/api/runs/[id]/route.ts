import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentRuns, agentRunMessages, agentRunToolCalls } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";

export const GET = withRBAC("RUNS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Run ID required", "MISSING_ID", 400);

  const db = getDb();
  const [run] = await db.select().from(agentRuns).where(and(eq(agentRuns.id, id), eq(agentRuns.tenantId, auth.tenantId))).limit(1);
  if (!run) return errorResponse("Run not found", "NOT_FOUND", 404);

  const messages = await db.select().from(agentRunMessages).where(eq(agentRunMessages.agentRunId, id)).orderBy(asc(agentRunMessages.createdAt));
  const toolCalls = await db.select().from(agentRunToolCalls).where(eq(agentRunToolCalls.agentRunId, id)).orderBy(asc(agentRunToolCalls.createdAt));

  return NextResponse.json({ ...run, messages, toolCalls });
});
