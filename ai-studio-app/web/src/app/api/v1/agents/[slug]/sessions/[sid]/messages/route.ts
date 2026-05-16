import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents, agentSessions, agentSessionMessages } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { runSession } from "@ais-app/agent-runtime";
import { authenticateApiKey, errorJson } from "@/lib/api-key-auth";
import { parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { z } from "zod";

const sendMessageSchema = z.object({
  message: z.string().min(1).max(100000),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string; sid: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return errorJson("Invalid or missing API key", "UNAUTHORIZED", 401);

  const { slug, sid } = await context.params;
  const db = getDb();

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.slug, slug), eq(agents.tenantId, auth.tenantId)))
    .limit(1);

  if (!agent) return errorJson("Agent not found", "NOT_FOUND", 404);

  const [session] = await db
    .select({ id: agentSessions.id, status: agentSessions.status, agentId: agentSessions.agentId })
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sid), eq(agentSessions.tenantId, auth.tenantId)))
    .limit(1);

  if (!session) return errorJson("Session not found", "NOT_FOUND", 404);
  if (session.agentId !== agent.id) return errorJson("Session does not belong to this agent", "INVALID_SESSION", 400);
  if (session.status === "failed" || session.status === "cancelled" || session.status === "completed") {
    return errorJson("Session is closed", "SESSION_CLOSED", 400);
  }

  const body = await parseJsonBody(request);
  if (!body) return errorJson("Invalid JSON body", "INVALID_JSON", 400);

  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.errors[0].message, "VALIDATION_ERROR", 400);
  }

  const { message, metadata } = parsed.data;

  const result = await runSession({
    agentId: agent.id,
    tenantId: auth.tenantId,
    userId: auth.keyId,
    message: message.trim(),
    sessionId: sid,
    channel: "api",
  });

  if (result.error) {
    return errorJson(result.error, "SESSION_ERROR", 400);
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: null,
    action: "api.message_send",
    resourceType: "agent_session",
    resourceId: sid,
    details: { agentSlug: slug, apiKey: auth.keyName, metadata },
  });

  return NextResponse.json({
    sessionId: result.sessionId,
    response: { text: result.response, usage: result.usage },
    status: result.status,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string; sid: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return errorJson("Invalid or missing API key", "UNAUTHORIZED", 401);

  const { sid } = await context.params;
  const db = getDb();

  const messages = await db
    .select({
      role: agentSessionMessages.role,
      content: agentSessionMessages.content,
      createdAt: agentSessionMessages.createdAt,
    })
    .from(agentSessionMessages)
    .where(and(
      eq(agentSessionMessages.agentSessionId, sid),
      eq(agentSessionMessages.tenantId, auth.tenantId),
    ))
    .orderBy(asc(agentSessionMessages.createdAt));

  return NextResponse.json({ messages });
}
