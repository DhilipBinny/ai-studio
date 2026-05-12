import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents, agentTools, tools, agentKnowledgeBases, knowledgeBases } from "@ais-app/database";
import { updateAgentSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("AGENTS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const db = getDb();
  const [agent] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.tenantId, auth.tenantId))).limit(1);
  if (!agent) return errorResponse("Agent not found", "NOT_FOUND", 404);

  const assignedTools = await db
    .select({ id: agentTools.id, toolId: agentTools.toolId, toolConfig: agentTools.toolConfig, isRequired: agentTools.isRequired, priority: agentTools.priority, toolName: tools.name, toolDisplayName: tools.displayName })
    .from(agentTools)
    .innerJoin(tools, eq(agentTools.toolId, tools.id))
    .where(eq(agentTools.agentId, id));

  const assignedKBs = await db
    .select({ id: agentKnowledgeBases.id, knowledgeBaseId: agentKnowledgeBases.knowledgeBaseId, searchConfig: agentKnowledgeBases.searchConfig, kbName: knowledgeBases.name })
    .from(agentKnowledgeBases)
    .innerJoin(knowledgeBases, eq(agentKnowledgeBases.knowledgeBaseId, knowledgeBases.id))
    .where(eq(agentKnowledgeBases.agentId, id));

  return NextResponse.json({ ...agent, tools: assignedTools, knowledgeBases: assignedKBs });
});

export const PATCH = withRBAC("AGENTS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await request.json();
  const parsed = updateAgentSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });

  const db = getDb();
  const [existing] = await db.select({ id: agents.id, version: agents.version }).from(agents).where(and(eq(agents.id, id), eq(agents.tenantId, auth.tenantId))).limit(1);
  if (!existing) return errorResponse("Agent not found", "NOT_FOUND", 404);

  const updateData: Record<string, unknown> = { version: existing.version + 1 };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      if (key === "temperature" && value != null) updateData[key] = String(value);
      else updateData[key] = value;
    }
  }

  const [updated] = await db.update(agents).set(updateData).where(and(eq(agents.id, id), eq(agents.tenantId, auth.tenantId))).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "agent.update", resourceType: "agent", resourceId: id, details: { fields: Object.keys(parsed.data), newVersion: existing.version + 1 } });

  return NextResponse.json(updated);
});
