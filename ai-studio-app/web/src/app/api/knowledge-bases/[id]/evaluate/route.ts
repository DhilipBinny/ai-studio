import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { knowledgeBases, agentKnowledgeBases } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { evaluateRAG, type EvalQuestion } from "@/lib/rag/evaluate";

export const POST = withRBAC("KNOWLEDGE", 20, async (request, auth, params) => {
  const kbId = params?.id;
  if (!kbId) return errorResponse("KB ID required", "MISSING_ID", 400);

  const body = await request.json();
  const { questions, agentId } = body as { questions: EvalQuestion[]; agentId: string };

  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return errorResponse("questions array is required", "VALIDATION_ERROR", 400);
  }
  if (!agentId) {
    return errorResponse("agentId is required", "VALIDATION_ERROR", 400);
  }

  const db = getDb();
  const [kb] = await db
    .select({ id: knowledgeBases.id })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, auth.tenantId)))
    .limit(1);

  if (!kb) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  const [assignment] = await db
    .select({ id: agentKnowledgeBases.id })
    .from(agentKnowledgeBases)
    .where(and(eq(agentKnowledgeBases.agentId, agentId), eq(agentKnowledgeBases.knowledgeBaseId, kbId)))
    .limit(1);

  if (!assignment) return errorResponse("Agent is not assigned to this knowledge base", "NOT_ASSIGNED", 400);

  const evalResults = await evaluateRAG(agentId, auth.tenantId, questions);

  return NextResponse.json(evalResults);
});
