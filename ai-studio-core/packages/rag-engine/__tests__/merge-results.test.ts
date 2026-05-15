import { describe, it, expect } from "vitest";
import { mergeDecomposedResults } from "../src/merge-results";
import type { RRFResult } from "../src/types";

// ── Helpers ──

function makeResult(id: number, score: number, content?: string): RRFResult {
  return {
    id,
    content: content || `Chunk content ${id}`,
    rrfScore: score,
    vectorRank: 1,
    bm25Rank: 2,
    metadata: { fileName: "test.md", kbId: "kb1", chunkIndex: id },
  };
}

// ── Tests ──

describe("mergeDecomposedResults()", () => {
  describe("happy path", () => {
    it("should merge two result sets with overlapping chunks, keeping highest score and applying boost", () => {
      const subQuery1: RRFResult[] = [
        makeResult(1, 0.5),
        makeResult(2, 0.4),
        makeResult(3, 0.3),
      ];
      const subQuery2: RRFResult[] = [
        makeResult(2, 0.6), // same chunk as subQuery1[1], higher score
        makeResult(4, 0.35),
        makeResult(3, 0.2), // same chunk as subQuery1[2], lower score
      ];

      const merged = mergeDecomposedResults([subQuery1, subQuery2]);

      expect(merged.length).toBe(4);

      // Chunk 2 appears in both sub-queries with best score 0.6, boosted by 10%
      const chunk2 = merged.find((r) => r.id === 2);
      expect(chunk2).toBeDefined();
      expect(chunk2!.rrfScore).toBeCloseTo(0.6 * 1.1, 10);

      // Chunk 3 appears in both, best score 0.3, boosted by 10%
      const chunk3 = merged.find((r) => r.id === 3);
      expect(chunk3).toBeDefined();
      expect(chunk3!.rrfScore).toBeCloseTo(0.3 * 1.1, 10);

      // Chunk 1 appears in only one, no boost
      const chunk1 = merged.find((r) => r.id === 1);
      expect(chunk1).toBeDefined();
      expect(chunk1!.rrfScore).toBe(0.5);

      // Verify sorted descending
      for (let i = 1; i < merged.length; i++) {
        expect(merged[i - 1].rrfScore).toBeGreaterThanOrEqual(merged[i].rrfScore);
      }
    });

    it("should return union of results when no chunks overlap", () => {
      const subQuery1: RRFResult[] = [makeResult(1, 0.5), makeResult(2, 0.4)];
      const subQuery2: RRFResult[] = [makeResult(3, 0.35), makeResult(4, 0.3)];

      const merged = mergeDecomposedResults([subQuery1, subQuery2]);

      expect(merged.length).toBe(4);
      // No boost since no overlaps — scores unchanged
      expect(merged[0].rrfScore).toBe(0.5);
      expect(merged[1].rrfScore).toBe(0.4);
      expect(merged[2].rrfScore).toBe(0.35);
      expect(merged[3].rrfScore).toBe(0.3);
    });

    it("should apply 20% boost for chunk appearing in 3 sub-queries", () => {
      const subQuery1: RRFResult[] = [makeResult(1, 0.5)];
      const subQuery2: RRFResult[] = [makeResult(1, 0.4)];
      const subQuery3: RRFResult[] = [makeResult(1, 0.3)];

      const merged = mergeDecomposedResults([subQuery1, subQuery2, subQuery3]);

      expect(merged.length).toBe(1);
      // Best score is 0.5, appears in 3 sub-queries: boost = 1 + 0.1 * (3-1) = 1.2
      expect(merged[0].rrfScore).toBeCloseTo(0.5 * 1.2, 10);
    });
  });

  describe("edge cases", () => {
    it("should return empty array when given empty outer array", () => {
      const merged = mergeDecomposedResults([]);
      expect(merged).toEqual([]);
    });

    it("should return empty array when all sub-query results are empty", () => {
      const merged = mergeDecomposedResults([[], [], []]);
      expect(merged).toEqual([]);
    });

    it("should return results unchanged for a single sub-query (no merging needed)", () => {
      const results: RRFResult[] = [
        makeResult(1, 0.5),
        makeResult(2, 0.3),
      ];

      const merged = mergeDecomposedResults([results]);

      expect(merged.length).toBe(2);
      // No boost: only 1 sub-query, so appearance count = 1
      expect(merged[0].rrfScore).toBe(0.5);
      expect(merged[1].rrfScore).toBe(0.3);
    });

    it("should not mutate the original input arrays", () => {
      const original: RRFResult[] = [makeResult(1, 0.5)];
      const originalScore = original[0].rrfScore;

      mergeDecomposedResults([original, [makeResult(1, 0.3)]]);

      // Original should be unchanged
      expect(original[0].rrfScore).toBe(originalScore);
    });
  });

  describe("boost verification", () => {
    it("should apply exactly 10% boost per extra appearance beyond the first", () => {
      // Chunk appears in 2 out of 2 sub-queries: boost = 1 + 0.1 * 1 = 1.1
      const subQuery1: RRFResult[] = [makeResult(10, 0.8)];
      const subQuery2: RRFResult[] = [makeResult(10, 0.7)];

      const merged = mergeDecomposedResults([subQuery1, subQuery2]);
      expect(merged[0].rrfScore).toBeCloseTo(0.8 * 1.1, 10);

      // Chunk appears in 3 out of 3: boost = 1 + 0.1 * 2 = 1.2
      const subQuery3: RRFResult[] = [makeResult(10, 0.6)];
      const merged3 = mergeDecomposedResults([subQuery1, subQuery2, subQuery3]);
      expect(merged3[0].rrfScore).toBeCloseTo(0.8 * 1.2, 10);
    });

    it("should produce boosted score exceeding 1.0 when high score appears in 3 sub-queries", () => {
      // Chunk with score 0.95 appearing in 3 sub-queries:
      // boost = 1 + 0.1 * (3 - 1) = 1.2
      // final score = 0.95 * 1.2 = 1.14
      const subQuery1: RRFResult[] = [makeResult(1, 0.95)];
      const subQuery2: RRFResult[] = [makeResult(1, 0.90)];
      const subQuery3: RRFResult[] = [makeResult(1, 0.85)];

      const merged = mergeDecomposedResults([subQuery1, subQuery2, subQuery3]);

      expect(merged).toHaveLength(1);
      // Best score 0.95 * 1.2 = 1.14, which exceeds 1.0
      expect(merged[0].rrfScore).toBeCloseTo(0.95 * 1.2, 10);
      expect(merged[0].rrfScore).toBeGreaterThan(1.0);
    });

    it("should sort results by boosted score, not original score", () => {
      // Chunk A: score 0.5, appears in 1 sub-query -> final 0.5
      // Chunk B: score 0.45, appears in 2 sub-queries -> final 0.45 * 1.1 = 0.495
      // Chunk B should be ranked below A (0.495 < 0.5)
      const subQuery1: RRFResult[] = [makeResult(1, 0.5), makeResult(2, 0.45)];
      const subQuery2: RRFResult[] = [makeResult(2, 0.40)];

      const merged = mergeDecomposedResults([subQuery1, subQuery2]);

      expect(merged[0].id).toBe(1); // 0.5
      expect(merged[1].id).toBe(2); // 0.495
    });
  });
});
