/**
 * GraphRAG Query Expansion
 *
 * At search time, expands results by finding entities whose embeddings are
 * similar to the query embedding, then traversing 1-hop relationships to
 * find connected entities and their source chunks. These graph-expanded
 * chunks are added to the candidate pool with a low base score so RRF
 * will boost them if they are also found by vector/BM25 search.
 */

import type { Embedder } from "./interfaces";

export interface GraphSearchStore {
  findEntitiesByEmbedding(
    embedding: number[],
    kbIds: string[],
    tenantId: string,
    limit: number,
    threshold: number,
  ): Promise<Array<{ id: string; name: string; sourceChunkId: number }>>;

  findConnectedEntities(
    entityIds: string[],
    tenantId: string,
  ): Promise<Array<{ entityId: string; sourceChunkId: number }>>;

  getChunksByIds(
    chunkIds: number[],
    tenantId: string,
  ): Promise<Array<{ id: number; content: string; metadata: Record<string, unknown> }>>;
}

/**
 * Expand search results via graph entity relationships.
 *
 * Steps:
 * 1. Embed the query
 * 2. Find entities whose embedding is similar (threshold 0.5, limit 10)
 * 3. Expand to 1-hop connected entities via relationships
 * 4. Collect unique chunk IDs from matched + connected entities
 * 5. Fetch chunk content
 * 6. Return with a base score of 0.01 (low — RRF will boost if also found by vector/BM25)
 */
export async function graphExpand(
  query: string,
  kbIds: string[],
  tenantId: string,
  embedder: Embedder,
  store: GraphSearchStore,
): Promise<Array<{ id: number; content: string; score: number }>> {
  // 1. Embed the query
  const queryEmbedding = await embedder.embedSingle(query, "query");

  // 2. Find entities whose embedding is similar
  const matchedEntities = await store.findEntitiesByEmbedding(
    queryEmbedding,
    kbIds,
    tenantId,
    10,
    0.5,
  );

  if (matchedEntities.length === 0) {
    return [];
  }

  // 3. Expand to 1-hop connected entities via relationships
  const entityIds = matchedEntities.map((e) => e.id);
  const connectedEntities = await store.findConnectedEntities(entityIds, tenantId);

  // 4. Collect unique chunk IDs from matched + connected entities
  const chunkIds = new Set<number>();
  for (const entity of matchedEntities) {
    chunkIds.add(entity.sourceChunkId);
  }
  for (const connected of connectedEntities) {
    chunkIds.add(connected.sourceChunkId);
  }

  if (chunkIds.size === 0) {
    return [];
  }

  // 5. Fetch chunk content
  const chunks = await store.getChunksByIds([...chunkIds], tenantId);

  // 6. Return with a base score of 0.01
  return chunks.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    score: 0.01,
  }));
}
