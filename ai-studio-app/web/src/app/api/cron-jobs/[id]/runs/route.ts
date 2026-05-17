import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { cronJobRuns, cronJobs } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";

export const GET = withRBAC("SETTINGS", 10, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Job ID required", "MISSING_ID", 400);

  const db = getDb();

  const [job] = await db.select({ id: cronJobs.id }).from(cronJobs)
    .where(and(eq(cronJobs.id, id), eq(cronJobs.tenantId, auth.tenantId))).limit(1);
  if (!job) return errorResponse("Job not found", "NOT_FOUND", 404);

  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const where = and(eq(cronJobRuns.cronJobId, id), eq(cronJobRuns.tenantId, auth.tenantId));

  const [data, [{ total }]] = await Promise.all([
    db.select().from(cronJobRuns).where(where)
      .orderBy(desc(cronJobRuns.createdAt))
      .limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(cronJobRuns).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});
