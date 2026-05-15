import { getDb } from "@ais-app/database";
import { documents, documentChunks, knowledgeBases } from "@ais-app/database";
import { eq, and, sql } from "drizzle-orm";
import type { DocumentStore, ChunkRecord } from "@ais/rag-engine";

export class DrizzleDocumentStore implements DocumentStore {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async deleteChunks(documentId: string): Promise<void> {
    const db = getDb();
    await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  }

  async insertChunks(_tenantId: string, chunks: ChunkRecord[]): Promise<number[]> {
    const db = getDb();
    const ids: number[] = [];
    const BATCH = 50;

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const inserted = await db.insert(documentChunks).values(
        batch.map((c) => ({
          tenantId: this.tenantId,
          documentId: c.documentId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          embedding: c.embedding,
          chunkType: c.chunkType,
          parentChunkId: c.parentChunkId ?? null,
          tokenCount: c.tokenCount,
          metadata: c.metadata,
          contextualDescription: c.contextualDescription ?? null,
        })),
      ).returning({ id: documentChunks.id });
      ids.push(...inserted.map((r) => r.id));
    }

    return ids;
  }

  async updateDocumentStatus(documentId: string, status: string, chunkCount: number): Promise<void> {
    const db = getDb();
    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "ready") {
      updates.chunkCount = chunkCount;
      updates.processedAt = new Date();
    }
    if (status === "error") {
      updates.errorMessage = "Processing failed";
    }
    await db.update(documents).set(updates).where(eq(documents.id, documentId));
  }

  async updateKBChunkCount(knowledgeBaseId: string): Promise<void> {
    const db = getDb();
    const [{ totalChunks }] = await db
      .select({ totalChunks: sql<number>`COALESCE(SUM(${documents.chunkCount}), 0)::int` })
      .from(documents)
      .where(and(eq(documents.knowledgeBaseId, knowledgeBaseId), eq(documents.status, "ready")));

    await db
      .update(knowledgeBases)
      .set({ chunkCount: totalChunks, updatedAt: new Date() })
      .where(eq(knowledgeBases.id, knowledgeBaseId));
  }
}
