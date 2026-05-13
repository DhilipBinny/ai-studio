import { getDb } from "@ais-app/database";
import { documents, documentChunks, knowledgeBases, providers } from "@ais-app/database";
import { eq, and, sql } from "drizzle-orm";
import { extractText } from "./text-extractor";
import { chunkText, type ChunkConfig } from "./chunker";
import { generateEmbeddings, buildEmbeddingConfig } from "./embedder";

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

  await db
    .update(documents)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    const kbRows = await db
      .select({
        chunkConfig: knowledgeBases.chunkConfig,
        embeddingModel: knowledgeBases.embeddingModel,
        embeddingDimension: knowledgeBases.embeddingDimension,
        embeddingSource: knowledgeBases.embeddingSource,
        embeddingProviderId: knowledgeBases.embeddingProviderId,
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

    const chunkConfig = (kb.chunkConfig || {}) as ChunkConfig;
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

    const text = await extractText(doc.storagePath, doc.fileType);
    if (!text.trim()) throw new Error("No text could be extracted from the document");

    const chunks = chunkText(text, chunkConfig);
    if (chunks.length === 0) throw new Error("Document produced no chunks after processing");

    const chunkTexts = chunks.map((c) => c.content);
    const embeddings = await generateEmbeddings(chunkTexts, embeddingConfig);

    await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));

    const BATCH_INSERT = 50;
    for (let i = 0; i < chunks.length; i += BATCH_INSERT) {
      const batch = chunks.slice(i, i + BATCH_INSERT);
      await db.insert(documentChunks).values(
        batch.map((chunk, j) => ({
          tenantId,
          documentId,
          chunkIndex: chunk.index,
          content: chunk.content,
          embedding: embeddings[i + j],
          tokenCount: chunk.tokenCount,
          metadata: {
            fileName: doc.fileName,
            fileType: doc.fileType,
            chunkSize: chunkConfig.chunk_size || 2048,
          },
        })),
      );
    }

    await db
      .update(documents)
      .set({
        status: "ready",
        chunkCount: chunks.length,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const [{ totalChunks }] = await db
      .select({ totalChunks: sql<number>`COALESCE(SUM(${documents.chunkCount}), 0)::int` })
      .from(documents)
      .where(and(eq(documents.knowledgeBaseId, doc.knowledgeBaseId), eq(documents.status, "ready")));

    await db
      .update(knowledgeBases)
      .set({ chunkCount: totalChunks, updatedAt: new Date() })
      .where(eq(knowledgeBases.id, doc.knowledgeBaseId));

    return { chunkCount: chunks.length };
  } catch (e) {
    const errorMsg = (e as Error).message || "Unknown processing error";
    await db
      .update(documents)
      .set({
        status: "error",
        errorMessage: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    throw e;
  }
}
