import { getDb } from "@ais-app/database";
import { auditLog } from "@ais-app/database";
import { computeAuditHash } from "@ais-app/auth";
import { desc, eq } from "drizzle-orm";

export async function createAuditEntry(params: {
  tenantId: string;
  userId: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const db = getDb();

  const [lastEntry] = await db
    .select({ entryHash: auditLog.entryHash })
    .from(auditLog)
    .where(eq(auditLog.tenantId, params.tenantId))
    .orderBy(desc(auditLog.id))
    .limit(1);

  const prevHash = lastEntry?.entryHash ?? "";
  const createdAt = new Date().toISOString();

  const entryHash = computeAuditHash({
    prevHash,
    action: params.action,
    userId: params.userId,
    resourceType: params.resourceType ?? null,
    resourceId: params.resourceId ?? null,
    details: params.details ?? {},
    createdAt,
  });

  await db.insert(auditLog).values({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    details: params.details ?? {},
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    prevHash,
    entryHash,
    createdAt: new Date(createdAt),
  });
}
