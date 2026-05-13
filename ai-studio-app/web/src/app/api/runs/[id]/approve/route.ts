import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentSessions, agentSessionToolCalls } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("RUNS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Session ID required", "MISSING_ID", 400);

  const body = await request.json();
  const { toolCallId, action } = body;

  if (!toolCallId) return errorResponse("toolCallId required", "VALIDATION_ERROR", 400);
  if (action !== "approve" && action !== "deny") {
    return errorResponse("action must be 'approve' or 'deny'", "VALIDATION_ERROR", 400);
  }

  const db = getDb();

  const [session] = await db
    .select({ id: agentSessions.id, status: agentSessions.status })
    .from(agentSessions)
    .where(and(eq(agentSessions.id, id), eq(agentSessions.tenantId, auth.tenantId)))
    .limit(1);

  if (!session) return errorResponse("Session not found", "NOT_FOUND", 404);
  if (session.status !== "waiting_approval") {
    return errorResponse("Session is not waiting for approval", "INVALID_STATE", 400);
  }

  const [toolCall] = await db
    .select({ id: agentSessionToolCalls.id, toolName: agentSessionToolCalls.toolName })
    .from(agentSessionToolCalls)
    .where(and(
      eq(agentSessionToolCalls.id, Number(toolCallId)),
      eq(agentSessionToolCalls.agentSessionId, id),
      eq(agentSessionToolCalls.requiresApproval, true),
    ))
    .limit(1);

  if (!toolCall) return errorResponse("Tool call not found or does not require approval", "NOT_FOUND", 404);

  await db
    .update(agentSessionToolCalls)
    .set({
      approvalStatus: action === "approve" ? "approved" : "denied",
      approvedBy: auth.userId,
      approvedAt: new Date(),
      status: action === "approve" ? "pending" : "denied",
      result: action === "deny" ? "Denied by admin" : "Awaiting human approval",
    })
    .where(eq(agentSessionToolCalls.id, Number(toolCallId)));

  await db
    .update(agentSessions)
    .set({ status: action === "approve" ? "waiting" : "waiting" })
    .where(eq(agentSessions.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: `session.tool_${action}`,
    resourceType: "agent_session",
    resourceId: id,
    details: { toolCallId, toolName: toolCall.toolName, action },
  });

  return NextResponse.json({ success: true, action });
});
