import { NextRequest, NextResponse } from "next/server";
import { triggerWorkflow } from "@ais-app/agent-runtime";
import { triggerWorkflowSchema } from "@ais-app/validation";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await request.json();
  const parsed = triggerWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }

  const input = parsed.data.input || {};

  try {
    const result = await triggerWorkflow(id, auth.tenantId, auth.userId, input);

    await createAuditEntry({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "workflow.run",
      resourceType: "workflow",
      resourceId: id,
      details: { runId: result.runId, status: result.status },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return errorResponse((e as Error).message, "WORKFLOW_ERROR", 400);
  }
});
