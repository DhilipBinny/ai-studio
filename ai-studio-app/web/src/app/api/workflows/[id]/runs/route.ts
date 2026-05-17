import { NextRequest, NextResponse } from "next/server";
import { paginationSchema } from "@ais-app/validation";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { getWorkflowRuns } from "@/lib/services/workflow";

export const GET = withRBAC("WORKFLOWS", 10, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const result = await getWorkflowRuns(auth.tenantId, id, {
    page: pagination.page,
    pageSize: pagination.pageSize,
  });

  return NextResponse.json(result);
});
