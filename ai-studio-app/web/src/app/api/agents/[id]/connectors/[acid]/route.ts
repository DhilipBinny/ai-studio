import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentConnectors } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const DELETE = withRBAC("AGENTS", 20, async (_request, auth, params) => {
  const acid = params?.acid;
  if (!acid) return errorResponse("Assignment ID required", "MISSING_ID", 400);

  const db = getDb();
  const [existing] = await db
    .select({ id: agentConnectors.id, agentId: agentConnectors.agentId, connectorId: agentConnectors.connectorId })
    .from(agentConnectors)
    .where(and(eq(agentConnectors.id, acid), eq(agentConnectors.tenantId, auth.tenantId)))
    .limit(1);

  if (!existing) return errorResponse("Assignment not found", "NOT_FOUND", 404);

  await db.delete(agentConnectors).where(eq(agentConnectors.id, acid));

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "agent.remove_connector", resourceType: "agent", resourceId: existing.agentId,
    details: { connectorId: existing.connectorId },
  });

  return NextResponse.json({ success: true });
});
