import { NextRequest, NextResponse } from "next/server";
import { updateNodesSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import {
  updateWorkflowNodes,
  WorkflowNotFoundError,
  DuplicateNodeNameError,
} from "@/lib/services/workflow";

export const PUT = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateNodesSchema.safeParse(body.nodes);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }

  try {
    const result = await updateWorkflowNodes(auth.tenantId, id, parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof WorkflowNotFoundError) {
      return errorResponse(e.message, "NOT_FOUND", 404);
    }
    if (e instanceof DuplicateNodeNameError) {
      return errorResponse(e.message, "DUPLICATE_NAME", 400);
    }
    throw e;
  }
});
