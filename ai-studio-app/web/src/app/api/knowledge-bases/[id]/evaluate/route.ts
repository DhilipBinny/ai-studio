import { NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { knowledgeBases, agentKnowledgeBases, ragEvaluations, providers } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { decryptSecret, isEncrypted } from "@ais-app/auth";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { evaluateRAG, type EvaluationQuestion } from "@/lib/rag/evaluate";
import { createAuditEntry } from "@/lib/services/audit";
import { z } from "zod";

const evalRequestSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1).max(2000),
        groundTruth: z.string().max(5000).optional(),
      }),
    )
    .min(1)
    .max(50),
  agentId: z.string().uuid(),
  evaluationProviderId: z.string().uuid().optional(),
  evaluationModel: z.string().max(200).optional(),
});

export const POST = withRBAC("KNOWLEDGE", 20, async (request, auth, params) => {
  const kbId = params?.id;
  if (!kbId) return errorResponse("KB ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);

  const parsed = evalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  const { questions, agentId, evaluationProviderId, evaluationModel } = parsed.data;

  const db = getDb();

  // Verify KB exists and belongs to tenant
  const kbRows = await db
    .select({
      id: knowledgeBases.id,
      embeddingSource: knowledgeBases.embeddingSource,
      embeddingModel: knowledgeBases.embeddingModel,
      embeddingDimension: knowledgeBases.embeddingDimension,
      embeddingProviderId: knowledgeBases.embeddingProviderId,
      contextualEnrichment: knowledgeBases.contextualEnrichment,
      queryExpansion: knowledgeBases.queryExpansion,
      chunkConfig: knowledgeBases.chunkConfig,
      rerankSource: knowledgeBases.rerankSource,
      rerankModel: knowledgeBases.rerankModel,
    })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, auth.tenantId)))
    .limit(1);

  const kb = kbRows[0];
  if (!kb) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  // Verify agent is assigned to this KB (scoped to tenant)
  const [assignment] = await db
    .select({ id: agentKnowledgeBases.id })
    .from(agentKnowledgeBases)
    .where(and(
      eq(agentKnowledgeBases.agentId, agentId),
      eq(agentKnowledgeBases.knowledgeBaseId, kbId),
      eq(agentKnowledgeBases.tenantId, auth.tenantId),
    ))
    .limit(1);

  if (!assignment) return errorResponse("Agent is not assigned to this knowledge base", "NOT_ASSIGNED", 400);

  // Resolve the evaluation LLM provider
  // Priority: explicit evaluationProviderId -> KB's embedding provider (if provider-based) -> error
  const evalProviderId = evaluationProviderId || kb.embeddingProviderId;
  if (!evalProviderId) {
    return errorResponse(
      "No evaluation provider available. Provide evaluationProviderId or configure a provider-based embedding on the KB.",
      "NO_PROVIDER",
      400,
    );
  }

  const [evalProvider] = await db
    .select({
      providerType: providers.providerType,
      apiKeyRef: providers.apiKeyRef,
      baseUrl: providers.baseUrl,
    })
    .from(providers)
    .where(and(eq(providers.id, evalProviderId), eq(providers.tenantId, auth.tenantId)))
    .limit(1);

  if (!evalProvider) return errorResponse("Evaluation provider not found", "PROVIDER_NOT_FOUND", 404);

  const decryptedApiKey = evalProvider.apiKeyRef && isEncrypted(evalProvider.apiKeyRef)
    ? decryptSecret(evalProvider.apiKeyRef)
    : evalProvider.apiKeyRef;

  // Default model selection per provider type
  const defaultModels: Record<string, string> = {
    anthropic: "claude-haiku-4-20250514",
    openai: "gpt-4o-mini",
    ollama: "llama3",
    openai_compatible: "gpt-4o-mini",
  };
  const modelId = evaluationModel || defaultModels[evalProvider.providerType] || "gpt-4o-mini";

  // Build evaluation questions
  const evalQuestions: EvaluationQuestion[] = questions.map((q) => ({
    question: q.question,
    groundTruth: q.groundTruth,
  }));

  // Get embedding provider for answer relevancy scoring
  let embeddingProviderType = "builtin";
  let embeddingApiKey: string | undefined;
  let embeddingBaseUrl: string | undefined;

  if (kb.embeddingSource === "provider" && kb.embeddingProviderId) {
    const [embProvider] = await db
      .select({
        providerType: providers.providerType,
        apiKeyRef: providers.apiKeyRef,
        baseUrl: providers.baseUrl,
      })
      .from(providers)
      .where(and(eq(providers.id, kb.embeddingProviderId), eq(providers.tenantId, auth.tenantId)))
      .limit(1);

    if (embProvider) {
      embeddingProviderType = embProvider.providerType;
      embeddingApiKey = embProvider.apiKeyRef && isEncrypted(embProvider.apiKeyRef)
        ? decryptSecret(embProvider.apiKeyRef)
        : embProvider.apiKeyRef || undefined;
      embeddingBaseUrl = embProvider.baseUrl || undefined;
    }
  }

  // Run evaluation
  const evalResults = await evaluateRAG({
    agentId,
    tenantId: auth.tenantId,
    questions: evalQuestions,
    llmConfig: {
      providerType: evalProvider.providerType,
      model: modelId,
      apiKey: decryptedApiKey || undefined,
      baseUrl: evalProvider.baseUrl || undefined,
    },
    embeddingConfig: {
      embeddingSource: kb.embeddingSource,
      embeddingModel: kb.embeddingModel,
      embeddingDimension: kb.embeddingDimension,
      embeddingProviderId: kb.embeddingProviderId,
      provider: kb.embeddingSource === "provider" ? {
        providerType: embeddingProviderType,
        apiKeyRef: embeddingApiKey || null,
        baseUrl: embeddingBaseUrl || null,
      } : null,
    },
  });

  // Snapshot KB config for historical comparison
  const kbConfigSnapshot = {
    embeddingSource: kb.embeddingSource,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
    contextualEnrichment: kb.contextualEnrichment,
    queryExpansion: kb.queryExpansion,
    chunkConfig: kb.chunkConfig,
    rerankSource: kb.rerankSource,
    rerankModel: kb.rerankModel,
  };

  // Persist evaluation results
  const [inserted] = await db
    .insert(ragEvaluations)
    .values({
      tenantId: auth.tenantId,
      knowledgeBaseId: kbId,
      agentId,
      evaluationModel: modelId,
      questionCount: evalQuestions.length,
      summary: evalResults.summary,
      results: evalResults.results,
      kbConfigSnapshot,
      createdBy: auth.userId,
    })
    .returning({ id: ragEvaluations.id });

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "rag_evaluation.create",
    resourceType: "knowledge_base",
    resourceId: kbId,
    details: { evaluationId: inserted.id, agentId, questionCount: evalQuestions.length, model: modelId },
  });

  return NextResponse.json({
    evaluationId: inserted.id,
    ...evalResults,
  });
});
