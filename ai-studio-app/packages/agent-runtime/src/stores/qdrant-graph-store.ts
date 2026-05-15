import { getQdrantClient, ENTITIES_COLLECTION } from "./qdrant-client";
import { DrizzleGraphStore } from "./drizzle-graph-store";
import type { GraphSearchStore } from "@ais/rag-engine";

/**
 * Hybrid graph store: entity vector search via Qdrant, relationship traversal via PostgreSQL.
 *
 * Qdrant stores entity embeddings for fast similarity search.
 * PostgreSQL retains the graph structure (entities, relationships) and chunk text.
 */
export class QdrantGraphStore implements GraphSearchStore {
  private drizzle = new DrizzleGraphStore();

  async findEntitiesByEmbedding(
    embedding: number[],
    kbIds: string[],
    tenantId: string,
    limit: number,
    threshold: number,
  ): Promise<Array<{ id: string; name: string; sourceChunkId: number }>> {
    const qdrant = getQdrantClient();
    const vectorName = `dim_${embedding.length}`;

    const results = await qdrant.search(ENTITIES_COLLECTION, {
      vector: { name: vectorName, vector: embedding },
      filter: {
        must: [
          { key: "tenant_id", match: { value: tenantId } },
          { key: "knowledge_base_id", match: { any: kbIds } },
        ],
      },
      limit,
      score_threshold: threshold,
      with_payload: true,
      with_vector: false,
    });

    return results.map((r) => {
      const p = r.payload as Record<string, unknown> | null;
      return {
        id: String(r.id),
        name: (p?.name as string) || "",
        sourceChunkId: (p?.source_chunk_id as number) ?? 0,
      };
    });
  }

  async findConnectedEntities(
    entityIds: string[],
    tenantId: string,
  ): Promise<Array<{ entityId: string; sourceChunkId: number }>> {
    // Graph relationships are relational — stay in PostgreSQL
    return this.drizzle.findConnectedEntities(entityIds, tenantId);
  }

  async getChunksByIds(
    chunkIds: number[],
    tenantId: string,
  ): Promise<Array<{ id: number; content: string; metadata: Record<string, unknown> }>> {
    // Chunk text content lives in PostgreSQL
    return this.drizzle.getChunksByIds(chunkIds, tenantId);
  }
}
