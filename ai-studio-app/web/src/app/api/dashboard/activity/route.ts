import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { auditLog } from "@ais-app/database";
import { eq, desc } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("DASHBOARD", 10, async (_request, auth) => {
  const db = getDb();

  const data = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      userId: auditLog.userId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.tenantId, auth.tenantId))
    .orderBy(desc(auditLog.createdAt))
    .limit(20);

  return NextResponse.json({ data });
});
