import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { auditLog } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc, ilike } from "drizzle-orm";
import { withRBAC, escapeLike } from "@/lib/api-utils";

export const GET = withRBAC("AUDIT", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const action = url.searchParams.get("action");
  const resourceType = url.searchParams.get("resourceType");

  const conditions = [eq(auditLog.tenantId, auth.tenantId)];
  if (action) conditions.push(ilike(auditLog.action, `%${escapeLike(action)}%`));
  if (resourceType) conditions.push(eq(auditLog.resourceType, resourceType));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(auditLog).where(where),
  ]);

  return NextResponse.json({
    data,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(total / pagination.pageSize),
  });
});
