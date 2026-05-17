import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentKnowledgeBases } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const DELETE = withRBAC("AGENTS", 20, async (_request, auth, params) => {
  const akbId = params?.akbId;
  if (!akbId) return errorResponse("Assignment ID required", "MISSING_ID", 400);

  const db = getDb();
  const [existing] = await db
    .select({ id: agentKnowledgeBases.id, agentId: agentKnowledgeBases.agentId, knowledgeBaseId: agentKnowledgeBases.knowledgeBaseId })
    .from(agentKnowledgeBases)
    .where(and(eq(agentKnowledgeBases.id, akbId), eq(agentKnowledgeBases.tenantId, auth.tenantId)))
    .limit(1);

  if (!existing) return errorResponse("Assignment not found", "NOT_FOUND", 404);

  await db.delete(agentKnowledgeBases).where(and(eq(agentKnowledgeBases.id, akbId), eq(agentKnowledgeBases.tenantId, auth.tenantId)));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "agent.remove_knowledge_base",
    resourceType: "agent",
    resourceId: existing.agentId,
    details: { knowledgeBaseId: existing.knowledgeBaseId },
  });

  return NextResponse.json({ success: true });
});
