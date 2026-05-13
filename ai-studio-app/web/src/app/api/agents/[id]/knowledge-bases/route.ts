import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentKnowledgeBases, knowledgeBases } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("AGENTS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const db = getDb();
  const data = await db
    .select({
      id: agentKnowledgeBases.id,
      knowledgeBaseId: agentKnowledgeBases.knowledgeBaseId,
      searchConfig: agentKnowledgeBases.searchConfig,
      kbName: knowledgeBases.name,
      kbDescription: knowledgeBases.description,
      documentCount: knowledgeBases.documentCount,
      chunkCount: knowledgeBases.chunkCount,
    })
    .from(agentKnowledgeBases)
    .innerJoin(knowledgeBases, eq(agentKnowledgeBases.knowledgeBaseId, knowledgeBases.id))
    .where(and(eq(agentKnowledgeBases.agentId, id), eq(agentKnowledgeBases.tenantId, auth.tenantId)));

  return NextResponse.json({ data });
});

export const POST = withRBAC("AGENTS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const body = await request.json();
  const { knowledgeBaseId, searchConfig } = body;

  if (!knowledgeBaseId) return errorResponse("knowledgeBaseId required", "VALIDATION_ERROR", 400);

  const db = getDb();

  const [kb] = await db
    .select({ id: knowledgeBases.id, name: knowledgeBases.name })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, knowledgeBaseId), eq(knowledgeBases.tenantId, auth.tenantId), eq(knowledgeBases.isActive, true)))
    .limit(1);

  if (!kb) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  const [existing] = await db
    .select({ id: agentKnowledgeBases.id })
    .from(agentKnowledgeBases)
    .where(and(eq(agentKnowledgeBases.agentId, id), eq(agentKnowledgeBases.knowledgeBaseId, knowledgeBaseId), eq(agentKnowledgeBases.tenantId, auth.tenantId)))
    .limit(1);

  if (existing) return errorResponse("Knowledge base already assigned", "ALREADY_ASSIGNED", 409);

  const [assigned] = await db.insert(agentKnowledgeBases).values({
    tenantId: auth.tenantId,
    agentId: id,
    knowledgeBaseId,
    searchConfig: searchConfig || { top_k: 5, similarity_threshold: 0.3 },
  }).returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "agent.assign_knowledge_base",
    resourceType: "agent",
    resourceId: id,
    details: { knowledgeBaseId, knowledgeBaseName: kb.name },
  });

  return NextResponse.json(assigned, { status: 201 });
});
