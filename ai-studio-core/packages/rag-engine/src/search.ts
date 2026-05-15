import { rrfFuse } from "./rrf";
import type { RankedItem, RRFResult } from "./types";
import type { SearchStore, Embedder, Reranker, SearchOptions, SearchResult } from "./interfaces";
import { hydeExpand, type HyDEConfig, type LLMCaller } from "./hyde";
import { decomposeQuery } from "./query-decomposition";
import { mergeDecomposedResults } from "./merge-results";
import { graphExpand, type GraphSearchStore } from "./graph-search";

export interface DecompositionOptions {
  decompositionEnabled?: boolean;
}

export interface GraphSearchOptions {
  enabled: boolean;
  graphStore: GraphSearchStore;
}

export async function searchKnowledge(
  query: string,
  agentId: string,
  tenantId: string,
  store: SearchStore,
  embedder: Embedder,
  reranker?: Reranker,
  options: SearchOptions = {},
  hydeConfig?: HyDEConfig,
  llmCaller?: LLMCaller,
  decompositionOptions?: DecompositionOptions,
  graphSearchOptions?: GraphSearchOptions,
): Promise<SearchResult[]> {
  const topK = options.topK || 5;
  const threshold = options.similarityThreshold || 0.3;

  const agentKBs = await store.getAgentKBs(agentId, tenantId);
  if (agentKBs.length === 0) return [];

  const kbIds = agentKBs.map((kb) => kb.knowledgeBaseId);
  const kbNameMap = new Map(agentKBs.map((kb) => [kb.knowledgeBaseId, kb.kbName]));

  // Query decomposition: if enabled, split into sub-queries and search each independently
  if (decompositionOptions?.decompositionEnabled && llmCaller) {
    const decomposition = await decomposeQuery(query, llmCaller);

    if (decomposition.shouldDecompose && decomposition.subQueries.length > 1) {
      const subQueryResults = await Promise.all(
        decomposition.subQueries.map((subQuery) =>
          runSingleQuerySearch(
            subQuery, kbIds, tenantId, store, embedder, topK, threshold, hydeConfig, llmCaller,
          ),
        ),
      );

      let candidates = mergeDecomposedResults(subQueryResults);

      // Graph expansion: add graph-expanded chunks to candidate pool
      if (graphSearchOptions?.enabled) {
        candidates = await applyGraphExpansion(
          query, kbIds, tenantId, embedder, graphSearchOptions.graphStore, candidates,
        );
      }

      // Rerank the merged set
      if (reranker) {
        const rerankCandidates = candidates.slice(0, topK * 3);
        const docs = rerankCandidates.map((c) => c.content);
        const rerankResults = await reranker.rerank(query, docs, topK);
        candidates = rerankResults.map((rr) => ({
          ...rerankCandidates[rr.index],
          rrfScore: rr.score,
        }));
      }

      return buildSearchResults(candidates.slice(0, topK), kbNameMap, store, tenantId);
    }
  }

  // Single-query path (original or decomposition returned shouldDecompose=false)
  let candidates = await runSingleQuerySearch(
    query, kbIds, tenantId, store, embedder, topK, threshold, hydeConfig, llmCaller,
  );

  // Graph expansion: add graph-expanded chunks to candidate pool
  if (graphSearchOptions?.enabled) {
    candidates = await applyGraphExpansion(
      query, kbIds, tenantId, embedder, graphSearchOptions.graphStore, candidates,
    );
  }

  let finalCandidates = candidates;

  if (reranker) {
    const rerankCandidates = finalCandidates.slice(0, topK * 3);
    const docs = rerankCandidates.map((c) => c.content);
    const rerankResults = await reranker.rerank(query, docs, topK);
    finalCandidates = rerankResults.map((rr) => ({
      ...rerankCandidates[rr.index],
      rrfScore: rr.score,
    }));
  }

  return buildSearchResults(finalCandidates.slice(0, topK), kbNameMap, store, tenantId);
}

/**
 * Run the core search pipeline for a single query: HyDE expand -> embed -> vector+BM25 -> RRF fuse.
 * Returns raw RRF candidates (no reranking, no parent expansion, no topK limit).
 */
async function runSingleQuerySearch(
  query: string,
  kbIds: string[],
  tenantId: string,
  store: SearchStore,
  embedder: Embedder,
  topK: number,
  threshold: number,
  hydeConfig?: HyDEConfig,
  llmCaller?: LLMCaller,
): Promise<RRFResult[]> {
  const retrieveCount = topK * 4;

  // HyDE: generate hypothetical answer for vector search if enabled
  let queryForEmbedding = query;
  if (hydeConfig?.enabled && llmCaller) {
    queryForEmbedding = await hydeExpand(query, llmCaller);
  }

  const queryEmbedding = await embedder.embedSingle(queryForEmbedding, "query");

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

  return rrfFuse(vectorItems, bm25Items);
}

/**
 * Convert RRF candidates to SearchResult[], expanding parent chunks as needed.
 */
async function buildSearchResults(
  candidates: RRFResult[],
  kbNameMap: Map<string, string>,
  store: SearchStore,
  tenantId: string,
): Promise<SearchResult[]> {
  const parentIds = candidates
    .map((c) => (c.metadata as Record<string, unknown>)?.parentChunkId as number | null)
    .filter((id): id is number => id !== null);

  const parentContentMap = parentIds.length > 0
    ? await store.getParentChunks(parentIds, tenantId)
    : new Map<number, string>();

  return candidates.map((item) => {
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
      chunkId: typeof item.id === "number" ? item.id : undefined,
      source,
    };
  });
}

/**
 * Merge graph-expanded chunks into the existing RRF candidates.
 * For chunks already in candidates, boost their score by 10%.
 * For new graph chunks, append with a low base score (0.01).
 * This preserves existing RRF scores instead of resetting them via re-fusion.
 */
async function applyGraphExpansion(
  query: string,
  kbIds: string[],
  tenantId: string,
  embedder: Embedder,
  graphStore: GraphSearchStore,
  existingCandidates: RRFResult[],
): Promise<RRFResult[]> {
  try {
    const graphResults = await graphExpand(query, kbIds, tenantId, embedder, graphStore);

    if (graphResults.length === 0) {
      return existingCandidates;
    }

    // Build a set of existing candidate IDs for fast lookup
    const candidateMap = new Map<string | number, number>();
    for (let i = 0; i < existingCandidates.length; i++) {
      candidateMap.set(existingCandidates[i].id, i);
    }

    // Merge: boost existing candidates, append new ones
    const merged = [...existingCandidates];
    for (const graphChunk of graphResults) {
      const existingIdx = candidateMap.get(graphChunk.id);
      if (existingIdx !== undefined) {
        // Boost existing candidate's score by 10%
        merged[existingIdx] = {
          ...merged[existingIdx],
          rrfScore: merged[existingIdx].rrfScore * 1.1,
        };
      } else {
        // Append new graph chunk with low base score
        merged.push({
          id: graphChunk.id,
          content: graphChunk.content,
          rrfScore: 0.01,
          vectorRank: null,
          bm25Rank: null,
          metadata: {},
        });
      }
    }

    // Sort by final score descending
    merged.sort((a, b) => b.rrfScore - a.rrfScore);
    return merged;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Graph expansion failed, continuing without graph signal: ${message}`);
    return existingCandidates;
  }
}
