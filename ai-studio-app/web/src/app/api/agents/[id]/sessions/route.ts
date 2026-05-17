import { NextResponse } from "next/server";
import { runSession } from "@ais-app/agent-runtime";
import { agentSessionSchema } from "@ais-app/validation";
import { getDb, agentSessions } from "@ais-app/database";
import { eq } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("AGENTS", 10, async (request, auth, params) => {
  const agentId = params?.id;
  if (!agentId) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = agentSessionSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });

  const channel = parsed.data.channel || "studio";
  const isAsync = parsed.data.async === true;

  const sessionInput = {
    agentId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    message: parsed.data.message.trim(),
    channel,
    metadata: parsed.data.metadata,
  };

  if (isAsync) {
    const db = getDb();
    const [session] = await db.insert(agentSessions).values({
      tenantId: auth.tenantId,
      agentId,
      channel,
      status: "pending",
      triggeredBy: auth.userId,
      input: parsed.data.metadata || {},
    }).returning({ id: agentSessions.id });

    runSession({ ...sessionInput, sessionId: session.id }).then(async (result) => {
      await createAuditEntry({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "agent.session_complete",
        resourceType: "agent_session",
        resourceId: result.sessionId,
        details: { agentId, channel, status: result.status },
      });
    }).catch(async (err) => {
      await db.update(agentSessions).set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
        completedAt: new Date(),
      }).where(eq(agentSessions.id, session.id));
    });

    await createAuditEntry({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "agent.session_create",
      resourceType: "agent_session",
      resourceId: session.id,
      details: { agentId, channel, async: true },
    });

    return NextResponse.json({ sessionId: session.id, status: "accepted", async: true }, { status: 202 });
  }

  const result = await runSession(sessionInput);

  if (result.error) {
    return errorResponse(result.error, "SESSION_ERROR", 400);
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "agent.session_create",
    resourceType: "agent_session",
    resourceId: result.sessionId,
    details: { agentId, channel },
  });

  return NextResponse.json(result, { status: 201 });
});
