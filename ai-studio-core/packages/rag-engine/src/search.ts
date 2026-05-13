import { rrfFuse } from "./rrf";
import type { RankedItem } from "./types";
import type { SearchStore, Embedder, Reranker, SearchOptions, SearchResult } from "./interfaces";

export async function searchKnowledge(
  query: string,
  agentId: string,
  tenantId: string,
  store: SearchStore,
  embedder: Embedder,
  reranker?: Reranker,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const topK = options.topK || 5;
  const threshold = options.similarityThreshold || 0.3;
  const retrieveCount = topK * 4;

  const agentKBs = await store.getAgentKBs(agentId, tenantId);
  if (agentKBs.length === 0) return [];

  const kbIds = agentKBs.map((kb) => kb.knowledgeBaseId);
  const kbNameMap = new Map(agentKBs.map((kb) => [kb.knowledgeBaseId, kb.kbName]));

  const queryEmbedding = await embedder.embedSingle(query, "query");

  const [vectorHits, bm25Hits] = await Promise.all([
    store.vectorSearch(queryEmbedding, tenantId, kbIds, retrieveCount, threshold),
    store.bm25Search(query, tenantId, kbIds, retrieveCount),
  ]);

  const toRankedItem = (hit: typeof vectorHits[0], source: "vector" | "bm25"): RankedItem => ({
    id: hit.id,
    content: hit.content,
    score: hit.score,
    source,
    metadata: {
      fileName: hit.fileName,
      kbId: hit.knowledgeBaseId,
      chunkIndex: hit.chunkIndex,
      chunkType: hit.chunkType,
      parentChunkId: hit.parentChunkId,
    },
  });

  const vectorItems = vectorHits.map((h) => toRankedItem(h, "vector"));
  const bm25Items = bm25Hits.map((h) => toRankedItem(h, "bm25"));

  if (vectorItems.length === 0 && bm25Items.length === 0) return [];

  let candidates = rrfFuse(vectorItems, bm25Items);

  if (reranker) {
    const rerankCandidates = candidates.slice(0, topK * 3);
    const docs = rerankCandidates.map((c) => c.content);
    const rerankResults = await reranker.rerank(query, docs, topK);
    candidates = rerankResults.map((rr) => ({
      ...rerankCandidates[rr.index],
      rrfScore: rr.score,
    }));
  }

  const finalCandidates = candidates.slice(0, topK);

  const parentIds = finalCandidates
    .map((c) => (c.metadata as Record<string, unknown>)?.parentChunkId as number | null)
    .filter((id): id is number => id !== null);

  const parentContentMap = parentIds.length > 0
    ? await store.getParentChunks(parentIds)
    : new Map<number, string>();

  return finalCandidates.map((item) => {
    const meta = item.metadata as {
      fileName: string; kbId: string; chunkIndex: number;
      chunkType: string; parentChunkId: number | null;
    };

    let source: "vector" | "bm25" | "hybrid" = "hybrid";
    if (item.vectorRank !== null && item.bm25Rank === null) source = "vector";
    if (item.vectorRank === null && item.bm25Rank !== null) source = "bm25";

    const content = meta.parentChunkId && parentContentMap.has(meta.parentChunkId)
      ? parentContentMap.get(meta.parentChunkId)!
      : item.content;

    return {
      content,
      score: item.rrfScore,
      documentName: meta.fileName,
      knowledgeBaseName: kbNameMap.get(meta.kbId) || "Unknown",
      chunkIndex: meta.chunkIndex,
      source,
    };
  });
}
