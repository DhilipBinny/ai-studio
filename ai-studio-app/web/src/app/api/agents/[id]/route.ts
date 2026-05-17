import { NextRequest, NextResponse } from "next/server";
import { updateAgentSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { getAgentDetail, updateAgent, AgentNotFoundError } from "@/lib/services/agent";

export const GET = withRBAC("AGENTS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const agent = await getAgentDetail(auth.tenantId, id);
  if (!agent) return errorResponse("Agent not found", "NOT_FOUND", 404);

  return NextResponse.json(agent);
});

export const PATCH = withRBAC("AGENTS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateAgentSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });

  try {
    const updated = await updateAgent(auth.tenantId, id, parsed.data, auth.userId);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AgentNotFoundError) return errorResponse(e.message, "NOT_FOUND", 404);
    throw e;
  }
});
