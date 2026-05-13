import { NextRequest, NextResponse } from "next/server";
import { resumeWorkflow } from "@ais-app/agent-runtime";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const rid = params?.rid;
  if (!rid) return errorResponse("Run ID required", "MISSING_ID", 400);

  const body = await request.json();
  const decision = body.decision || {};

  try {
    const result = await resumeWorkflow(rid, auth.tenantId, auth.userId, decision);

    await createAuditEntry({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "workflow.resume",
      resourceType: "workflow_run",
      resourceId: rid,
      details: { status: result.status },
    });

    return NextResponse.json(result);
  } catch (e) {
    return errorResponse((e as Error).message, "WORKFLOW_ERROR", 400);
  }
});
