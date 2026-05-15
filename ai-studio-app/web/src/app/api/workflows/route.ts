import { NextRequest, NextResponse } from "next/server";
import { paginationSchema, createWorkflowSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import {
  getWorkflows,
  createWorkflow,
  WorkflowNameExistsError,
} from "@/lib/services/workflow";

export const GET = withRBAC("WORKFLOWS", 10, async (request, auth) => {
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const result = await getWorkflows(auth.tenantId, {
    page: pagination.page,
    pageSize: pagination.pageSize,
  });

  return NextResponse.json(result);
});

export const POST = withRBAC("WORKFLOWS", 20, async (request, auth) => {
  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = createWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }

  try {
    const workflow = await createWorkflow(
      auth.tenantId,
      {
        name: parsed.data.name,
        description: parsed.data.description,
        triggerConfig: parsed.data.triggerConfig,
      },
      auth.userId,
    );

    return NextResponse.json(workflow, { status: 201 });
  } catch (e) {
    if (e instanceof WorkflowNameExistsError) {
      return errorResponse(e.message, "NAME_EXISTS", 409);
    }
    throw e;
  }
});
