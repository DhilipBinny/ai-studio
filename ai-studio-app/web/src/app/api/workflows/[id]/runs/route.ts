import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { workflowRuns, workflows } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";

export const GET = withRBAC("WORKFLOWS", 10, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const where = and(eq(workflowRuns.workflowId, id), eq(workflowRuns.tenantId, auth.tenantId));

  const [data, [{ total }]] = await Promise.all([
    db.select().from(workflowRuns).where(where).orderBy(desc(workflowRuns.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(workflowRuns).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});
