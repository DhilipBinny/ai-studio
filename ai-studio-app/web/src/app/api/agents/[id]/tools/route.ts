import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentTools, tools } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("AGENTS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const db = getDb();
  const data = await db
    .select({ id: agentTools.id, toolId: agentTools.toolId, toolConfig: agentTools.toolConfig, isRequired: agentTools.isRequired, priority: agentTools.priority, toolName: tools.name, toolDisplayName: tools.displayName, riskLevel: tools.riskLevel })
    .from(agentTools)
    .innerJoin(tools, eq(agentTools.toolId, tools.id))
    .where(and(eq(agentTools.agentId, id), eq(agentTools.tenantId, auth.tenantId)));

  return NextResponse.json({ data });
});

export const POST = withRBAC("AGENTS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await request.json();
  const { toolId, toolConfig, isRequired, priority } = body;

  if (!toolId) return errorResponse("toolId required", "VALIDATION_ERROR", 400);

  const db = getDb();

  const [existing] = await db.select({ id: agentTools.id }).from(agentTools)
    .where(and(eq(agentTools.agentId, id), eq(agentTools.toolId, toolId), eq(agentTools.tenantId, auth.tenantId))).limit(1);
  if (existing) return errorResponse("Tool already assigned", "ALREADY_ASSIGNED", 409);

  const [assigned] = await db.insert(agentTools).values({
    tenantId: auth.tenantId,
    agentId: id,
    toolId,
    toolConfig: toolConfig || {},
    isRequired: isRequired || false,
    priority: priority || 0,
  }).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "agent.assign_tool", resourceType: "agent", resourceId: id, details: { toolId } });

  return NextResponse.json(assigned, { status: 201 });
});
