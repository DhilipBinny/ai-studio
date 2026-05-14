import { NextRequest, NextResponse } from "next/server";
import { updateWorkflowSchema } from "@ais-app/validation";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import {
  getWorkflowDetail,
  updateWorkflow,
  WorkflowNotFoundError,
} from "@/lib/services/workflow";

export const GET = withRBAC("WORKFLOWS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const result = await getWorkflowDetail(auth.tenantId, id);
  if (!result) return errorResponse("Workflow not found", "NOT_FOUND", 404);

  return NextResponse.json(result);
});

export const PATCH = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await request.json();
  const parsed = updateWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }

  try {
    const updated = await updateWorkflow(
      auth.tenantId,
      id,
      {
        ...parsed.data,
        triggerConfig: body.triggerConfig,
      },
      auth.userId,
    );

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof WorkflowNotFoundError) {
      return errorResponse(e.message, "NOT_FOUND", 404);
    }
    throw e;
  }
});
