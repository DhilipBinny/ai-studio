import { NextRequest, NextResponse } from "next/server";
import { updateEdgesSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { updateWorkflowEdges } from "@/lib/services/workflow";

export const PUT = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateEdgesSchema.safeParse(body.edges);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }

  const result = await updateWorkflowEdges(
    auth.tenantId,
    id,
    parsed.data,
    auth.userId,
  );

  return NextResponse.json(result);
});
