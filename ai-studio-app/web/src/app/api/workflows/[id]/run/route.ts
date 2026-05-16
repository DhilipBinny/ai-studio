import { NextResponse } from "next/server";
import { triggerWorkflow } from "@ais-app/agent-runtime";
import { triggerWorkflowSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = triggerWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }

  const input = parsed.data.input || {};

  triggerWorkflow(id, auth.tenantId, auth.userId, input).then(async (result) => {
    await createAuditEntry({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "workflow.run_complete",
      resourceType: "workflow",
      resourceId: id,
      details: { runId: result.runId, status: result.status },
    });
  }).catch(() => {});

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "workflow.run",
    resourceType: "workflow",
    resourceId: id,
    details: { status: "triggered" },
  });

  return NextResponse.json({ status: "triggered", workflowId: id, message: "Workflow started. Check the Runs tab for progress." }, { status: 202 });
});
