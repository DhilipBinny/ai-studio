import { NextRequest, NextResponse } from "next/server";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { getWorkflowRunDetail } from "@/lib/services/workflow";

export const GET = withRBAC("WORKFLOWS", 10, async (_request, auth, params) => {
  const id = params?.id;
  const rid = params?.rid;
  if (!id || !rid) return errorResponse("Workflow and Run IDs required", "MISSING_ID", 400);

  const result = await getWorkflowRunDetail(auth.tenantId, id, rid);
  if (!result) return errorResponse("Run not found", "NOT_FOUND", 404);

  return NextResponse.json(result);
});
