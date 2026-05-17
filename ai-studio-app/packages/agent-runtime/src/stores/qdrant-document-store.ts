import { getQdrantClient, CHUNKS_COLLECTION } from "./qdrant-client";
import { DrizzleDocumentStore } from "./drizzle-document-store";
import type { DocumentStore, ChunkRecord } from "@ais/rag-engine";

/**
 * Dual-write document store: PostgreSQL for text/BM25/metadata, Qdrant for embeddings.
 *
 * Write path:
 * 1. Insert chunks into PostgreSQL first (source of truth — generates bigserial IDs)
 * 2. Upsert embeddings to Qdrant using those PG IDs as point IDs
 *
 * Parent chunks (embedding is null) are skipped for Qdrant — they are text-only
 * containers used for parent-child retrieval and only live in PostgreSQL.
 */
export class QdrantDocumentStore implements DocumentStore {
  private drizzle: DrizzleDocumentStore;

  constructor(tenantId: string) {
    this.drizzle = new DrizzleDocumentStore(tenantId);
  }

  async insertChunks(tenantId: string, chunks: ChunkRecord[]): Promise<number[]> {
    // Step 1: PostgreSQL insert (text, BM25 tsvector, metadata)
    const ids = await this.drizzle.insertChunks(tenantId, chunks);

    // Step 2: Upsert embeddings to Qdrant (skip parent chunks with null embedding)
    const qdrant = getQdrantClient();
    const BATCH = 50;

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batchChunks = chunks.slice(i, i + BATCH);
      const batchIds = ids.slice(i, i + BATCH);

      const points: Array<{
        id: number;
        vector: Record<string, number[]>;
        payload: Record<string, unknown>;
      }> = [];

      for (let j = 0; j < batchChunks.length; j++) {
        const chunk = batchChunks[j];
        if (!chunk.embedding || chunk.chunkType === "parent") continue;

        const vectorName = `dim_${chunk.embedding.length}`;
        points.push({
          id: batchIds[j],
          vector: { [vectorName]: chunk.embedding },
          payload: {
            tenant_id: tenantId,
            knowledge_base_id: chunk.metadata.knowledgeBaseId ?? null,
            document_id: chunk.documentId,
            chunk_type: chunk.chunkType,
            chunk_index: chunk.chunkIndex,
            parent_chunk_id: chunk.parentChunkId ?? null,
            content: chunk.content,
            file_name: (chunk.metadata.fileName as string) ?? "",
          },
        });
      }

      if (points.length > 0) {
        await qdrant.upsert(CHUNKS_COLLECTION, { wait: true, points });
      }
    }

    return ids;
  }

  async deleteChunks(documentId: string): Promise<void> {
    // Delete from PostgreSQL first
    await this.drizzle.deleteChunks(documentId);

    // Delete from Qdrant by document_id filter
    const qdrant = getQdrantClient();
    await qdrant.delete(CHUNKS_COLLECTION, {
      wait: true,
      filter: {
        must: [{ key: "document_id", match: { value: documentId } }],
      },
    });
  }

  async updateDocumentStatus(documentId: string, status: string, chunkCount: number): Promise<void> {
    // Document metadata lives exclusively in PostgreSQL
    return this.drizzle.updateDocumentStatus(documentId, status, chunkCount);
  }

  async updateKBChunkCount(knowledgeBaseId: string): Promise<void> {
    // KB aggregate counts live exclusively in PostgreSQL
    return this.drizzle.updateKBChunkCount(knowledgeBaseId);
  }
}
