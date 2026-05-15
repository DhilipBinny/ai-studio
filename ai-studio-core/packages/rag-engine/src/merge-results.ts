/**
 * Merge Decomposed Results — Combine results from multiple sub-queries
 *
 * After query decomposition, each sub-query produces its own set of RRF results.
 * This module merges them by:
 * 1. Union all results, keeping the highest score per chunk ID
 * 2. Boosting chunks that appear in multiple sub-query results (10% per extra appearance)
 * 3. Sorting by final score descending
 */

import type { RRFResult } from "./types";

/**
 * Merge results from multiple sub-query searches into a single ranked list.
 *
 * - Union all results; keep highest rrfScore per chunk ID.
 * - Boost chunks appearing in N sub-queries: score *= (1 + 0.1 * (N - 1)).
 * - Sort descending by rrfScore.
 *
 * Returns empty array if input is empty or all sub-query results are empty.
 */
export function mergeDecomposedResults(subQueryResults: RRFResult[][]): RRFResult[] {
  if (subQueryResults.length === 0) return [];

  const merged = new Map<string | number, RRFResult>();

  for (const results of subQueryResults) {
    for (const result of results) {
      const existing = merged.get(result.id);
      if (!existing || result.rrfScore > existing.rrfScore) {
        // Clone to avoid mutating the original
        merged.set(result.id, { ...result });
      }
    }
  }

  // Boost chunks that appear in multiple sub-query results
  for (const [id, result] of merged) {
    const appearanceCount = subQueryResults.filter(
      (results) => results.some((r) => r.id === id),
    ).length;
    if (appearanceCount > 1) {
      result.rrfScore *= 1 + 0.1 * (appearanceCount - 1);
    }
  }

  return [...merged.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}
