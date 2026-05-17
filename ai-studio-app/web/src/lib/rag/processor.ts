import { getDb } from "@ais-app/database";
import { documents, knowledgeBases, providers, graphEntities, graphRelationships } from "@ais-app/database";
import { eq, and, sql } from "drizzle-orm";
import { processDocument as ragProcessDocument, type KBConfig, type DocumentInfo, type LLMCaller, type GraphExtractionOutput } from "@ais/rag-engine";
import { DrizzleDocumentStore } from "@ais-app/agent-runtime/src/stores/drizzle-document-store";
import { QdrantDocumentStore } from "@ais-app/agent-runtime/src/stores/qdrant-document-store";
import { createTextExtractor } from "./text-extractor";
import { createEmbedder, buildEmbeddingConfig } from "./embedder";
import type { ChunkConfig } from "@ais/rag-engine";
import { createLLMCaller } from "./llm-caller";
import { decryptSecret, isEncrypted } from "@ais-app/auth";

// ---------------------------------------------------------------------------
// processDocument helper: Load KB config from DB
// ---------------------------------------------------------------------------

async function loadKnowledgeBaseConfig(documentId: string, tenantId: string) {
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

  return { doc, kb };
}

// ---------------------------------------------------------------------------
// processDocument helper: Create processing dependencies (embedder, LLM callers)
// ---------------------------------------------------------------------------

async function createProcessingDependencies(
  kb: Awaited<ReturnType<typeof loadKnowledgeBaseConfig>>["kb"],
  kbConfig: KBConfig,
  tenantId: string,
) {
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

  const useQdrant = process.env.VECTOR_DB === "qdrant";
  const store = useQdrant ? new QdrantDocumentStore(tenantId) : new DrizzleDocumentStore(tenantId);
  const extractor = createTextExtractor();
  const embedder = createEmbedder(embeddingConfig);

  const enrichmentMode = kbConfig.contextualEnrichment;

  // Create LLM callers for contextual enrichment and/or graph extraction
  const needsLLM = enrichmentMode === "llm" || kbConfig.graphExtraction;
  let llmCaller: LLMCaller | undefined;
  let graphLLMCaller: LLMCaller | undefined;
  if (needsLLM) {
    const db = getDb();
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

  return { store, extractor, embedder, llmCaller, graphLLMCaller };
}

// ---------------------------------------------------------------------------
// Main: processDocument
// ---------------------------------------------------------------------------

export async function processDocument(
  documentId: string,
  tenantId: string,
): Promise<{ chunkCount: number }> {
  const db = getDb();
  const { doc, kb } = await loadKnowledgeBaseConfig(documentId, tenantId);

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

  const { store, extractor, embedder, llmCaller, graphLLMCaller } = await createProcessingDependencies(kb, kbConfig, tenantId);

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

// ---------------------------------------------------------------------------
// persistGraphExtractions helper: Deduplicate entities
// ---------------------------------------------------------------------------

function deduplicateEntities(extractions: GraphExtractionOutput[]) {
  const entityKey = (name: string, type: string) => `${name.toLowerCase()}::${type.toLowerCase()}`;
  const entityMap = new Map<string, {
    name: string;
    entityType: string;
    description: string;
    sourceChunkId: number;
    mentionCount: number;
  }>();

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

  return { entityMap, pendingRelationships, entityKey };
}

// ---------------------------------------------------------------------------
// persistGraphExtractions helper: Upsert entities to DB
// ---------------------------------------------------------------------------

async function upsertEntities(
  db: ReturnType<typeof getDb>,
  entityMap: Map<string, { name: string; entityType: string; description: string; sourceChunkId: number; mentionCount: number }>,
  entityKey: (name: string, type: string) => string,
  entityEmbeddings: number[][],
  tenantId: string,
  knowledgeBaseId: string,
): Promise<Map<string, string>> {
  const entities = [...entityMap.values()];

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

  // Separate entities into those needing update vs insert
  const entitiesToUpdate: Array<{ id: string; mentionCount: number; description?: string; embedding?: number[] }> = [];
  const entitiesToInsert: Array<{
    tenantId: string;
    knowledgeBaseId: string;
    sourceChunkId: number;
    name: string;
    entityType: string;
    description: string;
    embedding: number[];
    mentionCount: number;
  }> = [];
  const insertKeys: string[] = [];

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const key = entityKey(entity.name, entity.entityType);
    const existing = existingEntityMap.get(key);

    if (existing) {
      const update: { id: string; mentionCount: number; description?: string; embedding?: number[] } = {
        id: existing.id,
        mentionCount: existing.mentionCount + entity.mentionCount,
      };
      if (entity.description.length > (existing.description?.length ?? 0)) {
        update.description = entity.description;
        update.embedding = entityEmbeddings[i];
      }
      entitiesToUpdate.push(update);
      entityIdMap.set(key, existing.id);
    } else {
      entitiesToInsert.push({
        tenantId,
        knowledgeBaseId,
        sourceChunkId: entity.sourceChunkId,
        name: entity.name,
        entityType: entity.entityType,
        description: entity.description,
        embedding: entityEmbeddings[i],
        mentionCount: entity.mentionCount,
      });
      insertKeys.push(key);
    }
  }

  // Batch update existing entities
  for (const update of entitiesToUpdate) {
    const sets: Record<string, unknown> = { mentionCount: update.mentionCount };
    if (update.description !== undefined) {
      sets.description = update.description;
      sets.embedding = update.embedding;
    }
    await db.update(graphEntities).set(sets).where(eq(graphEntities.id, update.id));
  }

  // Batch insert new entities
  if (entitiesToInsert.length > 0) {
    const insertedRows = await db
      .insert(graphEntities)
      .values(entitiesToInsert)
      .returning({ id: graphEntities.id });
    for (let i = 0; i < insertedRows.length; i++) {
      entityIdMap.set(insertKeys[i], insertedRows[i].id);
    }
  }

  return entityIdMap;
}

// ---------------------------------------------------------------------------
// persistGraphExtractions helper: Insert relationships to DB
// ---------------------------------------------------------------------------

async function insertRelationships(
  db: ReturnType<typeof getDb>,
  pendingRelationships: Array<{ sourceEntity: string; targetEntity: string; relationshipType: string; description: string; sourceChunkId: number }>,
  entityMap: Map<string, unknown>,
  entityIdMap: Map<string, string>,
  tenantId: string,
  knowledgeBaseId: string,
): Promise<void> {
  // Build a reverse lookup Map keyed by lowercase entity name for O(1) relationship resolution
  const nameToKey = new Map<string, string>();
  for (const key of entityMap.keys()) {
    const name = key.split("::")[0];
    nameToKey.set(name, key);
  }

  // Batch insert relationships (only if both source and target entities exist)
  const allRelationships: Array<{
    tenantId: string;
    knowledgeBaseId: string;
    sourceEntityId: string;
    targetEntityId: string;
    relationshipType: string;
    description: string;
    weight: number;
    sourceChunkId: number;
  }> = [];

  for (const rel of pendingRelationships) {
    const sourceKey = nameToKey.get(rel.sourceEntity.toLowerCase());
    const targetKey = nameToKey.get(rel.targetEntity.toLowerCase());

    const sourceId = sourceKey ? entityIdMap.get(sourceKey) : undefined;
    const targetId = targetKey ? entityIdMap.get(targetKey) : undefined;

    if (sourceId && targetId) {
      allRelationships.push({
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

  if (allRelationships.length > 0) {
    await db.insert(graphRelationships).values(allRelationships);
  }
}

// ---------------------------------------------------------------------------
// persistGraphExtractions (orchestrator)
// ---------------------------------------------------------------------------

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
  const { entityMap, pendingRelationships, entityKey } = deduplicateEntities(extractions);

  if (entityMap.size === 0) return;

  // Generate embeddings for entity name+description
  const entities = [...entityMap.values()];
  const entityTexts = entities.map((e) => `${e.name}: ${e.description}`);
  const entityEmbeddings = await embedder.embed(entityTexts, "document");

  const entityIdMap = await upsertEntities(db, entityMap, entityKey, entityEmbeddings, tenantId, knowledgeBaseId);

  await insertRelationships(db, pendingRelationships, entityMap, entityIdMap, tenantId, knowledgeBaseId);
}
