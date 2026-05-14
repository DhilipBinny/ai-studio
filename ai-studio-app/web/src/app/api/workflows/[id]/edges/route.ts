import { NextRequest, NextResponse } from "next/server";
import { updateEdgesSchema } from "@ais-app/validation";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { updateWorkflowEdges } from "@/lib/services/workflow";

export const PUT = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await request.json();
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
