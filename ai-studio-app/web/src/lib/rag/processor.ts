import { getDb } from "@ais-app/database";
import { documents, knowledgeBases, providers } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { processDocument as ragProcessDocument, type KBConfig, type DocumentInfo } from "@ais/rag-engine";
import { DrizzleDocumentStore } from "@ais-app/agent-runtime/src/stores/drizzle-document-store";
import { createTextExtractor } from "./text-extractor";
import { createEmbedder, buildEmbeddingConfig } from "./embedder";
import type { ChunkConfig } from "@ais/rag-engine";

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

  const kbConfig: KBConfig = {
    chunkConfig: (kb.chunkConfig || {}) as ChunkConfig,
    embeddingSource: kb.embeddingSource,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
    rerankSource: kb.rerankSource,
    rerankModel: kb.rerankModel,
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

  try {
    return await ragProcessDocument(docInfo, kbConfig, store, extractor, embedder);
  } catch (e) {
    const errorMsg = (e as Error).message || "Unknown processing error";
    await db
      .update(documents)
      .set({ status: "error", errorMessage: errorMsg, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    throw e;
  }
}
