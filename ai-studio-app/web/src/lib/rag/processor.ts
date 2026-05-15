import { getDb } from "@ais-app/database";
import { documents, knowledgeBases, providers, graphEntities, graphRelationships } from "@ais-app/database";
import { eq, and, sql } from "drizzle-orm";
import { processDocument as ragProcessDocument, type KBConfig, type DocumentInfo, type LLMCaller, type GraphExtractionOutput } from "@ais/rag-engine";
import { DrizzleDocumentStore } from "@ais-app/agent-runtime/src/stores/drizzle-document-store";
import { createTextExtractor } from "./text-extractor";
import { createEmbedder, buildEmbeddingConfig } from "./embedder";
import type { ChunkConfig } from "@ais/rag-engine";
import { createLLMCaller } from "./llm-caller";
import { decryptSecret, isEncrypted } from "@ais-app/auth";

export async function processDocument(
  documentId: string,
  tenantId: string,
): Promise<{ chunkCount: number }> {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)))
    .limit(1);

  if (!doc) throw new Error("Document not found");
  if (doc.status === "ready") throw new Error("Document already processed");

  const kbRows = await db
    .select({
      chunkConfig: knowledgeBases.chunkConfig,
      embeddingModel: knowledgeBases.embeddingModel,
      embeddingDimension: knowledgeBases.embeddingDimension,
      embeddingSource: knowledgeBases.embeddingSource,
      embeddingProviderId: knowledgeBases.embeddingProviderId,
      rerankSource: knowledgeBases.rerankSource,
      rerankModel: knowledgeBases.rerankModel,
      contextualEnrichment: knowledgeBases.contextualEnrichment,
      contextualModel: knowledgeBases.contextualModel,
      queryExpansion: knowledgeBases.queryExpansion,
      queryExpansionModel: knowledgeBases.queryExpansionModel,
      graphExtraction: knowledgeBases.graphExtraction,
      graphExtractionModel: knowledgeBases.graphExtractionModel,
      providerType: providers.providerType,
      apiKeyRef: providers.apiKeyRef,
      baseUrl: providers.baseUrl,
    })
    .from(knowledgeBases)
    .leftJoin(providers, eq(knowledgeBases.embeddingProviderId, providers.id))
    .where(eq(knowledgeBases.id, doc.knowledgeBaseId))
    .limit(1);

  const kb = kbRows[0];
  if (!kb) throw new Error("Knowledge base not found");

  const docInfo: DocumentInfo = {
    id: doc.id,
    fileName: doc.fileName,
    fileType: doc.fileType,
    storagePath: doc.storagePath,
    knowledgeBaseId: doc.knowledgeBaseId,
  };

  const enrichmentMode = (kb.contextualEnrichment || "static") as "none" | "static" | "llm";

  const kbConfig: KBConfig = {
    chunkConfig: (kb.chunkConfig || {}) as ChunkConfig,
    embeddingSource: kb.embeddingSource,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
    rerankSource: kb.rerankSource,
    rerankModel: kb.rerankModel,
    contextualEnrichment: enrichmentMode,
    contextualModel: kb.contextualModel,
    queryExpansion: (kb.queryExpansion || "none") as "none" | "hyde",
    queryExpansionModel: kb.queryExpansionModel,
    graphExtraction: kb.graphExtraction ?? false,
    graphExtractionModel: kb.graphExtractionModel,
  };

  const embeddingConfig = buildEmbeddingConfig({
    embeddingSource: kb.embeddingSource,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
    embeddingProviderId: kb.embeddingProviderId,
    provider: kb.providerType ? {
      providerType: kb.providerType,
      apiKeyRef: kb.apiKeyRef,
      baseUrl: kb.baseUrl,
    } : null,
  });

  const store = new DrizzleDocumentStore(tenantId);
  const extractor = createTextExtractor();
  const embedder = createEmbedder(embeddingConfig);

  // Create LLM callers for contextual enrichment and/or graph extraction
  const needsLLM = enrichmentMode === "llm" || kbConfig.graphExtraction;
  let llmCaller: LLMCaller | undefined;
  let graphLLMCaller: LLMCaller | undefined;
  if (needsLLM) {
    // Find an active provider for LLM calls (prefer Anthropic/OpenAI)
    const [llmProvider] = await db
      .select({
        providerType: providers.providerType,
        apiKeyRef: providers.apiKeyRef,
        baseUrl: providers.baseUrl,
      })
      .from(providers)
      .where(and(eq(providers.tenantId, tenantId), eq(providers.isActive, true)))
      .limit(1);

    if (llmProvider) {
      const apiKey = llmProvider.apiKeyRef
        ? (isEncrypted(llmProvider.apiKeyRef) ? decryptSecret(llmProvider.apiKeyRef) : llmProvider.apiKeyRef)
        : undefined;

      const defaultModel = llmProvider.providerType === "anthropic" ? "claude-haiku-4-20250514" : "gpt-4o-mini";

      // Enrichment caller: use contextual model, fallback to provider default
      const enrichmentModel = kb.contextualModel || defaultModel;
      llmCaller = createLLMCaller({
        providerType: llmProvider.providerType,
        model: enrichmentModel,
        apiKey,
        baseUrl: llmProvider.baseUrl || undefined,
      });

      // Graph extraction caller: use graph model if different from enrichment model
      const graphModel = kb.graphExtractionModel || defaultModel;
      if (graphModel !== enrichmentModel) {
        graphLLMCaller = createLLMCaller({
          providerType: llmProvider.providerType,
          model: graphModel,
          apiKey,
          baseUrl: llmProvider.baseUrl || undefined,
        });
      }
    }
  }

  try {
    const result = await ragProcessDocument(
      docInfo, kbConfig, store, extractor, embedder,
      llmCaller, undefined, graphLLMCaller, tenantId,
    );

    // Persist graph entities and relationships if graph extraction produced results
    if (result.graphExtractions && result.graphExtractions.length > 0) {
      await persistGraphExtractions(
        db, tenantId, doc.knowledgeBaseId, result.graphExtractions, embedder,
      );
    }

    return { chunkCount: result.chunkCount };
  } catch (e) {
    const errorMsg = (e as Error).message || "Unknown processing error";
    await db
      .update(documents)
      .set({ status: "error", errorMessage: errorMsg, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    throw e;
  }
}

/**
 * Persist graph entities and relationships extracted from document chunks.
 * Deduplicates entities by name+type within the knowledge base (upsert pattern):
 * - If entity with same name+type exists: increment mention_count, update description if richer
 * - If new: insert entity, generate embedding for name+description
 */
async function persistGraphExtractions(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  knowledgeBaseId: string,
  extractions: GraphExtractionOutput[],
  embedder: { embed(texts: string[], inputType?: "query" | "document"): Promise<number[][]> },
): Promise<void> {
  // Build a map of all entities to deduplicate across chunks
  const entityKey = (name: string, type: string) => `${name.toLowerCase()}::${type.toLowerCase()}`;
  const entityMap = new Map<string, {
    name: string;
    entityType: string;
    description: string;
    sourceChunkId: number;
    mentionCount: number;
  }>();

  // Collect all relationships with their source entity names
  const pendingRelationships: Array<{
    sourceEntity: string;
    targetEntity: string;
    relationshipType: string;
    description: string;
    sourceChunkId: number;
  }> = [];

  for (const extraction of extractions) {
    for (const entity of extraction.entities) {
      const key = entityKey(entity.name, entity.entityType);
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentionCount++;
        // Update description if the new one is longer (richer)
        if (entity.description.length > existing.description.length) {
          existing.description = entity.description;
        }
      } else {
        entityMap.set(key, {
          name: entity.name,
          entityType: entity.entityType,
          description: entity.description,
          sourceChunkId: extraction.chunkId,
          mentionCount: 1,
        });
      }
    }

    for (const rel of extraction.relationships) {
      pendingRelationships.push({
        sourceEntity: rel.source,
        targetEntity: rel.target,
        relationshipType: rel.relationshipType,
        description: rel.description,
        sourceChunkId: extraction.chunkId,
      });
    }
  }

  if (entityMap.size === 0) return;

  // Generate embeddings for entity name+description
  const entities = [...entityMap.values()];
  const entityTexts = entities.map((e) => `${e.name}: ${e.description}`);
  const entityEmbeddings = await embedder.embed(entityTexts, "document");

  // Check for existing entities in this KB (for upsert)
  const existingEntities = await db
    .select({
      id: graphEntities.id,
      name: graphEntities.name,
      entityType: graphEntities.entityType,
      mentionCount: graphEntities.mentionCount,
      description: graphEntities.description,
    })
    .from(graphEntities)
    .where(and(
      eq(graphEntities.knowledgeBaseId, knowledgeBaseId),
      eq(graphEntities.tenantId, tenantId),
    ));

  const existingEntityMap = new Map(
    existingEntities.map((e) => [entityKey(e.name, e.entityType), e]),
  );

  // Insert or update entities, collecting name -> ID mapping
  const entityIdMap = new Map<string, string>();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const key = entityKey(entity.name, entity.entityType);
    const existing = existingEntityMap.get(key);

    if (existing) {
      // Update: increment mention count, update description/embedding if richer
      const updates: Record<string, unknown> = {
        mentionCount: existing.mentionCount + entity.mentionCount,
      };
      if (entity.description.length > (existing.description?.length ?? 0)) {
        updates.description = entity.description;
        updates.embedding = entityEmbeddings[i];
      }
      await db
        .update(graphEntities)
        .set(updates)
        .where(eq(graphEntities.id, existing.id));
      entityIdMap.set(key, existing.id);
    } else {
      // Insert new entity
      const [inserted] = await db
        .insert(graphEntities)
        .values({
          tenantId,
          knowledgeBaseId,
          sourceChunkId: entity.sourceChunkId,
          name: entity.name,
          entityType: entity.entityType,
          description: entity.description,
          embedding: entityEmbeddings[i],
          mentionCount: entity.mentionCount,
        })
        .returning({ id: graphEntities.id });
      entityIdMap.set(key, inserted.id);
    }
  }

  // Build a reverse lookup Map keyed by lowercase entity name for O(1) relationship resolution
  const nameToKey = new Map<string, string>();
  for (const key of entityMap.keys()) {
    const name = key.split("::")[0];
    nameToKey.set(name, key);
  }

  // Insert relationships (only if both source and target entities exist)
  for (const rel of pendingRelationships) {
    // Find entity IDs by name (case-insensitive O(1) lookup)
    const sourceKey = nameToKey.get(rel.sourceEntity.toLowerCase());
    const targetKey = nameToKey.get(rel.targetEntity.toLowerCase());

    const sourceId = sourceKey ? entityIdMap.get(sourceKey) : undefined;
    const targetId = targetKey ? entityIdMap.get(targetKey) : undefined;

    if (sourceId && targetId) {
      await db.insert(graphRelationships).values({
        tenantId,
        knowledgeBaseId,
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        relationshipType: rel.relationshipType,
        description: rel.description,
        weight: 1.0,
        sourceChunkId: rel.sourceChunkId,
      });
    }
  }
}
