import { NextRequest, NextResponse } from "next/server";
import { createAgentSchema, paginationSchema } from "@ais-app/validation";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { getAgents, createAgent, SlugExistsError } from "@/lib/services/agent";

export const GET = withRBAC("AGENTS", 10, async (request, auth) => {
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  const result = await getAgents(auth.tenantId, {
    page: pagination.page,
    pageSize: pagination.pageSize,
    status,
    search,
  });

  return NextResponse.json(result);
});

export const POST = withRBAC("AGENTS", 20, async (request, auth) => {
  const body = await request.json();
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });

  try {
    const agent = await createAgent(auth.tenantId, parsed.data, auth.userId);
    return NextResponse.json(agent, { status: 201 });
  } catch (e) {
    if (e instanceof SlugExistsError) return errorResponse(e.message, "CONFLICT", 409);
    throw e;
  }
});
