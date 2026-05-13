import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { connectors } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("CONNECTORS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Connector ID required", "MISSING_ID", 400);

  const db = getDb();
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.tenantId, auth.tenantId)))
    .limit(1);

  if (!connector) return errorResponse("Connector not found", "NOT_FOUND", 404);
  return NextResponse.json(connector);
});

export const PATCH = withRBAC("CONNECTORS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Connector ID required", "MISSING_ID", 400);

  const body = await request.json();
  const db = getDb();

  const [existing] = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.tenantId, auth.tenantId), eq(connectors.isActive, true)))
    .limit(1);

  if (!existing) return errorResponse("Connector not found", "NOT_FOUND", 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.connectionConfig !== undefined) updates.connectionConfig = body.connectionConfig;
  if (body.credentialsRef !== undefined) updates.credentialsRef = body.credentialsRef;

  const [updated] = await db
    .update(connectors)
    .set(updates)
    .where(eq(connectors.id, id))
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "connector.update", resourceType: "connector", resourceId: id,
    details: { fields: Object.keys(updates) },
  });

  return NextResponse.json(updated);
});

export const DELETE = withRBAC("CONNECTORS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Connector ID required", "MISSING_ID", 400);

  const db = getDb();
  const [connector] = await db
    .select({ id: connectors.id, name: connectors.name })
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.tenantId, auth.tenantId)))
    .limit(1);

  if (!connector) return errorResponse("Connector not found", "NOT_FOUND", 404);

  await db
    .update(connectors)
    .set({ isActive: false, deactivatedAt: new Date(), updatedAt: new Date() })
    .where(eq(connectors.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "connector.delete", resourceType: "connector", resourceId: id,
    details: { name: connector.name },
  });

  return NextResponse.json({ success: true });
});
