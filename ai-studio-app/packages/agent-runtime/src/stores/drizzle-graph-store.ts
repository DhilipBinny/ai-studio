import { getDb } from "@ais-app/database";
import { graphEntities, graphRelationships, documentChunks } from "@ais-app/database";
import { sql, inArray } from "drizzle-orm";
import type { GraphSearchStore } from "@ais/rag-engine";

export class DrizzleGraphStore implements GraphSearchStore {
  /**
   * Find entities whose embedding is similar to the given embedding vector.
   * Uses pgvector cosine distance (<=>) operator.
   */
  async findEntitiesByEmbedding(
    embedding: number[],
    kbIds: string[],
    tenantId: string,
    limit: number,
    threshold: number,
  ): Promise<Array<{ id: string; name: string; sourceChunkId: number }>> {
    const db = getDb();
    const embeddingStr = `[${embedding.join(",")}]`;
    const kbIdsSql = sql.join(kbIds.map((id) => sql`${id}`), sql`, `);

    const results = await db.execute(sql`
      SELECT ge.id, ge.name, ge.source_chunk_id,
             1 - (ge.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM graph_entities ge
      WHERE ge.tenant_id = ${tenantId}
        AND ge.knowledge_base_id IN (${kbIdsSql})
        AND ge.embedding IS NOT NULL
        AND 1 - (ge.embedding <=> ${embeddingStr}::vector) > ${threshold}
      ORDER BY ge.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);

    return ([...results] as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      sourceChunkId: Number(r.source_chunk_id),
    }));
  }

  /**
   * Find entities connected to the given entity IDs via relationships.
   * Looks in both directions (source -> target and target -> source).
   */
  async findConnectedEntities(
    entityIds: string[],
  ): Promise<Array<{ entityId: string; sourceChunkId: number }>> {
    if (entityIds.length === 0) return [];

    const db = getDb();
    const idsSql = sql.join(entityIds.map((id) => sql`${id}`), sql`, `);

    const results = await db.execute(sql`
      SELECT DISTINCT target_entity_id AS entity_id, source_chunk_id
      FROM graph_relationships
      WHERE source_entity_id IN (${idsSql})
      UNION
      SELECT DISTINCT source_entity_id AS entity_id, source_chunk_id
      FROM graph_relationships
      WHERE target_entity_id IN (${idsSql})
    `);

    return ([...results] as Array<Record<string, unknown>>).map((r) => ({
      entityId: r.entity_id as string,
      sourceChunkId: Number(r.source_chunk_id),
    }));
  }

  /**
   * Fetch chunks by their IDs from document_chunks.
   */
  async getChunksByIds(
    chunkIds: number[],
  ): Promise<Array<{ id: number; content: string; metadata: Record<string, unknown> }>> {
    if (chunkIds.length === 0) return [];

    const db = getDb();
    const rows = await db
      .select({
        id: documentChunks.id,
        content: documentChunks.content,
        metadata: documentChunks.metadata,
      })
      .from(documentChunks)
      .where(inArray(documentChunks.id, chunkIds));

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: r.metadata as Record<string, unknown>,
    }));
  }
}
