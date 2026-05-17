import { getQdrantClient, CHUNKS_COLLECTION } from "./qdrant-client";
import { DrizzleSearchStore } from "./drizzle-search-store";
import type { SearchStore, SearchHit, AgentKBInfo } from "@ais/rag-engine";

/**
 * Hybrid search store: vector search via Qdrant, BM25 + relational queries via PostgreSQL.
 *
 * Qdrant stores only embeddings + minimal payload for filtering.
 * PostgreSQL retains full-text content, tsvector BM25, and relational data.
 * After Qdrant returns matching point IDs + scores, we fetch full content from PG.
 */
export class QdrantSearchStore implements SearchStore {
  private drizzle = new DrizzleSearchStore();

  async getAgentKBs(agentId: string, tenantId: string): Promise<AgentKBInfo[]> {
    return this.drizzle.getAgentKBs(agentId, tenantId);
  }

  async vectorSearch(
    embedding: number[],
    tenantId: string,
    kbIds: string[],
    limit: number,
    threshold: number,
  ): Promise<SearchHit[]> {
    const qdrant = getQdrantClient();
    const vectorName = `dim_${embedding.length}`;

    const results = await qdrant.search(CHUNKS_COLLECTION, {
      vector: { name: vectorName, vector: embedding },
      filter: {
        must: [
          { key: "tenant_id", match: { value: tenantId } },
          { key: "knowledge_base_id", match: { any: kbIds } },
          { key: "chunk_type", match: { except: ["parent"] } },
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
        id: typeof r.id === "number" ? r.id : parseInt(String(r.id), 10),
        content: (p?.content as string) || "",
        chunkIndex: (p?.chunk_index as number) ?? 0,
        chunkType: (p?.chunk_type as string) || "standard",
        parentChunkId: (p?.parent_chunk_id as number | null) ?? null,
        fileName: (p?.file_name as string) || "",
        knowledgeBaseId: (p?.knowledge_base_id as string) || "",
        score: r.score,
      };
    });
  }

  async bm25Search(
    query: string,
    tenantId: string,
    kbIds: string[],
    limit: number,
  ): Promise<SearchHit[]> {
    // BM25 stays on PostgreSQL — tsvector is not stored in Qdrant
    return this.drizzle.bm25Search(query, tenantId, kbIds, limit);
  }

  async getParentChunks(ids: number[], tenantId: string): Promise<Map<number, string>> {
    // Parent chunk text is PostgreSQL-only
    return this.drizzle.getParentChunks(ids, tenantId);
  }
}
