import { NextRequest, NextResponse } from "next/server";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { getSessionDetail } from "@/lib/services/session";

export const GET = withRBAC("RUNS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Session ID required", "MISSING_ID", 400);

  const result = await getSessionDetail(auth.tenantId, id);
  if (!result) return errorResponse("Session not found", "NOT_FOUND", 404);

  return NextResponse.json(result);
});
