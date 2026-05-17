import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentConnectors, connectors } from "@ais-app/database";
import { assignConnectorSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("AGENTS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const db = getDb();
  const data = await db
    .select({
      id: agentConnectors.id,
      connectorId: agentConnectors.connectorId,
      connectorName: connectors.name,
      connectorType: connectors.connectorType,
      status: connectors.status,
    })
    .from(agentConnectors)
    .innerJoin(connectors, eq(agentConnectors.connectorId, connectors.id))
    .where(and(eq(agentConnectors.agentId, id), eq(agentConnectors.tenantId, auth.tenantId)));

  return NextResponse.json({ data });
});

export const POST = withRBAC("AGENTS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = assignConnectorSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });

  const db = getDb();

  const [connector] = await db
    .select({ id: connectors.id, name: connectors.name })
    .from(connectors)
    .where(and(eq(connectors.id, parsed.data.connectorId), eq(connectors.tenantId, auth.tenantId), eq(connectors.isActive, true)))
    .limit(1);

  if (!connector) return errorResponse("Connector not found", "NOT_FOUND", 404);

  const [existing] = await db
    .select({ id: agentConnectors.id })
    .from(agentConnectors)
    .where(and(eq(agentConnectors.agentId, id), eq(agentConnectors.connectorId, parsed.data.connectorId), eq(agentConnectors.tenantId, auth.tenantId)))
    .limit(1);

  if (existing) return errorResponse("Connector already assigned", "ALREADY_ASSIGNED", 409);

  const [assigned] = await db.insert(agentConnectors).values({
    tenantId: auth.tenantId,
    agentId: id,
    connectorId: parsed.data.connectorId,
  }).returning();

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "agent.assign_connector", resourceType: "agent", resourceId: id,
    details: { connectorId: parsed.data.connectorId, connectorName: connector.name },
  });

  return NextResponse.json(assigned, { status: 201 });
});
