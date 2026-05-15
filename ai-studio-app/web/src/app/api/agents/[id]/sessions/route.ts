import { NextRequest, NextResponse } from "next/server";
import { runSession } from "@ais-app/agent-runtime";
import { agentSessionSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("AGENTS", 10, async (request, auth, params) => {
  const agentId = params?.id;
  if (!agentId) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = agentSessionSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });

  const result = await runSession({
    agentId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    message: parsed.data.message.trim(),
    channel: "studio",
    metadata: parsed.data.metadata,
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
