import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { connectors } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("CONNECTORS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const where = and(eq(connectors.tenantId, auth.tenantId), eq(connectors.isActive, true));

  const [data, [{ total }]] = await Promise.all([
    db.select().from(connectors).where(where).orderBy(desc(connectors.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(connectors).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});

export const POST = withRBAC("CONNECTORS", 20, async (request, auth) => {
  const body = await request.json();
  const { name, description, connectorType, connectionConfig, credentialsRef, healthCheckUrl } = body;
  if (!name || !connectorType) return errorResponse("Name and type required", "VALIDATION_ERROR", 400);

  const db = getDb();
  const [existing] = await db.select({ id: connectors.id }).from(connectors).where(and(eq(connectors.tenantId, auth.tenantId), eq(connectors.name, name))).limit(1);
  if (existing) return errorResponse("Name already exists", "NAME_EXISTS", 409);

  const [connector] = await db.insert(connectors).values({
    tenantId: auth.tenantId,
    name,
    description: description || "",
    connectorType,
    connectionConfig: connectionConfig || {},
    credentialsRef: credentialsRef || null,
    healthCheckUrl: healthCheckUrl || null,
    createdBy: auth.userId,
  }).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "connector.create", resourceType: "connector", resourceId: connector.id, details: { name, connectorType } });

  return NextResponse.json(connector, { status: 201 });
});
