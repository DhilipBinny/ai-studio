import type { RankedItem, RRFResult } from "./types";

const DEFAULT_K = 60;

export function rrfFuse(
  vectorResults: RankedItem[],
  bm25Results: RankedItem[],
  k: number = DEFAULT_K,
): RRFResult[] {
  const merged = new Map<string | number, {
    content: string;
    vectorRank: number | null;
    bm25Rank: number | null;
    metadata?: Record<string, unknown>;
  }>();

  for (let i = 0; i < vectorResults.length; i++) {
    const item = vectorResults[i];
    merged.set(item.id, {
      content: item.content,
      vectorRank: i + 1,
      bm25Rank: null,
      metadata: item.metadata,
    });
  }

  for (let i = 0; i < bm25Results.length; i++) {
    const item = bm25Results[i];
    const existing = merged.get(item.id);
    if (existing) {
      existing.bm25Rank = i + 1;
    } else {
      merged.set(item.id, {
        content: item.content,
        vectorRank: null,
        bm25Rank: i + 1,
        metadata: item.metadata,
      });
    }
  }

  const results: RRFResult[] = [];
  for (const [id, entry] of merged) {
    const vectorScore = entry.vectorRank !== null ? 1.0 / (k + entry.vectorRank) : 0;
    const bm25Score = entry.bm25Rank !== null ? 1.0 / (k + entry.bm25Rank) : 0;

    results.push({
      id,
      content: entry.content,
      rrfScore: vectorScore + bm25Score,
      vectorRank: entry.vectorRank,
      bm25Rank: entry.bm25Rank,
      metadata: entry.metadata,
    });
  }

  results.sort((a, b) => b.rrfScore - a.rrfScore);
  return results;
}
