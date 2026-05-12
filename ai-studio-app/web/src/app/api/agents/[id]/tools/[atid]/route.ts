import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentTools } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const DELETE = withRBAC("AGENTS", 20, async (_request, auth, params) => {
  const atid = params?.atid;
  if (!atid) return errorResponse("Assignment ID required", "MISSING_ID", 400);

  const db = getDb();
  const [existing] = await db.select({ id: agentTools.id, agentId: agentTools.agentId, toolId: agentTools.toolId })
    .from(agentTools).where(and(eq(agentTools.id, atid), eq(agentTools.tenantId, auth.tenantId))).limit(1);
  if (!existing) return errorResponse("Assignment not found", "NOT_FOUND", 404);

  await db.delete(agentTools).where(and(eq(agentTools.id, atid), eq(agentTools.tenantId, auth.tenantId)));
  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "agent.remove_tool", resourceType: "agent", resourceId: existing.agentId, details: { toolId: existing.toolId } });

  return NextResponse.json({ success: true });
});
