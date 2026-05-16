import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentSessions, agentSessionMessages } from "@ais-app/database";
import { runSession } from "@ais-app/agent-runtime";
import { eq, and, asc } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { z } from "zod";

const sendMessageSchema = z.object({
  message: z.string().min(1).max(100000),
  metadata: z.record(z.unknown()).optional(),
});

export const POST = withRBAC("AGENTS", 10, async (request, auth, params) => {
  const agentId = params?.id;
  const sessionId = params?.sid;
  if (!agentId || !sessionId) return errorResponse("Agent ID and Session ID required", "MISSING_ID", 400);

  const db = getDb();
  const [session] = await db
    .select({ id: agentSessions.id, status: agentSessions.status, agentId: agentSessions.agentId })
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.tenantId, auth.tenantId)))
    .limit(1);

  if (!session) return errorResponse("Session not found", "NOT_FOUND", 404);
  if (session.agentId !== agentId) return errorResponse("Session does not belong to this agent", "INVALID_SESSION", 400);
  if (session.status === "failed" || session.status === "cancelled" || session.status === "completed") {
    return errorResponse("Session is closed", "SESSION_CLOSED", 400);
  }

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);

  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.errors[0].message, "VALIDATION_ERROR", 400);
  }

  const { message } = parsed.data;

  const result = await runSession({
    agentId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    message: message.trim(),
    sessionId,
    channel: "studio",
  });

  if (result.error) {
    return errorResponse(result.error, "SESSION_ERROR", 400);
  }

  return NextResponse.json(result);
});

export const GET = withRBAC("AGENTS", 10, async (_request, auth, params) => {
  const sessionId = params?.sid;
  if (!sessionId) return errorResponse("Session ID required", "MISSING_ID", 400);

  const db = getDb();
  const messages = await db
    .select({
      id: agentSessionMessages.id,
      role: agentSessionMessages.role,
      content: agentSessionMessages.content,
      metadata: agentSessionMessages.metadata,
      createdAt: agentSessionMessages.createdAt,
    })
    .from(agentSessionMessages)
    .where(and(
      eq(agentSessionMessages.agentSessionId, sessionId),
      eq(agentSessionMessages.tenantId, auth.tenantId),
    ))
    .orderBy(asc(agentSessionMessages.createdAt));

  return NextResponse.json({ messages });
});
