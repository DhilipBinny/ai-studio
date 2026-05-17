import { NextRequest, NextResponse } from "next/server";
import { approveToolCallSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import {
  approveToolCall,
  SessionNotFoundError,
  ToolCallNotFoundError,
  InvalidStateError,
  AlreadyDecidedError,
} from "@/lib/services/session";

export const POST = withRBAC("RUNS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Session ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = approveToolCallSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }

  try {
    const result = await approveToolCall(
      auth.tenantId,
      id,
      parsed.data.toolCallId,
      parsed.data.action,
      auth.userId,
    );

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SessionNotFoundError) {
      return errorResponse(e.message, "NOT_FOUND", 404);
    }
    if (e instanceof InvalidStateError) {
      return errorResponse(e.message, "INVALID_STATE", 409);
    }
    if (e instanceof ToolCallNotFoundError) {
      return errorResponse(e.message, "NOT_FOUND", 404);
    }
    if (e instanceof AlreadyDecidedError) {
      return errorResponse(e.message, "ALREADY_DECIDED", 409);
    }
    throw e;
  }
});
