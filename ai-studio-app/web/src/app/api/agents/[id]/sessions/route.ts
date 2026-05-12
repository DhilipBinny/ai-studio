import { NextRequest, NextResponse } from "next/server";
import { runSession } from "@ais-app/agent-runtime";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("AGENTS", 10, async (request, auth, params) => {
  const agentId = params?.id;
  if (!agentId) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await request.json();
  const message = body.message;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return errorResponse("Message is required", "VALIDATION_ERROR", 400);
  }

  const result = await runSession({
    agentId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    message: message.trim(),
    channel: "studio",
    metadata: body.metadata,
  });

  if (result.error) {
    return errorResponse(result.error, "SESSION_ERROR", 400);
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "agent.session_create",
    resourceType: "agent_session",
    resourceId: result.sessionId,
    details: { agentId, channel: "studio" },
  });

  return NextResponse.json(result, { status: 201 });
});
