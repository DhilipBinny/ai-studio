import { NextRequest, NextResponse } from "next/server";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import {
  cancelSession,
  SessionNotFoundError,
  InvalidStateError,
} from "@/lib/services/session";

export const POST = withRBAC("RUNS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Session ID required", "MISSING_ID", 400);

  try {
    const result = await cancelSession(auth.tenantId, id, auth.userId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SessionNotFoundError) {
      return errorResponse(e.message, "NOT_FOUND", 404);
    }
    if (e instanceof InvalidStateError) {
      return errorResponse(e.message, "INVALID_STATE", 409);
    }
    throw e;
  }
});
